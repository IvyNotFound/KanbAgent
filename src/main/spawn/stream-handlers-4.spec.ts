/**
 * Unit tests for stream-handlers.ts — ANSI strip, TUI filter, text dedup (T1992).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
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

vi.mock('electron', () => ({
  webContents: { fromId: mockWebContentsFromId },
}))

const mockPushStreamEvent = vi.hoisted(() => vi.fn())
const mockCleanupStreamBatch = vi.hoisted(() => vi.fn())
const mockSendTerminalEvent = vi.hoisted(() => vi.fn())
const mockKillAgent = vi.hoisted(() => vi.fn())

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
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../agent-stream-helpers', () => ({
  MAX_STDERR_BUFFER_SIZE: 10000,
  logDebug: vi.fn(),
}))

vi.mock('../db', () => ({
  writeDb: vi.fn().mockResolvedValue(undefined),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

class FakeProc extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() }
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 1234
  kill = vi.fn()
}

function makeAdapter(cli = 'opencode', parseLine?: (line: string) => unknown) {
  return {
    cli,
    parseLine: parseLine ?? vi.fn().mockReturnValue(null),
    extractConvId: vi.fn().mockReturnValue(null),
  }
}

function makeFakeWc(id = 1) {
  return {
    id,
    isDestroyed: vi.fn().mockReturnValue(false),
    send: mockWebContentsSend,
  }
}

import { attachStreamHandlers } from './stream-handlers'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('attachStreamHandlers — ANSI strip + TUI filter + text dedup (T1992)', () => {
  let proc: FakeProc
  const WC_ID = 1
  const AGENT_ID = 'agent-t1992'

  beforeEach(() => {
    vi.clearAllMocks()
    proc = new FakeProc()
    mockAgents.clear()
    mockWebContentsAgents.clear()
    mockAgents.set(AGENT_ID, proc)
    mockWebContentsAgents.set(WC_ID, new Set([AGENT_ID]))
    mockWebContentsFromId.mockReturnValue(makeFakeWc(WC_ID))
  })

  function attach(cli = 'opencode', parseLine?: (line: string) => unknown) {
    attachStreamHandlers({
      proc,
      id: AGENT_ID,
      wcId: WC_ID,
      adapter: makeAdapter(cli, parseLine) as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      spCleanup: undefined,
      settingsTempFile: undefined,
      scriptTempFile: undefined,
      sessionId: undefined,
      projectPath: undefined,
      dbPath: undefined,
      agentAdapters: new Map(),
    })
  }

  function writeLine(stream: PassThrough, line: string) {
    stream.write(line + '\n')
  }

  async function flush() {
    await new Promise(resolve => setImmediate(resolve))
  }

  // ── ANSI strip ────────────────────────────────────────────────────────────

  it('strips ANSI sequences from stderr before pushing event', async () => {
    attach('opencode')
    writeLine(proc.stderr, '\x1b[31mAPI key invalid\x1b[0m')
    await flush()
    expect(mockPushStreamEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      { type: 'error', text: '[stderr] API key invalid' }
    )
  })

  it('strips ANSI from non-opencode adapters too (codex)', async () => {
    attach('codex')
    writeLine(proc.stderr, '\x1b[0msome error\x1b[0m')
    await flush()
    expect(mockPushStreamEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      { type: 'error', text: '[stderr] some error' }
    )
  })

  // ── TUI filter (opencode-only) ────────────────────────────────────────────

  it('drops opencode TUI line starting with → after ANSI strip', async () => {
    attach('opencode')
    writeLine(proc.stderr, '\x1b[0m→ \x1b[0mRead package.json')
    await flush()
    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  it('drops opencode TUI line starting with $', async () => {
    attach('opencode')
    writeLine(proc.stderr, '$ node scripts/dbq.js "SELECT 1"')
    await flush()
    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  it('drops opencode TUI line starting with ●', async () => {
    attach('opencode')
    writeLine(proc.stderr, '● some status marker')
    await flush()
    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  it('drops opencode TUI line starting with ◆', async () => {
    attach('opencode')
    writeLine(proc.stderr, '◆ another marker')
    await flush()
    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  it('keeps real error lines for opencode (not matching TUI prefix)', async () => {
    attach('opencode')
    writeLine(proc.stderr, 'spawnSync C:\\WINDOWS\\system32\\cmd.exe ENOBUFS')
    await flush()
    expect(mockPushStreamEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      expect.objectContaining({ type: 'error', text: expect.stringContaining('ENOBUFS') })
    )
  })

  it('does not apply TUI filter for non-opencode adapters (→ passes through)', async () => {
    attach('codex')
    writeLine(proc.stderr, '→ some codex output')
    await flush()
    expect(mockPushStreamEvent).toHaveBeenCalledWith(
      AGENT_ID, WC_ID,
      { type: 'error', text: '[stderr] → some codex output' }
    )
  })

  it('drops empty lines after ANSI strip', async () => {
    attach('opencode')
    writeLine(proc.stderr, '\x1b[0m')
    await flush()
    expect(mockPushStreamEvent).not.toHaveBeenCalled()
  })

  // ── Text event deduplication ───────────────────────────────────────────────

  it('pushes first text event normally', async () => {
    const parseLine = vi.fn().mockReturnValue({ type: 'text', text: 'Hello', session_id: 'sid1' })
    attach('opencode', parseLine)
    writeLine(proc.stdout, '{"type":"text","text":"Hello","session_id":"sid1"}')
    await flush()
    const textCalls = mockPushStreamEvent.mock.calls.filter(
      ([, , ev]) => ev.type === 'text'
    )
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0][2]).toMatchObject({ text: 'Hello' })
  })

  it('skips exact duplicate consecutive text events for same session_id', async () => {
    const parseLine = vi.fn().mockReturnValue({ type: 'text', text: 'Hello world', session_id: 'sid1' })
    attach('opencode', parseLine)
    writeLine(proc.stdout, 'line1')
    writeLine(proc.stdout, 'line2')
    await flush()
    const textCalls = mockPushStreamEvent.mock.calls.filter(
      ([, , ev]) => ev.type === 'text'
    )
    expect(textCalls).toHaveLength(1)
  })

  it('pushes extension text events (new text is longer than last)', async () => {
    let callCount = 0
    const parseLine = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return { type: 'text', text: 'Hello', session_id: 'sid1' }
      return { type: 'text', text: 'Hello world', session_id: 'sid1' }
    })
    attach('opencode', parseLine)
    writeLine(proc.stdout, 'line1')
    writeLine(proc.stdout, 'line2')
    await flush()
    const textCalls = mockPushStreamEvent.mock.calls.filter(
      ([, , ev]) => ev.type === 'text'
    )
    expect(textCalls).toHaveLength(2)
    expect(textCalls[1][2]).toMatchObject({ text: 'Hello world' })
  })

  it('skips regression text events (new text is prefix of last push)', async () => {
    let callCount = 0
    const parseLine = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return { type: 'text', text: 'Hello world', session_id: 'sid1' }
      return { type: 'text', text: 'Hello', session_id: 'sid1' }
    })
    attach('opencode', parseLine)
    writeLine(proc.stdout, 'line1')
    writeLine(proc.stdout, 'line2')
    await flush()
    const textCalls = mockPushStreamEvent.mock.calls.filter(
      ([, , ev]) => ev.type === 'text'
    )
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0][2]).toMatchObject({ text: 'Hello world' })
  })

  it('dedup is per session_id — different sessions push independently', async () => {
    let callCount = 0
    const parseLine = vi.fn().mockImplementation(() => {
      callCount++
      const sid = callCount <= 2 ? 'sid1' : 'sid2'
      return { type: 'text', text: 'Hello', session_id: sid }
    })
    attach('opencode', parseLine)
    writeLine(proc.stdout, 'l1')
    writeLine(proc.stdout, 'l2') // dup for sid1
    writeLine(proc.stdout, 'l3') // first for sid2 → should push
    await flush()
    const textCalls = mockPushStreamEvent.mock.calls.filter(
      ([, , ev]) => ev.type === 'text'
    )
    expect(textCalls).toHaveLength(2)
  })

  it('dedup map is independent per attachStreamHandlers call (re-spawn isolation)', async () => {
    const parseLine = vi.fn().mockReturnValue({ type: 'text', text: 'Hello', session_id: 'sid1' })

    // First handler instance
    attach('opencode', parseLine)
    writeLine(proc.stdout, 'line1')
    await flush()

    // Second handler instance on new proc — fresh dedup state
    const proc2 = new FakeProc()
    mockAgents.set(AGENT_ID, proc2)
    attachStreamHandlers({
      proc: proc2,
      id: AGENT_ID,
      wcId: WC_ID,
      adapter: makeAdapter('opencode', parseLine) as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      spCleanup: undefined,
      settingsTempFile: undefined,
      scriptTempFile: undefined,
      sessionId: undefined,
      projectPath: undefined,
      dbPath: undefined,
      agentAdapters: new Map(),
    })
    writeLine(proc2.stdout, 'line1')
    await flush()

    const textCalls = mockPushStreamEvent.mock.calls.filter(
      ([, , ev]) => ev.type === 'text'
    )
    // Both handler instances push "Hello" independently (fresh map per call)
    expect(textCalls).toHaveLength(2)
  })
})
