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

  describe('ConditionalExpression: close handler branches', () => {
    it('sends agent:exit when wc is alive after close with events', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const exitSent = vi.mocked(mockSender.send).mock.calls.some(
        ([ch]) => ch === `agent:exit:${id}`
      )
      expect(exitSent).toBe(true)
    })

    it('does NOT send agent:exit when wc is destroyed at close time', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      // Destroy the webContents before close
      mockSender.isDestroyed.mockReturnValue(true)

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const exitSent = vi.mocked(mockSender.send).mock.calls.some(
        ([ch]) => ch === `agent:exit:${id}`
      )
      expect(exitSent).toBe(false)
    })

    it('does NOT send agent:exit when wc returns null at close time', async () => {
      const { webContents } = await import('electron')
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      // Remove wc from registry so fromId returns null
      senderRegistry.delete(42)
      vi.mocked(webContents.fromId).mockReturnValue(null as never)

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const exitSent = vi.mocked(mockSender.send).mock.calls.some(
        ([ch]) => ch === `agent:exit:${id}`
      )
      expect(exitSent).toBe(false)
    })

    it('calls cleanupStreamBatch (not sendTerminalEvent) when eventsReceived > 0 on close', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      vi.mocked(mockSender.send).mockClear()

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      // No error:exit should have been sent (eventsReceived > 0)
      const errorExitSent = vi.mocked(mockSender.send).mock.calls.some(
        ([, batch]) => Array.isArray(batch) && (batch as { type: string }[])[0]?.type === 'error:exit'
      )
      expect(errorExitSent).toBe(false)
    })

    it('emits error:exit when eventsReceived = 0 on close (eventsReceived++ is tested)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {})

      // No events → close
      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([, batch]) => Array.isArray(batch) && (batch as { type: string }[])[0]?.type === 'error:exit'
      )
      expect(call).toBeDefined()
    })
  })

  // ── UpdateOperator: eventsReceived++ ──────────────────────────────────────

  describe('UpdateOperator: eventsReceived++', () => {
    it('only fires error:exit when truly 0 events received (not when 1 received, then decremented)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Emit 3 valid events → eventsReceived = 3, not 0
      for (let i = 0; i < 3; i++) {
        const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
        mockProc.stdout.write(JSON.stringify(payload) + '\n')
        await new Promise(resolve => setImmediate(resolve))
      }

      vi.mocked(mockSender.send).mockClear()
      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const errorExitSent = vi.mocked(mockSender.send).mock.calls.some(
        ([, batch]) => Array.isArray(batch) && (batch as { type: string }[])[0]?.type === 'error:exit'
      )
      expect(errorExitSent).toBe(false)
    })
  })

  // ── LogicalOperator: wc && !wc.isDestroyed() ───────────────────────────────

  describe('LogicalOperator: wc && !wc.isDestroyed()', () => {
    it('sends convId when wc exists AND is not destroyed', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockSender.isDestroyed.mockReturnValue(false)

      const systemInit = {
        type: 'system',
        subtype: 'init',
        session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }
      mockProc.stdout.write(JSON.stringify(systemInit) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      const convIdCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:convId:${id}`
      )
      expect(convIdCall).toBeDefined()
    })

    it('does NOT send convId when wc is destroyed', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      mockSender.isDestroyed.mockReturnValue(true)

      const systemInit = {
        type: 'system',
        subtype: 'init',
        session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }
      mockProc.stdout.write(JSON.stringify(systemInit) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      const convIdCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:convId:${id}`
      )
      expect(convIdCall).toBeUndefined()
    })

    it('does NOT send convId when wc returns null (fromId returns null)', async () => {
      const { webContents } = await import('electron')
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      senderRegistry.delete(42)
      vi.mocked(webContents.fromId).mockReturnValue(null as never)

      const systemInit = {
        type: 'system',
        subtype: 'init',
        session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }
      mockProc.stdout.write(JSON.stringify(systemInit) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      const convIdCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:convId:${id}`
      )
      expect(convIdCall).toBeUndefined()
    })
  })

  // ── MethodExpression: .trim() on stdout lines ──────────────────────────────

})
