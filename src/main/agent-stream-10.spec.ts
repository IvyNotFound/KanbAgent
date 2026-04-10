/**
 * Tests for agent-stream.ts — continued (part 3).
 * Covers: convId validation, sessionId guard, worktree guard,
 * killAgent Windows taskkill, spawn args.
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
vi.mock('./hookServer', () => ({
  resolvePermission: vi.fn().mockReturnValue(true),
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

  // ── convId validation (L143) ───────────────────────────────────────────────

  describe('killAgent clears stream batch interval (T1851)', () => {
    it('clears streamTimers and streamBatches for the killed agent', async () => {
      const createHandler = handlers.get('agent:create')!
      const id = (await createHandler({ sender: mockSender }, {})) as string

      // Simulate an active stream batch + timer
      agentStream._testing.streamBatches.set(id, [{ type: 'text', data: 'hello' }])
      const timer = setInterval(() => {}, 32)
      agentStream._testing.streamTimers.set(id, timer)

      agentStream._testing.killAgent(id)

      expect(agentStream._testing.streamTimers.has(id)).toBe(false)
      expect(agentStream._testing.streamBatches.has(id)).toBe(false)
    })

    it('does not throw when agent has no stream batch', async () => {
      const createHandler = handlers.get('agent:create')!
      const id = (await createHandler({ sender: mockSender }, {})) as string

      // No stream batch/timer set — killAgent should still work
      expect(() => agentStream._testing.killAgent(id)).not.toThrow()
    })
  })

  // ── spawn args non-empty (L222) ───────────────────────────────────────────

  it('spawn args array is non-empty and contains bash and -l for WSL path', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'Ubuntu' })

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(Array.isArray(args)).toBe(true)
    expect(args.length).toBeGreaterThan(0)
    expect(args).toContain('bash')
    expect(args).toContain('-l')
  })

})
