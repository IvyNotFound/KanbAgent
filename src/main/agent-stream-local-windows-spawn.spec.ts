/**
 * Tests for agent:create — local Windows spawn integration (T916).
 *
 * Verifies:
 * - agent:create with wslDistro='local' on win32 spawns powershell.exe (not wsl.exe)
 * - WSL path is not used for projectPath (cwd option instead)
 * - Settings JSON temp file creation and cleanup (T1107)
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

const senderRegistry = vi.hoisted(() => new Map<number, {
  id: number
  once: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}>())

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { on: vi.fn(), getPath: vi.fn().mockReturnValue('/tmp') },
  webContents: {
    fromId: vi.fn((id: number) => senderRegistry.get(id) ?? null),
  },
}))

const mockStdin = { write: vi.fn(), end: vi.fn() }

class FakeProc extends EventEmitter {
  stdin = mockStdin
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 12345
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

// ── agent:create local Windows spawn integration ──────────────────────────────

import * as agentStream from './agent-stream'

describe('agent:create — local Windows spawn (T916)', () => {
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

    // Override process.platform to 'win32' for these tests
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    handlers = new Map()
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    })

    agentStream.registerAgentStreamHandlers()

    mockSender = {
      id: 99,
      once: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      send: vi.fn(),
    }
    senderRegistry.set(99, mockSender)

    const { webContents } = await import('electron')
    vi.mocked(webContents.fromId).mockImplementation((id: number) => senderRegistry.get(id) ?? null)
  })

  afterEach(() => {
    // Restore process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    senderRegistry.clear()
    agentStream._testing.agents.clear()
    agentStream._testing.webContentsAgents.clear()
  })

  it('spawns powershell.exe (not wsl.exe) when wslDistro=local on win32', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local' })

    const [cmd] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(cmd.toLowerCase()).toContain('powershell')
    expect(cmd.toLowerCase()).not.toContain('wsl')
  })

  it('passes -NoProfile -ExecutionPolicy Bypass -File <script.ps1>', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local' })

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toContain('-NoProfile')
    expect(args).toContain('-ExecutionPolicy')
    expect(args).toContain('Bypass')
    expect(args).toContain('-File')

    const scriptPath = args[args.indexOf('-File') + 1]
    expect(scriptPath).toMatch(/claude-start-\d+\.ps1$/)
  })

  it('writes a .ps1 script containing the claude command', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local' })

    const ps1Call = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start') && String(p).endsWith('.ps1')
    )
    expect(ps1Call).toBeDefined()
    const content = String(ps1Call![1])
    expect(content).toContain('--output-format')
    expect(content).toContain('stream-json')
    expect(content).toContain('& $claudeExe @a')
  })

  it('uses cwd (projectPath) instead of --cd for local Windows', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local', projectPath: 'C:\\Users\\foo\\project' })

    const [, args, spawnOpts] = mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(spawnOpts.cwd).toBe('C:\\Users\\foo\\project')
    // --cd is a wsl.exe arg — must not appear for local Windows
    expect(args).not.toContain('--cd')
  })

  it('writes system prompt to temp file and references it in .ps1 script', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local', systemPrompt: 'You are a helpful agent.' })

    const ps1Call = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start') && String(p).endsWith('.ps1')
    )
    const content = String(ps1Call![1])
    expect(content).toContain('ReadAllText')
    expect(content).toContain('--append-system-prompt')
    // Path must NOT be a WSL path (/mnt/...) — should be a Windows temp path
    expect(content).not.toContain('/mnt/')
  })

  it('does not use wsl.exe when wslDistro=local on win32 (regression guard)', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local' })

    const [cmd] = mockSpawn.mock.calls[0] as [string]
    expect(cmd.toLowerCase()).not.toMatch(/wsl\.exe/)
  })

  it('still uses wsl.exe for non-local distro on win32', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'Ubuntu' })

    const [cmd] = mockSpawn.mock.calls[0] as [string]
    expect(cmd.toLowerCase()).toMatch(/wsl\.exe$/)
  })

  it('uses wsl.exe (default distro) when wslDistro is undefined on win32', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, {})

    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(cmd.toLowerCase()).toMatch(/wsl\.exe$/)
    // No -d flag — uses WSL default distro
    expect(args).not.toContain('-d')
  })

  it('returns a string agent id', async () => {
    const handler = handlers.get('agent:create')!
    const id = await handler({ sender: mockSender }, { wslDistro: 'local' })
    expect(typeof id).toBe('string')
    expect((id as string).length).toBeGreaterThan(0)
  })

  it('writes settings JSON to temp file and PS1 passes path directly to --settings when thinkingMode=disabled (T1195)', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local', thinkingMode: 'disabled' })

    // Settings temp file must be written
    const settingsCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-settings') && String(p).endsWith('.json')
    )
    expect(settingsCall).toBeDefined()
    expect(settingsCall![1]).toBe('{"alwaysThinkingEnabled":false}')
    const settingsPath = String(settingsCall![0])

    // PS1 script must pass the file path directly to --settings (not via ReadAllText)
    const ps1Call = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start') && String(p).endsWith('.ps1')
    )
    const content = String(ps1Call![1])
    expect(content).toContain("$a.Add('--settings')")
    expect(content).toContain(settingsPath)
    expect(content).not.toContain('ReadAllText')
    expect(content).not.toContain('$settingsJson')
    expect(content).not.toContain("$a.Add('{\"alwaysThinkingEnabled\":false}')")
  })

  it('cleans up settings temp file on process close (T1107)', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local', thinkingMode: 'disabled' })

    // Find the settings temp file path
    const settingsCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-settings') && String(p).endsWith('.json')
    )
    const settingsPath = String(settingsCall![0])

    // Emit a stream event so eventsReceived > 0 (avoids error:exit branch)
    const payload = { type: 'assistant', message: { role: 'assistant', content: [] } }
    mockProc.stdout.write(JSON.stringify(payload) + '\n')
    await new Promise(resolve => setImmediate(resolve))

    mockProc.emit('close', 0)
    await new Promise(resolve => setImmediate(resolve))

    // Settings temp file must be cleaned up
    expect(mockUnlinkSync).toHaveBeenCalledWith(settingsPath)
  })

  it('does NOT create settings temp file when thinkingMode is not disabled (T1107)', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local' })

    const settingsCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-settings') && String(p).endsWith('.json')
    )
    expect(settingsCall).toBeUndefined()
  })

  // ── singleShotStdin stdin close (T1244) ───────────────────────────────────

  it('closes stdin immediately for opencode with initialMessage (local Windows, T1244)', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, {
      wslDistro: 'local',
      cli: 'opencode',
      initialMessage: 'fix the bug',
    })
    expect(mockStdin.end).toHaveBeenCalledOnce()
  })

  it('does NOT close stdin for claude with initialMessage (no singleShotStdin)', async () => {
    const handler = handlers.get('agent:create')!
    // Claude is the default adapter — singleShotStdin is falsy
    await handler({ sender: mockSender }, { wslDistro: 'local', initialMessage: 'hello' })
    expect(mockStdin.end).not.toHaveBeenCalled()
  })

  it('does NOT close stdin for opencode without initialMessage (stdin needed for agent:send)', async () => {
    const handler = handlers.get('agent:create')!
    await handler({ sender: mockSender }, { wslDistro: 'local', cli: 'opencode' })
    expect(mockStdin.end).not.toHaveBeenCalled()
  })
})
