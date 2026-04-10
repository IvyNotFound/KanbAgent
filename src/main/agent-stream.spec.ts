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

  it('spawns with stdio:pipe — never PTY', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    await handler(event, {})

    expect(mockSpawn).toHaveBeenCalledOnce()
    const [, , spawnOpts] = mockSpawn.mock.calls[0] as [string, string[], { stdio: unknown }]
    expect(spawnOpts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
  })

  it('spawns wsl.exe with bash -l <script> and claude -p --input-format stream-json (T706)', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    await handler(event, { wslDistro: 'Ubuntu' })

    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]]
    // cmd is now an absolute path (e.g. C:\Windows\System32\wsl.exe or fallback) — check suffix
    expect(cmd.toLowerCase()).toMatch(/wsl\.exe$/)
    // Must contain 'bash', '-l' — never '-lc' (T706: avoid wsl.exe intermediate shell expansion)
    expect(args).toContain('bash')
    expect(args).toContain('-l')
    expect(args).not.toContain('-lc')
    // Last arg is a WSL path to the script file (not the command string)
    const scriptPath = args[args.length - 1]
    expect(scriptPath).toMatch(/claude-start-\d+\.sh$/)
    // Script content contains the full claude command
    const scriptCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start')
    )!
    expect(scriptCall).toBeDefined()
    const scriptContent = String(scriptCall[1])
    expect(scriptContent).toContain('-p')
    expect(scriptContent).toContain('--input-format stream-json')
    expect(scriptContent).toContain('--output-format stream-json')
  })

  it('includes -d <distro> when wslDistro is provided', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    await handler(event, { wslDistro: 'Ubuntu' })

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    const idx = args.indexOf('-d')
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe('Ubuntu')
  })

  it('includes --cd <wslPath> when projectPath is provided', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    await handler(event, { wslDistro: 'Ubuntu', projectPath: 'C:\\Users\\foo\\project' })

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    const idx = args.indexOf('--cd')
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe('/mnt/c/Users/foo/project')
  })

  it('returns the agent id', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = await handler(event, {})
    expect(typeof id).toBe('string')
    expect((id as string).length).toBeGreaterThan(0)
  })

  it('registers process in agents map', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string
    expect(agentStream._testing.agents.has(id)).toBe(true)
  })

  // ── JSONL parsing from stdout ─────────────────────────────────────────────

  it('parses JSONL lines from stdout and emits agent:stream:<id>', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    // Write a JSONL line to stdout (readline will emit 'line')
    const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
    mockProc.stdout.write(JSON.stringify(payload) + '\n')
    // Allow readline 'line' event to propagate, then flush the 32ms batch
    await new Promise(resolve => setImmediate(resolve))
    vi.advanceTimersByTime(32)

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, [payload])
  })

  it('skips non-JSON lines silently', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    mockProc.stdout.write('bash: warning: some shell startup message\n')
    await new Promise(resolve => setImmediate(resolve))

    // No agent:stream event should be emitted for non-JSON
    const streamCalls = vi.mocked(mockSender.send).mock.calls.filter(
      ([ch]) => ch === `agent:stream:${id}`
    )
    expect(streamCalls).toHaveLength(0)
  })

  it('extracts convId from system:init event', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const initEvent = { type: 'system', subtype: 'init', session_id: sessionId }
    mockProc.stdout.write(JSON.stringify(initEvent) + '\n')
    await new Promise(resolve => setImmediate(resolve))
    vi.advanceTimersByTime(32)

    // Should emit both agent:convId and agent:stream (as batch array)
    expect(mockSender.send).toHaveBeenCalledWith(`agent:convId:${id}`, sessionId)
    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, [initEvent])
  })

  it('emits agent:exit:<id> on process close', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    mockProc.emit('close', 0)
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSender.send).toHaveBeenCalledWith(`agent:exit:${id}`, 0)
    expect(agentStream._testing.agents.has(id)).toBe(false)
  })

  // ── Multi-turn via stdin ──────────────────────────────────────────────────

  it('agent:send writes JSONL message to stdin', async () => {
    const createHandler = handlers.get('agent:create')!
    const sendHandler = handlers.get('agent:send')!
    const event = { sender: mockSender }
    const id = (await createHandler(event, {})) as string

    await sendHandler(event, id, 'Hello from user')

    expect(mockStdin.write).toHaveBeenCalledOnce()
    const written = mockStdin.write.mock.calls[0][0] as string
    const parsed = JSON.parse(written.trim())
    expect(parsed.type).toBe('user')
    expect(parsed.message.role).toBe('user')
    expect(parsed.message.content[0].text).toBe('Hello from user')
  })

  it('agent:send throws if id does not exist', () => {
    const sendHandler = handlers.get('agent:send')!
    const event = { sender: mockSender }
    expect(() => sendHandler(event, 'nonexistent', 'text')).toThrow('No active agent process')
  })

  // ── agent:kill ────────────────────────────────────────────────────────────

  it('agent:kill terminates the process', async () => {
    const createHandler = handlers.get('agent:create')!
    const killHandler = handlers.get('agent:kill')!
    const event = { sender: mockSender }
    const id = (await createHandler(event, {})) as string

    await killHandler(event, id)

    expect(mockProc.kill).toHaveBeenCalledOnce()
    expect(agentStream._testing.agents.has(id)).toBe(false)
  })

  it('agent:kill is idempotent on unknown id', () => {
    const killHandler = handlers.get('agent:kill')!
    const event = { sender: mockSender }
    // Should not throw for unknown id
    expect(() => killHandler(event, 'unknown')).not.toThrow()
  })

  // ── agent:permission-respond (T1816) ─────────────────────────────────────

  it('agent:permission-respond calls resolvePermission with correct args', () => {
    const handler = handlers.get('agent:permission-respond')!
    const event = { sender: mockSender }
    const result = handler(event, 'perm_123', 'allow')
    expect(mockResolvePermission).toHaveBeenCalledWith('perm_123', { behavior: 'allow' })
    expect(result).toBe(true)
  })

  it('agent:permission-respond accepts "deny" behavior', () => {
    const handler = handlers.get('agent:permission-respond')!
    const event = { sender: mockSender }
    handler(event, 'perm_456', 'deny')
    expect(mockResolvePermission).toHaveBeenCalledWith('perm_456', { behavior: 'deny' })
  })

  it('agent:permission-respond throws on invalid args', () => {
    const handler = handlers.get('agent:permission-respond')!
    const event = { sender: mockSender }
    expect(() => handler(event, 123, 'allow')).toThrow('agent:permission-respond requires')
    expect(() => handler(event, 'id', 'maybe')).toThrow('agent:permission-respond requires')
    expect(() => handler(event, 'id', '')).toThrow('agent:permission-respond requires')
  })

  it('forwards spawn error as error:spawn event to renderer', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    mockProc.emit('error', new Error('spawn ENOENT'))
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, [{
      type: 'error:spawn',
      error: 'spawn ENOENT',
    }])
  })

})
