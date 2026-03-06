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
    await handler(event, {})

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
    expect(scriptCall).toBeTruthy()
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
    await handler(event, { projectPath: 'C:\\Users\\foo\\project' })

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
    expect(id).toBeTruthy()
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
    // Allow readline 'line' event to propagate
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, payload)
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

    // Should emit both agent:convId and agent:stream
    expect(mockSender.send).toHaveBeenCalledWith(`agent:convId:${id}`, sessionId)
    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, initEvent)
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

  it('forwards spawn error as error:spawn event to renderer', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    mockProc.emit('error', new Error('spawn ENOENT'))
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, {
      type: 'error:spawn',
      error: 'spawn ENOENT',
    })
  })

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

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, {
      type: 'error:exit',
      error: 'Process exited with code 1',
      stderr: 'bash: command not found: claude',
    })
  })

  it('includes non-JSON stdout in error:exit message when process exits non-zero (Windows PS1 path)', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    // Simulate PS1 script: Write-Output "ERROR: 'claude' not found..." then exit 1
    mockProc.stdout.write("ERROR: 'claude' not found in PATH: C:\\Windows\\System32\n")
    await new Promise(resolve => setImmediate(resolve))

    mockProc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    const call = vi.mocked(mockSender.send).mock.calls.find(
      ([ch]) => ch === `agent:stream:${id}`
    )
    expect(call).toBeTruthy()
    const payload = call![1] as { type: string; error: string }
    expect(payload.type).toBe('error:exit')
    expect(payload.error).toContain('Process exited with code 1')
    expect(payload.error).toContain("ERROR: 'claude' not found in PATH")
  })

  it('emits error:exit when process exits with code 0 without any stream event', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    // No stdout events — process exits cleanly (code 0) but without producing any JSONL (T704)
    mockProc.emit('close', 0)
    await new Promise(resolve => setImmediate(resolve))

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, {
      type: 'error:exit',
      error: 'Process exited without producing any output (code 0)',
      stderr: undefined,
    })
  })

  it('does not emit error:exit when process exits non-zero after receiving events', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    const id = (await handler(event, {})) as string

    // Emit one valid JSONL event first
    const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
    mockProc.stdout.write(JSON.stringify(payload) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    vi.mocked(mockSender.send).mockClear()

    // Now process exits non-zero
    mockProc.emit('close', 1)
    await new Promise(resolve => setImmediate(resolve))

    const errorExitCalls = vi.mocked(mockSender.send).mock.calls.filter(
      ([, payload]) => (payload as { type?: string })?.type === 'error:exit'
    )
    expect(errorExitCalls).toHaveLength(0)
  })

  // ── env forwarding ────────────────────────────────────────────────────────

  it('does not forward ANTHROPIC_API_KEY — auth is via OAuth in ~/.claude/', () => {
    process.env.ANTHROPIC_API_KEY = 'should-not-appear'
    const env = agentStream._testing.buildEnv()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    delete process.env.ANTHROPIC_API_KEY
  })

  it('forwards PATH to process env', () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/usr/bin:/usr/local/bin'
    const env = agentStream._testing.buildEnv()
    expect(env.PATH).toBe('/usr/bin:/usr/local/bin')
    process.env.PATH = originalPath
  })

  it('sets TERM=dumb and NO_COLOR=1', () => {
    const env = agentStream._testing.buildEnv()
    expect(env.TERM).toBe('dumb')
    expect(env.NO_COLOR).toBe('1')
  })

  // ── buildClaudeCmd ────────────────────────────────────────────────────────

  it('buildClaudeCmd includes --resume when convId provided', () => {
    const cmd = agentStream._testing.buildClaudeCmd({
      convId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(cmd).toContain('--resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('buildClaudeCmd includes --dangerously-skip-permissions when permissionMode=auto', () => {
    const cmd = agentStream._testing.buildClaudeCmd({ permissionMode: 'auto' })
    expect(cmd).toContain('--dangerously-skip-permissions')
  })

  it('buildClaudeCmd includes --settings alwaysThinkingEnabled:false when thinkingMode=disabled', () => {
    const cmd = agentStream._testing.buildClaudeCmd({ thinkingMode: 'disabled' })
    expect(cmd).toContain('alwaysThinkingEnabled')
    expect(cmd).toContain('false')
  })

  it('buildClaudeCmd passes systemPromptFile using $(cat ...) substitution', () => {
    const cmd = agentStream._testing.buildClaudeCmd({ systemPromptFile: '/tmp/claude-sp-1.txt' })
    expect(cmd).toContain('--append-system-prompt')
    // Must use $(cat '...') — no ANSI-C $'...' quoting, no base64
    expect(cmd).toContain("$(cat '/tmp/claude-sp-1.txt')")
    expect(cmd).not.toContain("$'")
    expect(cmd).not.toContain('base64')
  })

  it('buildClaudeCmd does not include --append-system-prompt when no systemPromptFile', () => {
    const cmd = agentStream._testing.buildClaudeCmd({})
    expect(cmd).not.toContain('--append-system-prompt')
  })

  it('buildClaudeCmd uses custom claudeCommand', () => {
    const cmd = agentStream._testing.buildClaudeCmd({ claudeCommand: 'claude-dev' })
    expect(cmd.startsWith('claude-dev')).toBe(true)
  })

  it('buildClaudeCmd rejects invalid claudeCommand', () => {
    // Invalid command should fall back to 'claude'
    const cmd = agentStream._testing.buildClaudeCmd({ claudeCommand: 'rm -rf /' })
    expect(cmd.startsWith('claude ')).toBe(true)
  })

  // ── toWslPath ─────────────────────────────────────────────────────────────

  it('toWslPath converts Windows paths to WSL mount paths', () => {
    expect(toWslPath('C:\\Users\\foo')).toBe('/mnt/c/Users/foo')
    expect(toWslPath('D:\\projects\\bar')).toBe('/mnt/d/projects/bar')
    expect(toWslPath('/already/unix')).toBe('/already/unix')
  })

  // ── T772: active tasks context injection ─────────────────────────────────

  describe('T772: getActiveTasksLine', () => {
    it('returns empty string when no active tasks', async () => {
      mockQueryLive.mockResolvedValueOnce([])
      const result = await agentStream._testing.getActiveTasksLine('/fake/project.db', 1)
      expect(result).toBe('')
    })

    it('returns compact "Active tasks: #N #M" line for active tasks', async () => {
      mockQueryLive.mockResolvedValueOnce([{ id: 42 }, { id: 67 }])
      const result = await agentStream._testing.getActiveTasksLine('/fake/project.db', 5)
      expect(result).toBe('Active tasks: #42 #67')
    })

    it('returns empty string when queryLive throws', async () => {
      mockQueryLive.mockRejectedValueOnce(new Error('DB error'))
      const result = await agentStream._testing.getActiveTasksLine('/fake/project.db', 1)
      expect(result).toBe('')
    })

    it('returns single task ID for one active session', async () => {
      mockQueryLive.mockResolvedValueOnce([{ id: 99 }])
      const result = await agentStream._testing.getActiveTasksLine('/fake/project.db', 1)
      expect(result).toBe('Active tasks: #99')
    })
  })

  describe('T772: agent:create injects active tasks into system prompt', () => {
    it('does NOT inject when no dbPath provided', async () => {
      const handler = handlers.get('agent:create')!
      const event = { sender: mockSender }
      await handler(event, { systemPrompt: 'Base prompt' })

      const spCall = mockWriteFileSync.mock.calls.find(([p]: [unknown]) => String(p).includes('claude-sp'))
      expect(spCall?.[1]).toBe('Base prompt')
      // queryLive must NOT be called
      expect(mockQueryLive).not.toHaveBeenCalled()
    })

    it('appends active tasks line when dbPath + sessionId provided and tasks exist', async () => {
      mockQueryLive.mockResolvedValueOnce([{ id: 42 }, { id: 67 }])
      const handler = handlers.get('agent:create')!
      const event = { sender: mockSender }
      await handler(event, { systemPrompt: 'Base prompt', dbPath: '/fake/project.db', sessionId: 5 })

      const spCall = mockWriteFileSync.mock.calls.find(([p]: [unknown]) => String(p).includes('claude-sp'))
      expect(spCall?.[1]).toBe('Base prompt\n\nActive tasks: #42 #67')
    })

    it('does not append when no active tasks', async () => {
      mockQueryLive.mockResolvedValueOnce([])
      const handler = handlers.get('agent:create')!
      const event = { sender: mockSender }
      await handler(event, { systemPrompt: 'Base prompt', dbPath: '/fake/project.db', sessionId: 5 })

      const spCall = mockWriteFileSync.mock.calls.find(([p]: [unknown]) => String(p).includes('claude-sp'))
      expect(spCall?.[1]).toBe('Base prompt')
    })

    it('does not block spawn if DB injection fails (invalid sessionId)', async () => {
      const handler = handlers.get('agent:create')!
      const event = { sender: mockSender }
      // sessionId = -1 → guard fails → no queryLive → spawn still happens
      const id = await handler(event, { systemPrompt: 'Base prompt', dbPath: '/fake/project.db', sessionId: -1 })
      expect(typeof id).toBe('string')
      expect(mockSpawn).toHaveBeenCalledOnce()
    })
  })
})
