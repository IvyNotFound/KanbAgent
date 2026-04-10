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

  describe('StringLiteral: exact IPC channel names', () => {
    it('sends convId on channel "agent:convId:<id>" (not "agent:convId" or empty)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Claude adapter: emit system:init with session_id to trigger extractConvId
      const systemInit = {
        type: 'system',
        subtype: 'init',
        session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }
      mockProc.stdout.write(JSON.stringify(systemInit) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      const convIdCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => typeof ch === 'string' && ch.startsWith('agent:convId:')
      )
      expect(convIdCall).toBeDefined()
      expect(convIdCall![0]).toBe(`agent:convId:${id}`)
    })

    it('sends exit on channel "agent:exit:<id>" (not "agent:exit" or empty)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Emit a valid event so eventsReceived > 0 (skip error:exit branch)
      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const exitCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => typeof ch === 'string' && ch.startsWith('agent:exit:')
      )
      expect(exitCall).toBeDefined()
      expect(exitCall![0]).toBe(`agent:exit:${id}`)
    })

    it('emits exitCode value on agent:exit channel (not undefined)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 42)
      await new Promise(resolve => setImmediate(resolve))

      const exitCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:exit:${id}`
      )
      expect(exitCall).toBeDefined()
      expect(exitCall![1]).toBe(42)
    })

    it('sends stream events on channel "agent:stream:<id>"', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      // Flush the batch (advance past setInterval tick)
      vi.advanceTimersByTime(200)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => typeof ch === 'string' && ch.startsWith('agent:stream:')
      )
      expect(streamCall).toBeDefined()
      expect(streamCall![0]).toBe(`agent:stream:${id}`)
    })

    it('error:exit has type exactly "error:exit" (not "error" or empty)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )
      expect(streamCall).toBeDefined()
      const batch = streamCall![1] as Array<{ type: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.type).toBe('error:exit')
    })

    it('error:spawn has type exactly "error:spawn" (not "error" or empty)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('error', new Error('ENOENT'))
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )
      expect(streamCall).toBeDefined()
      const batch = streamCall![1] as Array<{ type: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.type).toBe('error:spawn')
    })

    it('error:exit message for code=0 no-output says "without producing any output" exactly', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = streamCall[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toBe('Process exited without producing any output (code 0)')
    })

    it('error:exit message for code=-1 (abnormal) without stdout context says "Process exited abnormally (code -1)."', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('close', -1)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = streamCall[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toBe('Process exited abnormally (code -1).')
    })

    it('error:exit message for code=4294967295 (abnormal) without stdout says the exact string', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('close', 4294967295)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = streamCall[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toBe('Process exited abnormally (code 4294967295).')
    })

    it('error:exit for code=-1 with stdout ctx prepends context to message', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Write non-JSON stdout to trigger stdoutErrorBuffer
      mockProc.stdout.write('WSL error: distribution not found\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', -1)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = streamCall[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toContain('Process exited abnormally (code -1):')
      expect(ev.error).toContain('WSL error: distribution not found')
    })

    it('error:exit for exitCode!==0 without stdout uses "Process exited with code N" exactly', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockProc.emit('close', 5)
      await new Promise(resolve => setImmediate(resolve))

      const streamCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = streamCall[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toBe('Process exited with code 5')
    })
  })

  // ── ConditionalExpression: close handler branches ──────────────────────────

})
