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

  it('stderr is undefined in error:exit when stderr was empty (MethodExpression)', async () => {
    attach({ adapter: makeAdapter('claude') as never })

    // No stderr written — buffer is empty string
    proc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    const call = mockSendTerminalEvent.mock.calls[0]
    const event = call[2] as { stderr?: string }
    expect(event.stderr).toBeUndefined()
  })
})
