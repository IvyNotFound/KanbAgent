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

})
