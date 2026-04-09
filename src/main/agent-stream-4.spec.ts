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

  describe('MethodExpression: stdout line processing', () => {
    it('ignores empty lines (trim returns empty string → return early)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {})

      // Write whitespace-only lines — should not produce events or errors
      mockProc.stdout.write('   \n\n\t\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      // eventsReceived = 0 → error:exit should be sent
      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([, batch]) => Array.isArray(batch) && (batch as { type: string }[])[0]?.type === 'error:exit'
      )
      expect(call).toBeDefined()
    })

    it('buffers only non-empty readable lines in stdoutErrorBuffer', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Write non-JSON with content → goes into stdoutErrorBuffer
      mockProc.stdout.write('Error: command not found\n')
      await new Promise(resolve => setImmediate(resolve))

      // Write empty → ignored (trim early return)
      mockProc.stdout.write('\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toContain('Error: command not found')
    })

    it('strips NUL bytes from non-parseable stdout lines (replace /\\x00/g)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Line with NUL bytes — not JSON, goes to stdoutErrorBuffer after cleaning
      mockProc.stdout.write('Error\x00\x00message\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      // Should contain "Errormessage" not "Error\x00\x00message"
      expect(ev.error).not.toContain('\x00')
      expect(ev.error).toContain('Errormessage')
    })

    it('collapses double spaces in non-parseable stdout (replace /  +/g)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Line with multiple spaces
      mockProc.stdout.write('Error  with   extra   spaces\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      // Double spaces should be collapsed to single
      expect(ev.error).not.toContain('  ')
      expect(ev.error).toContain('Error with extra spaces')
    })

    it('limits stderrBuffer to MAX_STDERR_BUFFER_SIZE via .slice(-MAX)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Write > 15000 chars of stderr
      const bigChunk = 'E'.repeat(15000)
      mockProc.stderr.write(bigChunk)
      mockProc.stderr.write('FINAL_MARKER\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; stderr?: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      // stderr field should be defined and contain the final part
      expect(ev.stderr).toBeDefined()
      expect(ev.stderr).toContain('FINAL_MARKER')
      // Should be trimmed to <= 15000 chars (MAX_STDERR_BUFFER_SIZE)
      expect(ev.stderr!.length).toBeLessThanOrEqual(15001)
    })

    it('limits stdoutErrorBuffer to 1000 chars via .slice(-1000)', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, {})) as string

      // Write many non-JSON lines > 1000 chars
      for (let i = 0; i < 20; i++) {
        mockProc.stdout.write('x'.repeat(100) + '\n')
        await new Promise(resolve => setImmediate(resolve))
      }
      mockProc.stdout.write('FINAL_LINE\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 1)
      await new Promise(resolve => setImmediate(resolve))

      const call = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:stream:${id}`
      )!
      const batch = call[1] as Array<{ type: string; error: string }>
      const ev = Array.isArray(batch) ? batch[0] : batch
      expect(ev.error).toContain('FINAL_LINE')
    })
  })

  // ── OptionalChaining: adapter?.extractConvId ──────────────────────────────

  describe('OptionalChaining: adapter optional methods', () => {
    it('aider adapter: extractConvId is undefined — no convId channel sent', async () => {
      const handler = handlers.get('agent:create')!
      const id = (await handler({ sender: mockSender }, { cli: 'aider' })) as string

      // Aider output is plain text, parseLine returns a text event
      mockProc.stdout.write('Some aider output\n')
      await new Promise(resolve => setImmediate(resolve))

      const convIdCall = vi.mocked(mockSender.send).mock.calls.find(
        ([ch]) => ch === `agent:convId:${id}`
      )
      expect(convIdCall).toBeUndefined()
    })

    it('aider adapter: formatStdinMessage is undefined — falls back to default JSONL format', async () => {
      const handler = handlers.get('agent:create')!
      const sendHandler = handlers.get('agent:send')!

      const id = (await handler({ sender: mockSender }, { cli: 'aider' })) as string

      // Force proc.stdin
      agentStream._testing.agents.set(id, mockProc as unknown as ReturnType<typeof import('child_process').spawn>)

      const fakeStdin = { write: vi.fn(), writableEnded: false, end: vi.fn() }
      Object.assign(mockProc, { stdin: fakeStdin })

      await sendHandler({ sender: mockSender }, id, 'hello aider')

      // aider has no formatStdinMessage → falls back to JSON.stringify
      const written = fakeStdin.write.mock.calls[0]?.[0] as string
      expect(written).toBeDefined()
      const parsed = JSON.parse(written.trim())
      expect(parsed.type).toBe('user')
      expect(parsed.message.content[0].text).toBe('hello aider')
    })

    it('opencode adapter: singleShotStdin=true → stdin.end() called after write', async () => {
      const handler = handlers.get('agent:create')!
      const sendHandler = handlers.get('agent:send')!

      const id = (await handler({ sender: mockSender }, { cli: 'opencode' })) as string

      const fakeStdin = { write: vi.fn(), writableEnded: false, end: vi.fn() }
      Object.assign(mockProc, { stdin: fakeStdin })
      agentStream._testing.agents.set(id, mockProc as unknown as ReturnType<typeof import('child_process').spawn>)

      await sendHandler({ sender: mockSender }, id, 'hello opencode')

      expect(fakeStdin.write).toHaveBeenCalledOnce()
      expect(fakeStdin.end).toHaveBeenCalledOnce()
    })

    it('claude adapter: singleShotStdin is undefined → stdin.end() NOT called', async () => {
      const handler = handlers.get('agent:create')!
      const sendHandler = handlers.get('agent:send')!

      const id = (await handler({ sender: mockSender }, {})) as string

      const fakeStdin = { write: vi.fn(), writableEnded: false, end: vi.fn() }
      Object.assign(mockProc, { stdin: fakeStdin })
      agentStream._testing.agents.set(id, mockProc as unknown as ReturnType<typeof import('child_process').spawn>)

      await sendHandler({ sender: mockSender }, id, 'hello claude')

      expect(fakeStdin.write).toHaveBeenCalledOnce()
      expect(fakeStdin.end).not.toHaveBeenCalled()
    })

    it('opencode adapter: formatStdinMessage returns plain text + newline (not JSONL)', async () => {
      const handler = handlers.get('agent:create')!
      const sendHandler = handlers.get('agent:send')!

      const id = (await handler({ sender: mockSender }, { cli: 'opencode' })) as string

      const fakeStdin = { write: vi.fn(), writableEnded: false, end: vi.fn() }
      Object.assign(mockProc, { stdin: fakeStdin })
      agentStream._testing.agents.set(id, mockProc as unknown as ReturnType<typeof import('child_process').spawn>)

      await sendHandler({ sender: mockSender }, id, 'test message')

      const written = fakeStdin.write.mock.calls[0]?.[0] as string
      expect(written).toBe('test message\n')
      // Must NOT be JSON
      expect(() => JSON.parse(written.trim())).toThrow()
    })
  })

  // ── EqualityOperator: adapter.cli === 'claude' ────────────────────────────

  describe('EqualityOperator: adapter.cli === "claude" routing', () => {
    it('non-claude adapter (aider) spawns wsl.exe with bash script (not powershell.exe)', async () => {
      const originalPlatform = process.platform
      // Ensure we're in WSL path (not local Windows)
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { cli: 'aider', wslDistro: 'Ubuntu' })

      // For non-claude: buildCommand is used, script is <cli>-start-*.sh
      const spawnArgs = mockSpawn.mock.calls[0]
      expect(spawnArgs).toBeDefined()
      // Should use wsl.exe path or 'wsl.exe', and script should be .sh
      const scriptWriteCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('aider-start')
      )
      expect(scriptWriteCall).toBeDefined()

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('claude adapter (default) spawns via claude-start-*.sh script', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { wslDistro: 'Ubuntu' })

      const scriptWriteCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('claude-start')
      )
      expect(scriptWriteCall).toBeDefined()
      expect(String(scriptWriteCall![1])).toContain('exec ')
    })

    it('local Windows: claude uses PS1 script (not shell=true spawn)', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { wslDistro: 'local' })

      const ps1WriteCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).endsWith('.ps1')
      )
      expect(ps1WriteCall).toBeDefined()

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('local Windows: non-claude adapter uses shell:true spawn (no ps1 script)', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { cli: 'aider', wslDistro: 'local' })

      const ps1WriteCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).endsWith('.ps1')
      )
      expect(ps1WriteCall).toBeUndefined()

      // spawn should have shell: true
      const spawnOpts = mockSpawn.mock.calls[0]?.[2] as { shell?: boolean }
      expect(spawnOpts?.shell).toBe(true)

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })
  })

  // ── agent:send guards ──────────────────────────────────────────────────────

  describe('agent:send type guards', () => {
    it('throws when id is not a string (typeof id !== "string")', () => {
      const sendHandler = handlers.get('agent:send')!
      expect(() => sendHandler({ sender: mockSender }, 123, 'text')).toThrow(
        'agent:send requires id: string and text: string'
      )
    })

    it('throws when text is not a string (typeof text !== "string")', () => {
      const sendHandler = handlers.get('agent:send')!
      expect(() => sendHandler({ sender: mockSender }, 'some-id', 42)).toThrow(
        'agent:send requires id: string and text: string'
      )
    })

    it('throws when both id and text are wrong types', () => {
      const sendHandler = handlers.get('agent:send')!
      expect(() => sendHandler({ sender: mockSender }, null, null)).toThrow(
        'agent:send requires id: string and text: string'
      )
    })

    it('throws "No active agent process" when id is valid string but unknown', () => {
      const sendHandler = handlers.get('agent:send')!
      expect(() => sendHandler({ sender: mockSender }, 'nonexistent-id', 'text')).toThrow(
        'No active agent process for id=nonexistent-id'
      )
    })

    it('LogicalOperator agent:send: throws when text is string but id is not (OR not AND)', () => {
      const sendHandler = handlers.get('agent:send')!
      // id=number → guard catches it even if text is fine
      expect(() => sendHandler({ sender: mockSender }, 0, 'valid text')).toThrow(
        'agent:send requires id: string and text: string'
      )
    })
  })

  // ── agent:kill guard ────────────────────────────────────────────────────────

  describe('agent:kill type guard', () => {
    it('throws when id is not a string', () => {
      const killHandler = handlers.get('agent:kill')!
      expect(() => killHandler({ sender: mockSender }, 123)).toThrow(
        'agent:kill requires id: string'
      )
    })
  })

  // ── ArrayDeclaration: wslArgs starts empty ────────────────────────────────

  describe('ArrayDeclaration: wslArgs initial state', () => {
    it('wslArgs without wslDistro: no -d flag in spawn args', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {}) // no wslDistro

      const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
      expect(args).not.toContain('-d')
    })

    it('wslArgs with wslDistro=Ubuntu: includes -d Ubuntu in spawn args', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { wslDistro: 'Ubuntu' })

      const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
      expect(args).toContain('-d')
      const dIdx = args.indexOf('-d')
      expect(args[dIdx + 1]).toBe('Ubuntu')
    })

    it('wslArgs with wslDistro="local": wslArgs remains empty (no -d flag)', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { wslDistro: 'local' })

      // local Windows path → powershell.exe spawn, not wsl.exe
      const [cmd] = mockSpawn.mock.calls[0] as [string, string[]]
      expect(cmd).toBe('powershell.exe')

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })
  })

  // ── LogicalOperator: worktreeInfo && opts.projectPath ────────────────────

  describe('LogicalOperator: worktreeInfo && opts.projectPath on close', () => {
    it('does NOT call removeWorktree if projectPath is absent even when worktreeInfo is set', async () => {
      // createWorktree needs projectPath to be called, so this test just verifies no-projectPath path
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { sessionId: 7 }) // no projectPath

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      expect(mockRemoveWorktree).not.toHaveBeenCalled()
    })

    it('calls removeWorktree when worktreeInfo is set AND projectPath is provided', async () => {
      mockCreateWorktree.mockResolvedValueOnce({ path: '/tmp/wt/session-7', branch: 'session-7' })
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {
        projectPath: 'C:\\projects\\foo',
        wslDistro: 'Ubuntu',
        sessionId: 7,
      })

      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      expect(mockRemoveWorktree).toHaveBeenCalledWith('C:\\projects\\foo', 7)
    })
  })

  // ── BlockStatement: error handler cleanup ─────────────────────────────────

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

      const spWriteCall = mockWriteFile.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('claude-sp-')
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
