/**
 * Tests for agent-stream.ts — child_process.spawn + stdio:pipe approach (ADR-009).
 *
 * Verifies:
 * - spawn is called with stdio:pipe (never PTY)
 * - JSONL is parsed line-by-line from stdout
 * - Multi-turn messages sent via stdin
 * - agent:kill terminates the process
 * - env: PATH and Windows system vars forwarded (auth via OAuth in ~/.claude/)
 * - convId extracted from system:init event
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

// sender registry for webContents.fromId
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

// Mock child_process.spawn — returns a fake ChildProcess-like object
const mockStdin = {
  write: vi.fn(),
}

class FakeProc extends EventEmitter {
  stdin = mockStdin
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

// ── db mock (T772: active tasks context injection) ─────────────────────────────
const mockQueryLive = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockAssertDbPathAllowed = vi.hoisted(() => vi.fn())

vi.mock('./db', () => ({
  queryLive: mockQueryLive,
  assertDbPathAllowed: mockAssertDbPathAllowed,
  registerDbPath: vi.fn(),
  registerProjectPath: vi.fn(),
}))

// ── hookServer mock (T1816) ───────────────────────────────────────────────────
const mockResolvePermission = vi.hoisted(() => vi.fn().mockReturnValue(true))
vi.mock('./hookServer', () => ({
  resolvePermission: mockResolvePermission,
  pendingPermissions: new Map(),
  startHookServer: vi.fn(),
  setHookWindow: vi.fn(),
  HOOK_PORT: 27182,
}))

// ── worktree-manager mock ──────────────────────────────────────────────────────
const mockCreateWorktree = vi.hoisted(() => vi.fn().mockResolvedValue({ path: '/tmp/wt/branch-1', branch: 'session-1' }))
const mockRemoveWorktree = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./worktree-manager', () => ({
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree,
}))

// ── Test setup ────────────────────────────────────────────────────────────────

import * as agentStream from './agent-stream'
import { toWslPath } from './utils/wsl'

describe('agent-stream', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>
  let mockSender: {
    id: number
    once: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.clearAllMocks()
    mockProc = new FakeProc()

    // Collect ipcMain.handle registrations
    handlers = new Map()
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    })

    // Register handlers
    agentStream.registerAgentStreamHandlers()

    // Setup mock sender (webContents)
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
    // Clean up batch timers to avoid leaking intervals
    for (const timer of agentStream._testing.streamTimers.values()) {
      clearInterval(timer)
    }
    agentStream._testing.streamBatches.clear()
    agentStream._testing.streamTimers.clear()
    senderRegistry.clear()
    agentStream._testing.agents.clear()
    agentStream._testing.webContentsAgents.clear()
  })

  // ── spawn mode tests ──────────────────────────────────────────────────────

  it('does not emit error:stderr events — stderr is buffered silently (T697)', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    mockProc.stderr.write('bash: command not found: claude\n')
    await new Promise(resolve => setImmediate(resolve))

    const stderrCalls = vi.mocked(mockSender.send).mock.calls.filter(
      ([, payload]) => (payload as { type?: string })?.type === 'error:stderr'
    )
    expect(stderrCalls).toHaveLength(0)
  })

  it('emits error:exit with stderr buffer when process exits non-zero without any stream event', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    // Write stderr before closing — should appear in error:exit payload (T697)
    mockProc.stderr.write('bash: command not found: claude\n')
    await new Promise(resolve => setImmediate(resolve))

    // No stdout events emitted — process exits with code 1
    mockProc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, [{
      type: 'error:exit',
      error: 'Process exited with code 1',
      stderr: 'bash: command not found: claude',
    }])
  })

  // ── Non-Claude stderr forwarding (T1248) ──────────────────────────────────

  it('non-Claude: stderr lines forwarded in real time as error events (T1248)', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, { cli: 'opencode' })) as string

    mockProc.stderr.write('API key not found\n')
    await new Promise(resolve => setImmediate(resolve))
    vi.advanceTimersByTime(32)

    const streamCalls = vi.mocked(mockSender.send).mock.calls.filter(
      ([ch]) => ch === `agent:stream:${id}`
    )
    expect(streamCalls.length).toBeGreaterThan(0)
    const events = streamCalls.flatMap(([, payload]) => payload as unknown[])
    expect(events).toContainEqual({ type: 'error', text: '[stderr] API key not found' })
  })

  it('non-Claude: empty stderr lines are filtered out', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, { cli: 'opencode' })) as string

    mockProc.stderr.write('   \n\n')
    await new Promise(resolve => setImmediate(resolve))
    vi.advanceTimersByTime(32)

    const streamCalls = vi.mocked(mockSender.send).mock.calls.filter(
      ([ch]) => ch === `agent:stream:${id}`
    )
    expect(streamCalls).toHaveLength(0)
  })

  it('non-Claude: stderr increments eventsReceived — no redundant error:exit when only stderr received', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, { cli: 'opencode' })) as string

    mockProc.stderr.write('Some stderr output\n')
    await new Promise(resolve => setImmediate(resolve))
    vi.advanceTimersByTime(32)

    // Process exits with code 1 — but eventsReceived > 0, so no error:exit
    mockProc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    const allCalls = vi.mocked(mockSender.send).mock.calls
    const errorExitCalls = allCalls.filter(
      ([, payload]) => Array.isArray(payload) && payload.some((e: unknown) =>
        (e as { type?: string })?.type === 'error:exit'
      )
    )
    expect(errorExitCalls).toHaveLength(0)
  })

})
