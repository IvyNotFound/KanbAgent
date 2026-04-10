/**
 * Tests for agent-stream.ts — continued (part 2).
 * Covers: error:exit edge cases, env forwarding, buildClaudeCmd, toWslPath,
 * T772 getActiveTasksLine, T772 agent:create active tasks injection.
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
    expect(call).toBeDefined()
    // Terminal events are sent as arrays — extract first element
    const batch = call![1] as Array<{ type: string; error: string }>
    const payload = Array.isArray(batch) ? batch[0] : batch
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

    expect(mockSender.send).toHaveBeenCalledWith(`agent:stream:${id}`, [{
      type: 'error:exit',
      error: 'Process exited without producing any output (code 0)',
      stderr: undefined,
    }])
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
    const cmd = agentStream._testing.buildClaudeCmd({ systemPromptFile: '/tmp/ka-sp-1.txt' })
    expect(cmd).toContain('--append-system-prompt')
    // Must use $(cat '...') — no ANSI-C $'...' quoting, no base64
    expect(cmd).toContain("$(cat '/tmp/ka-sp-1.txt')")
    expect(cmd).not.toContain("$'")
    expect(cmd).not.toContain('base64')
  })

  it('buildClaudeCmd does not include --append-system-prompt when no systemPromptFile', () => {
    const cmd = agentStream._testing.buildClaudeCmd({})
    expect(cmd).not.toContain('--append-system-prompt')
  })

  it('buildClaudeCmd uses custom customBinaryName', () => {
    const cmd = agentStream._testing.buildClaudeCmd({ customBinaryName: 'claude-dev' })
    expect(cmd.startsWith('claude-dev')).toBe(true)
  })

  it('buildClaudeCmd rejects invalid customBinaryName', () => {
    // Invalid command should fall back to 'claude'
    const cmd = agentStream._testing.buildClaudeCmd({ customBinaryName: 'rm -rf /' })
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

      const spCall = mockWriteFile.mock.calls.find(([p]: [unknown]) => String(p).includes('ka-sp'))
      expect(spCall?.[1]).toBe('Base prompt')
      // queryLive must NOT be called
      expect(mockQueryLive).not.toHaveBeenCalled()
    })

    it('appends active tasks line when dbPath + sessionId provided and tasks exist', async () => {
      // T1356: model resolution queries run first (agent preferred_model, then config)
      mockQueryLive.mockResolvedValueOnce([]) // model: agent preferred_model → null
      mockQueryLive.mockResolvedValueOnce([]) // model: opencode_default_model → null
      mockQueryLive.mockResolvedValueOnce([{ id: 42 }, { id: 67 }]) // active tasks
      const handler = handlers.get('agent:create')!
      const event = { sender: mockSender }
      await handler(event, { systemPrompt: 'Base prompt', dbPath: '/fake/project.db', sessionId: 5 })

      const spCall = mockWriteFile.mock.calls.find(([p]: [unknown]) => String(p).includes('ka-sp'))
      expect(spCall?.[1]).toBe('Base prompt\n\nActive tasks: #42 #67')
    })

    it('does not append when no active tasks', async () => {
      mockQueryLive.mockResolvedValueOnce([])
      const handler = handlers.get('agent:create')!
      const event = { sender: mockSender }
      await handler(event, { systemPrompt: 'Base prompt', dbPath: '/fake/project.db', sessionId: 5 })

      const spCall = mockWriteFile.mock.calls.find(([p]: [unknown]) => String(p).includes('ka-sp'))
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
