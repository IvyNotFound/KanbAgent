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

vi.mock('fs', () => {
  const fns = {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    appendFileSync: mockAppendFileSync,
  }
  return { default: fns, ...fns }
})

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

  describe('convId validation', () => {
    it('passes valid UUID as convId to buildClaudeCmd (--resume flag present)', async () => {
      const handler = handlers.get('agent:create')!
      const validUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      await handler({ sender: mockSender }, { convId: validUuid })

      const scriptCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('claude-start')
      )!
      expect(String(scriptCall[1])).toContain(`--resume ${validUuid}`)
    })

    it('ignores convId that does not match UUID_REGEX (no --resume in script)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { convId: 'not-a-uuid' })

      const scriptCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('claude-start')
      )!
      expect(String(scriptCall[1])).not.toContain('--resume')
    })

    it('ignores convId when it is an empty string (falsy guard)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { convId: '' })

      const scriptCall = mockWriteFileSync.mock.calls.find(
        ([p]: [unknown]) => String(p).includes('claude-start')
      )!
      expect(String(scriptCall[1])).not.toContain('--resume')
    })
  })

  // ── sessionId guard (L164) ─────────────────────────────────────────────────

  describe('sessionId guard for active tasks injection', () => {
    it('does not call queryLive when sessionId=0 (> 0 guard)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { dbPath: '/fake/project.db', sessionId: 0 })
      expect(mockQueryLive).not.toHaveBeenCalled()
    })

    it('does not call queryLive when sessionId is negative', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { dbPath: '/fake/project.db', sessionId: -5 })
      expect(mockQueryLive).not.toHaveBeenCalled()
    })

    it('does not call queryLive when sessionId is a float (Number.isInteger guard)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { dbPath: '/fake/project.db', sessionId: 1.5 })
      expect(mockQueryLive).not.toHaveBeenCalled()
    })

    it('calls queryLive when dbPath + valid positive integer sessionId provided', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { dbPath: '/fake/project.db', sessionId: 5 })
      // 3 calls: T1356 model resolution (agent + config) + T772 active tasks
      expect(mockQueryLive).toHaveBeenCalledTimes(3)
    })
  })

  // ── worktree guard (L186) ──────────────────────────────────────────────────

  describe('worktree guard', () => {
    it('skips worktree creation when opts.worktree=false', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { projectPath: '/some/project', sessionId: 10, worktree: false })
      expect(mockCreateWorktree).not.toHaveBeenCalled()
    })

    it('skips worktree creation when projectPath is absent', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { sessionId: 10 })
      expect(mockCreateWorktree).not.toHaveBeenCalled()
    })

    it('skips worktree creation when sessionId=0', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { projectPath: '/some/project', sessionId: 0 })
      expect(mockCreateWorktree).not.toHaveBeenCalled()
    })

    it('skips worktree creation when sessionId is negative', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { projectPath: '/some/project', sessionId: -1 })
      expect(mockCreateWorktree).not.toHaveBeenCalled()
    })

    it('creates worktree when projectPath and sessionId > 0 provided', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, { projectPath: 'C:\\projects\\foo', sessionId: 7 })
      expect(mockCreateWorktree).toHaveBeenCalledWith('C:\\projects\\foo', 7)
    })

    it('falls back gracefully (non-fatal) when worktree creation fails', async () => {
      mockCreateWorktree.mockRejectedValueOnce(new Error('git error'))
      const handler = handlers.get('agent:create')!
      const id = await handler({ sender: mockSender }, {
        projectPath: 'C:\\projects\\foo',
        wslDistro: 'Ubuntu',
        sessionId: 7,
      })
      expect(typeof id).toBe('string')
      expect(mockSpawn).toHaveBeenCalledOnce()
    })

    it('uses worktree path as --cd arg when worktree is created', async () => {
      mockCreateWorktree.mockResolvedValueOnce({ path: '/tmp/wt/session-7', branch: 'session-7' })
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {
        projectPath: 'C:\\projects\\foo',
        wslDistro: 'Ubuntu',
        sessionId: 7,
      })

      const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
      const cdIdx = args.indexOf('--cd')
      expect(cdIdx).toBeGreaterThan(-1)
      expect(args[cdIdx + 1]).toBe('/tmp/wt/session-7')
    })

    it('calls removeWorktree on process close when worktree was created', async () => {
      mockCreateWorktree.mockResolvedValueOnce({ path: '/tmp/wt/session-7', branch: 'session-7' })
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {
        projectPath: 'C:\\projects\\foo',
        wslDistro: 'Ubuntu',
        sessionId: 7,
      })

      // Emit a stream event so eventsReceived > 0 (avoids error:exit branch)
      const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
      mockProc.stdout.write(JSON.stringify(payload) + '\n')
      await new Promise(resolve => setImmediate(resolve))

      mockProc.emit('close', 0)
      await new Promise(resolve => setImmediate(resolve))

      expect(mockRemoveWorktree).toHaveBeenCalledWith('C:\\projects\\foo', 7)
    })

    it('injects worktree path and branch into system prompt when worktree is created (T1124)', async () => {
      mockCreateWorktree.mockResolvedValueOnce({ path: '/tmp/wt/session-7', branch: 'session-7' })
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {
        projectPath: 'C:\\projects\\foo',
        systemPrompt: 'Base prompt',
        wslDistro: 'Ubuntu',
        sessionId: 7,
      })

      const spCall = mockWriteFileSync.mock.calls.find(([p]: [unknown]) => String(p).includes('claude-sp'))
      expect(spCall?.[1]).toContain('Worktree: /tmp/wt/session-7 (branch: session-7)')
    })

    it('does not inject worktree info into system prompt when no worktree created (T1124)', async () => {
      const handler = handlers.get('agent:create')!
      await handler({ sender: mockSender }, {
        systemPrompt: 'Base prompt',
        sessionId: 7,
        // no projectPath → no worktree
      })

      const spCall = mockWriteFileSync.mock.calls.find(([p]: [unknown]) => String(p).includes('claude-sp'))
      expect(spCall?.[1]).toBe('Base prompt')
    })
  })

  // ── killAgent: Windows taskkill (L62) ─────────────────────────────────────

  describe('killAgent Windows taskkill (L62)', () => {
    it('calls execFile taskkill /F /PID /T on win32 when agent has a pid', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      const createHandler = handlers.get('agent:create')!
      const killHandler = handlers.get('agent:kill')!
      const id = (await createHandler({ sender: mockSender }, {})) as string
      await killHandler({ sender: mockSender }, id)

      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/F', '/PID', String(mockProc.pid), '/T'],
        expect.any(Function)
      )
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('does NOT call execFile taskkill on linux', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

      const createHandler = handlers.get('agent:create')!
      const killHandler = handlers.get('agent:kill')!
      const id = (await createHandler({ sender: mockSender }, {})) as string
      await killHandler({ sender: mockSender }, id)

      expect(mockExecFile).not.toHaveBeenCalled()
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })
  })

  // ── killAgent: stream batch cleanup (T1851) ──────────────────────────────

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
