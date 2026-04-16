/**
 * Tests for agent-stream.ts — continued (part 4).
 * Targets the 97 surviving mutants identified by Stryker:
 * - StringLiteral: exact IPC channel names (agent:convId:, agent:exit:, agent:stream:),
 *   exact error message strings (error:exit, error:spawn, error:user)
 * - ConditionalExpression: branches in close/line handlers, send guards
 * - LogicalOperator: wc && !wc.isDestroyed(), worktreeInfo && opts.projectPath
 * - MethodExpression: .trim(), .slice(-MAX_STDERR_BUFFER_SIZE), .replace(), .slice(-1000)
 * - OptionalChaining: adapter?.extractConvId, adapter?.formatStdinMessage, adapter?.singleShotStdin
 * - EqualityOperator: adapter.cli === 'claude'
 * - UpdateOperator: eventsReceived++
 * - Regex: /  +/g double-space replacement
 * - ArrayDeclaration: wslArgs initial state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
const mockAppendFileSync = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('fs', () => {
  const fns = {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    appendFileSync: mockAppendFileSync,
  }
  return { default: fns, ...fns }
})

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  default: { writeFile: mockWriteFile },
}))

const senderRegistry = vi.hoisted(() => new Map<number, {
  id: number
  once: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    on: vi.fn(),
  },
  webContents: {
    fromId: vi.fn((id: number) => senderRegistry.get(id) ?? null),
  },
}))

const mockStdin = {
  write: vi.fn(),
  writableEnded: false,
  end: vi.fn(),
}

class FakeProc extends EventEmitter {
  stdin = { ...mockStdin }
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 99999
  kill = vi.fn()
}

let mockProc: FakeProc
const mockSpawn = vi.fn(() => mockProc)
const mockExecFile = vi.fn()

vi.mock('child_process', () => {
  const spawnFn = (...args: unknown[]) => mockSpawn(...args)
  const execFileFn = (...args: unknown[]) => mockExecFile(...args)
  return {
    default: { spawn: spawnFn, execFile: execFileFn },
    spawn: spawnFn,
    execFile: execFileFn,
  }
})

const mockQueryLive = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockAssertDbPathAllowed = vi.hoisted(() => vi.fn())

vi.mock('./db', () => ({
  queryLive: mockQueryLive,
  assertDbPathAllowed: mockAssertDbPathAllowed,
  registerDbPath: vi.fn(),
  registerProjectPath: vi.fn(),
}))

// ── hookServer mock (T1816) ───────────────────────────────────────────────────
vi.mock('./hookServer', () => ({
  resolvePermission: vi.fn().mockReturnValue(true),
  pendingPermissions: new Map(),
  startHookServer: vi.fn(),
  setHookWindow: vi.fn(),
  HOOK_PORT: 27182,
}))

const mockCreateWorktree = vi.hoisted(() => vi.fn().mockResolvedValue({ path: '/tmp/wt/branch-1', branch: 'session-1' }))
const mockRemoveWorktree = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./worktree-manager', () => ({
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree,
}))

import * as agentStream from './agent-stream'

type MockSender = {
  id: number
  once: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}

describe('agent-stream part 4 — mutation targets', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>
  let mockSender: MockSender

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.clearAllMocks()
    mockProc = new FakeProc()

    handlers = new Map()
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    })

    agentStream.registerAgentStreamHandlers()

    mockSender = {
      id: 42,
      once: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      send: vi.fn(),
    }
    senderRegistry.set(42, mockSender)

    const { webContents } = await import('electron')
    vi.mocked(webContents.fromId).mockImplementation((id: number) => senderRegistry.get(id) ?? null)
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const timer of agentStream._testing.streamTimers.values()) {
      clearInterval(timer)
    }
    agentStream._testing.streamBatches.clear()
    agentStream._testing.streamTimers.clear()
    senderRegistry.clear()
    agentStream._testing.agents.clear()
    agentStream._testing.webContentsAgents.clear()
  })

  // ── StringLiteral: exact channel names ─────────────────────────────────────

  describe('BlockStatement: proc error handler cleanup', () => {
    it('removes agent from agents map on error event', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      expect(agentStream._testing.agents.has(id)).toBe(true)

      mockProc.emit('error', new Error('ENOENT'))
      await new Promise(resolve => setImmediate(resolve))

      expect(agentStream._testing.agents.has(id)).toBe(false)
    })

    it('removes agent from webContentsAgents on error event', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const wcAgents = agentStream._testing.webContentsAgents.get(42)
      expect(wcAgents?.has(id)).toBe(true)

      mockProc.emit('error', new Error('ENOENT'))
      await new Promise(resolve => setImmediate(resolve))

      const wcAgentsAfter = agentStream._testing.webContentsAgents.get(42)
      expect(wcAgentsAfter?.has(id)).toBe(false)
    })

    it('sends error:spawn with error message (not empty string)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('error', new Error('spawn ENOENT'))
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.type).toBe('error:spawn')
      expect(ev.error).toBe('spawn ENOENT')
    })
  })

  // ── ConditionalExpression: webContents destroyed mid-stream ──────────────

  describe('ConditionalExpression: webContents destroyed mid-stream', () => {
    it('kills agent when webContents is null mid-stream', async () => {
      const { webContents } = await import('electron')
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Remove wc so fromId returns null on stream event
      senderRegistry.delete(42)
      vi.mocked(webContents.fromId).mockReturnValue(null as never)

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      // Agent should have been killed (removed from map)
      expect(agentStream._testing.agents.has(id)).toBe(false)
    })

    it('kills agent when webContents is destroyed mid-stream', async () => {
      const { webContents } = await import('electron')
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // First event succeeds (wc alive)
      mockSender.isDestroyed.mockReturnValue(false)
      const payload1 = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload1) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      expect(agentStream._testing.agents.has(id)).toBe(true)

      // Now wc is destroyed → next event kills agent
      mockSender.isDestroyed.mockReturnValue(true)
      const payload2 = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload2) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      expect(agentStream._testing.agents.has(id)).toBe(false)
    })
  })

  // ── webContentsAgents first-create registration ───────────────────────────

  describe('webContentsAgents first-create (L100 ConditionalExpression)', () => {
    it('registers destroyed listener only once for same wcId (idempotent)', async () => {
      const handler = handlers.get('agent:create')!

      // Create two agents for same wc
      await handler({ sender: mockSender }, {})
      await handler({ sender: mockSender }, {})

      // once('destroyed') should have been called exactly once
      expect(mockSender.once).toHaveBeenCalledTimes(1)
      expect(mockSender.once.mock.calls[0][0]).toBe('destroyed')
    })

    it('second webContents gets its own destroyed listener', async () => {
      const handler = handlers.get('agent:create')!

      // First wc already registered
      await handler({ sender: mockSender }, {})

      // Second wc
      const mockSender2: MockSender = {
        id: 99,
        once: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn(),
      }
      senderRegistry.set(99, mockSender2)
      await handler({ sender: mockSender2 }, {})

      // Each wc gets exactly one once() call
      expect(mockSender.once).toHaveBeenCalledTimes(1)
      expect(mockSender2.once).toHaveBeenCalledTimes(1)
    })
  })

  // ── temp file cleanup on close ────────────────────────────────────────────

  describe('temp file cleanup (BlockStatement L323-L325)', () => {
    it('calls unlinkSync for spTempFile when systemPrompt provided', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { systemPrompt: 'my prompt' })

      // System prompt is written via writeFileSync (adapter.prepareSystemPrompt uses sync write)
      const spWriteCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('ka-sp-')
      )!
      const spPath = spWriteCall[0] as string

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      expect(mockUnlinkSync).toHaveBeenCalledWith(spPath)
    })

    it('calls unlinkSync for scriptTempFile on close', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { wslDistro: 'Ubuntu' })

      const scriptWriteCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('claude-start-')
      )!
      const scriptPath = scriptWriteCall[0] as string

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      expect(mockUnlinkSync).toHaveBeenCalledWith(scriptPath)
    })
  })

  // ── Regex: /  +/g mutant ─────────────────────────────────────────────────

  describe('Regex: /  +/g collapses multiple spaces', () => {
    it('3+ spaces collapsed to single space in stdoutErrorBuffer', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Write a line with 3+ spaces
      mockProc.stdout.write('Error   triple   space\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      // Multiple spaces collapsed
      expect(ev.error).toContain('Error triple space')
      expect(ev.error).not.toContain('   ')
    })
  })

})
