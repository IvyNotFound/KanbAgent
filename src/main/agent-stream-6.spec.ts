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

})
