/**
 * Tests for agent-stream.ts — child_process.spawn + stdio:pipe approach (ADR-009).
 *
 * Verifies:
 * - spawn is called with stdio:pipe (never PTY)
 * - JSONL is parsed line-by-line from stdout
 * - Multi-turn messages sent via stdin
 * - agent:kill terminates the process
 * - env: ANTHROPIC_API_KEY and PATH forwarded
 * - convId extracted from system:init event
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

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

  it('spawns wsl.exe with bash -lc and claude -p --input-format stream-json', async () => {
    const handler = handlers.get('agent:create')!
    const event = { sender: mockSender }
    await handler(event, {})

    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(cmd).toBe('wsl.exe')
    // Must contain 'bash', '-lc'
    expect(args).toContain('bash')
    expect(args).toContain('-lc')
    // The claude command string
    const claudeCmd = args[args.length - 1]
    expect(claudeCmd).toContain('-p')
    expect(claudeCmd).toContain('--input-format stream-json')
    expect(claudeCmd).toContain('--output-format stream-json')
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

  // ── env forwarding ────────────────────────────────────────────────────────

  it('forwards ANTHROPIC_API_KEY to process env', () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key-123'
    const env = agentStream._testing.buildEnv()
    expect(env.ANTHROPIC_API_KEY).toBe('test-key-123')
    process.env.ANTHROPIC_API_KEY = originalKey
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

  it('buildClaudeCmd base64-encodes systemPrompt', () => {
    const cmd = agentStream._testing.buildClaudeCmd({ systemPrompt: 'You are a helpful assistant.' })
    // Should contain base64 of 'You are a helpful assistant.'
    const b64 = Buffer.from('You are a helpful assistant.').toString('base64')
    expect(cmd).toContain(b64)
    expect(cmd).toContain('--append-system-prompt')
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
    expect(agentStream._testing.toWslPath('C:\\Users\\foo')).toBe('/mnt/c/Users/foo')
    expect(agentStream._testing.toWslPath('D:\\projects\\bar')).toBe('/mnt/d/projects/bar')
    expect(agentStream._testing.toWslPath('/already/unix')).toBe('/already/unix')
  })
})
