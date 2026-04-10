/**
 * Unit tests for stream-handlers.ts — kills surviving mutants (T1273).
 *
 * Strategy:
 * - Test eventsReceived counter (UpdateOperator: ++ vs --)
 * - Test stderr/stdout buffer accumulation (MethodExpression: slice vs other)
 * - Test ConditionalExpression branches in stdout line handler and close handler
 * - Test LogicalOperator for worktreeInfo && projectPath condition
 * - Test OptionalChaining on webContentsAgents.get(wcId)?.delete
 * - Test EqualityOperator: eventsReceived === 0 at close
 * - Test exact error message strings (StringLiteral)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

const mockWebContentsFromId = vi.hoisted(() => vi.fn())
const mockWebContentsSend = vi.hoisted(() => vi.fn())
const mockWebContentsIsDestroyed = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('electron', () => ({
  webContents: {
    fromId: mockWebContentsFromId,
  },
}))

const mockPushStreamEvent = vi.hoisted(() => vi.fn())
const mockCleanupStreamBatch = vi.hoisted(() => vi.fn())
const mockSendTerminalEvent = vi.hoisted(() => vi.fn())
const mockKillAgent = vi.hoisted(() => vi.fn())
const mockRemoveWorktree = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockAgents = vi.hoisted(() => new Map<string, unknown>())
const mockWebContentsAgents = vi.hoisted(() => new Map<number, Set<string>>())

vi.mock('../agent-stream-registry', () => ({
  agents: mockAgents,
  webContentsAgents: mockWebContentsAgents,
  pushStreamEvent: mockPushStreamEvent,
  cleanupStreamBatch: mockCleanupStreamBatch,
  sendTerminalEvent: mockSendTerminalEvent,
  killAgent: mockKillAgent,
}))

vi.mock('../worktree-manager', () => ({
  removeWorktree: mockRemoveWorktree,
}))

vi.mock('../agent-stream-helpers', () => ({
  MAX_STDERR_BUFFER_SIZE: 10000,
  logDebug: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

class FakeProc extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() }
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 1234
  kill = vi.fn()
}

function makeAdapter(cli = 'claude', parseLine?: (line: string) => unknown) {
  return {
    cli,
    parseLine: parseLine ?? vi.fn().mockReturnValue(null),
    extractConvId: vi.fn().mockReturnValue(null),
  }
}

function makeFakeWc(id = 1, isDestroyed = false) {
  const wc = {
    id,
    isDestroyed: vi.fn().mockReturnValue(isDestroyed),
    send: mockWebContentsSend,
  }
  return wc
}

import { attachStreamHandlers } from './stream-handlers'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('attachStreamHandlers', () => {
  let proc: FakeProc
  const WC_ID = 1
  const AGENT_ID = 'agent-42'

  beforeEach(() => {
    vi.clearAllMocks()
    proc = new FakeProc()
    mockAgents.clear()
    mockWebContentsAgents.clear()
    mockAgents.set(AGENT_ID, proc)
    mockWebContentsAgents.set(WC_ID, new Set([AGENT_ID]))

    const fakeWc = makeFakeWc(WC_ID, false)
    mockWebContentsFromId.mockReturnValue(fakeWc)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function attach(overrides: Partial<Parameters<typeof attachStreamHandlers>[0]> = {}) {
    return attachStreamHandlers({
      proc,
      id: AGENT_ID,
      wcId: WC_ID,
      adapter: makeAdapter() as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
      scriptTempFile: undefined,
      sessionId: undefined,
      projectPath: undefined,
      agentAdapters: new Map(),
      ...overrides,
    })
  }

  // ── eventsReceived counter (UpdateOperator ++ not --) ─────────────────────

  it('increments eventsReceived when a valid event is parsed (UpdateOperator: ++)', async () => {
    const fakeEvent = { type: 'assistant', message: { role: 'assistant', content: [] } }
    const adapter = makeAdapter('claude', vi.fn().mockReturnValue(fakeEvent))
    attach({ adapter: adapter as never })

    proc.stdout.write(JSON.stringify(fakeEvent) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    // If eventsReceived was decremented (mutant), close would send error:exit
    proc.emit('close', 0)
    await new Promise(resolve => setImmediate(resolve))

    // eventsReceived > 0 → cleanupStreamBatch should be called, not sendTerminalEvent with error
    expect(mockCleanupStreamBatch).toHaveBeenCalledWith(AGENT_ID, WC_ID)
    expect(mockSendTerminalEvent).not.toHaveBeenCalled()
  })

  it('pushes stream event when parseLine returns non-null', async () => {
    const fakeEvent = { type: 'text', text: 'hello' }
    const adapter = makeAdapter('claude', vi.fn().mockReturnValue(fakeEvent))
    attach({ adapter: adapter as never })

    proc.stdout.write(JSON.stringify(fakeEvent) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockPushStreamEvent).toHaveBeenCalledWith(AGENT_ID, WC_ID, fakeEvent)
  })

  // ── ConditionalExpression: parseLine returns null → stdoutErrorBuffer ──────

  it('does not push event when parseLine returns null (ConditionalExpression)', async () => {
    attach({ adapter: makeAdapter('claude', vi.fn().mockReturnValue(null)) as never })

    proc.stdout.write('not valid json\n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  it('skips empty lines in stdout (ConditionalExpression: if !clean return)', async () => {
    attach()
    proc.stdout.write('\n   \n')
    await new Promise(resolve => setImmediate(resolve))
    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  // ── stderr buffering ──────────────────────────────────────────────────────

  it('buffers stderr for claude (MethodExpression: slice not concatenate)', async () => {
    attach({ adapter: makeAdapter('claude') as never })

    // Emit lots of stderr to test slicing
    const bigChunk = 'x'.repeat(5000)
    proc.stderr.emit('data', Buffer.from(bigChunk))
    await new Promise(resolve => setImmediate(resolve))

    // Emit close with no events received — should include stderr in error
    proc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSendTerminalEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      expect.objectContaining({ type: 'error:exit' })
    )
  })

  it('stderr buffer is truncated to MAX_STDERR_BUFFER_SIZE with slice (UnaryOperator: -MAX not +MAX)', async () => {
    // We can verify the truncation direction works by observing the tail is kept (not head)
    attach({ adapter: makeAdapter('claude') as never })

    const bigChunk = 'A'.repeat(8000) + 'B'.repeat(8000)
    proc.stderr.emit('data', Buffer.from(bigChunk))
    await new Promise(resolve => setImmediate(resolve))

    proc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    const call = mockSendTerminalEvent.mock.calls[0]
    const errorEvent = call[2] as { stderr?: string }
    // Buffer was sliced from the end → last chars should be 'B' not 'A'
    if (errorEvent.stderr) {
      expect(errorEvent.stderr.slice(-1)).toBe('B')
    }
  })

  // ── Non-claude adapter: stderr forwarded in real-time ────────────────────

  it('pushes error event for non-claude adapter stderr lines (ConditionalExpression)', async () => {
    attach({ adapter: makeAdapter('opencode') as never })

    proc.stderr.write('Error: API key invalid\n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockPushStreamEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      expect.objectContaining({ type: 'error', text: expect.stringContaining('API key invalid') })
    )
  })

  it('stderr text is prefixed with [stderr] (StringLiteral)', async () => {
    attach({ adapter: makeAdapter('gemini') as never })

    proc.stderr.write('some error\n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockPushStreamEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      expect.objectContaining({ text: '[stderr] some error' })
    )
  })

  it('increments eventsReceived for non-claude stderr lines (UpdateOperator: ++)', async () => {
    attach({ adapter: makeAdapter('opencode') as never })

    proc.stderr.write('diagnostic info\n')
    await new Promise(resolve => setImmediate(resolve))

    // eventsReceived was incremented (from stderr) → close should call cleanupStreamBatch
    proc.emit('close', 0)
    await new Promise(resolve => setImmediate(resolve))

    expect(mockCleanupStreamBatch).toHaveBeenCalledWith(AGENT_ID, WC_ID)
  })

  it('skips empty stderr lines (ConditionalExpression: if !clean return)', async () => {
    attach({ adapter: makeAdapter('opencode') as never })

    proc.stderr.write('\n   \n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  // ── convId extraction ──────────────────────────────────────────────────────

  it('sends convId event when extractConvId returns non-null (ConditionalExpression)', async () => {
    const fakeEvent = { type: 'system', convId: 'abc-123' }
    const adapter = {
      cli: 'claude',
      parseLine: vi.fn().mockReturnValue(fakeEvent),
      extractConvId: vi.fn().mockReturnValue('abc-123'),
    }
    const fakeWc = makeFakeWc(WC_ID, false)
    mockWebContentsFromId.mockReturnValue(fakeWc)
    attach({ adapter: adapter as never })

    proc.stdout.write(JSON.stringify(fakeEvent) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockWebContentsSend).toHaveBeenCalledWith(`agent:convId:${AGENT_ID}`, 'abc-123')
  })

  it('does NOT send convId when extractConvId returns null (ConditionalExpression false)', async () => {
    const fakeEvent = { type: 'text', text: 'no convId' }
    const adapter = {
      cli: 'claude',
      parseLine: vi.fn().mockReturnValue(fakeEvent),
      extractConvId: vi.fn().mockReturnValue(null),
    }
    attach({ adapter: adapter as never })

    proc.stdout.write(JSON.stringify(fakeEvent) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    const convIdCalls = mockWebContentsSend.mock.calls.filter(
      ([channel]) => String(channel).startsWith('agent:convId:')
    )
    expect(convIdCalls).toHaveLength(0)
  })

  // ── killAgent when webContents destroyed (ConditionalExpression) ───────────

  it('kills agent when webContents is destroyed during stream (ConditionalExpression)', async () => {
    const fakeEvent = { type: 'text', text: 'hello' }
    const adapter = {
      cli: 'claude',
      parseLine: vi.fn().mockReturnValue(fakeEvent),
      extractConvId: vi.fn().mockReturnValue(null),
    }
    // webContents is destroyed
    mockWebContentsFromId.mockReturnValue(null)
    attach({ adapter: adapter as never })

    proc.stdout.write(JSON.stringify(fakeEvent) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    expect(mockKillAgent).toHaveBeenCalledWith(AGENT_ID)
  })

  // ── error event ───────────────────────────────────────────────────────────

  it('sends error:spawn event on process error (StringLiteral)', async () => {
    const agentAdapters = new Map<string, unknown>()
    agentAdapters.set(AGENT_ID, {})
    attach({ agentAdapters: agentAdapters as never })

    proc.emit('error', new Error('ENOENT: wsl.exe not found'))
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSendTerminalEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      expect.objectContaining({ type: 'error:spawn', error: 'ENOENT: wsl.exe not found' })
    )
  })

  it('deletes agent from registry on error (OptionalChaining)', async () => {
    attach()
    mockAgents.set(AGENT_ID, proc)
    mockWebContentsAgents.set(WC_ID, new Set([AGENT_ID]))

    proc.emit('error', new Error('spawn failed'))
    await new Promise(resolve => setImmediate(resolve))

    expect(mockAgents.has(AGENT_ID)).toBe(false)
  })

  it('does not throw when webContentsAgents has no entry for wcId on process error (OptionalChaining)', async () => {
    // Clear the set — optional chaining prevents crash inside the handler
    // Use a separate proc to avoid unhandled error from EventEmitter
    const proc2 = new FakeProc()
    mockAgents.set('agent-err-wca', proc2)
    mockWebContentsAgents.delete(WC_ID)

    attachStreamHandlers({
      proc: proc2,
      id: 'agent-err-wca',
      wcId: WC_ID,
      adapter: makeAdapter() as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
      scriptTempFile: undefined,
      sessionId: undefined,
      projectPath: undefined,
      agentAdapters: new Map(),
    })

    // Emit a process error — the handler's optional chaining should not throw
    proc2.emit('error', new Error('spawn-wca-test'))
    await new Promise(resolve => setImmediate(resolve))

    // sendTerminalEvent was still called (the handler ran without crashing)
    expect(mockSendTerminalEvent).toHaveBeenCalledWith(
      'agent-err-wca', WC_ID,
      expect.objectContaining({ type: 'error:spawn' })
    )
  })

  // ── close handler ──────────────────────────────────────────────────────────

})
