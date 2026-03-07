/**
 * Tests for agent-stream.ts — local Windows native spawn path (T916).
 *
 * Verifies:
 * - buildWindowsPS1Script generates correct PowerShell script
 * - agent:create with wslDistro='local' on win32 spawns powershell.exe (not wsl.exe)
 * - System prompt is passed via temp file read in PS1 (no $(cat ...) bash syntax)
 * - WSL path is not used for projectPath (cwd option instead)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { buildWindowsPS1Script } from './agent-stream-helpers'

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

const mockStdin = { write: vi.fn() }

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

// ── buildWindowsPS1Script unit tests ─────────────────────────────────────────

describe('buildWindowsPS1Script', () => {
  it('includes required claude args', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain("$a.Add('-p')")
    expect(script).toContain("$a.Add('--verbose')")
    expect(script).toContain("$a.Add('stream-json')")
    expect(script).toContain('--output-format')
    expect(script).toContain('--input-format')
  })

  it('ends with & $claudeExe @a invocation (T939)', () => {
    const script = buildWindowsPS1Script({})
    expect(script.trimEnd()).toMatch(/^\& \$claudeExe @a$/m)
  })

  it('uses custom claudeCommand in Get-Command when valid (T939)', () => {
    const script = buildWindowsPS1Script({ claudeCommand: 'claude-dev' })
    expect(script).toContain('Get-Command claude-dev')
    expect(script.trimEnd()).toMatch(/^\& \$claudeExe @a$/m)
  })

  it('falls back to claude in Get-Command for invalid claudeCommand (T939)', () => {
    const script = buildWindowsPS1Script({ claudeCommand: 'rm -rf /' })
    expect(script).toContain('Get-Command claude')
    expect(script.trimEnd()).toMatch(/^\& \$claudeExe @a$/m)
  })

  it('adds --resume with convId', () => {
    const script = buildWindowsPS1Script({ convId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    expect(script).toContain("$a.Add('--resume')")
    expect(script).toContain("$a.Add('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')")
  })

  it('reads system prompt from file via ReadAllText (no $(cat ...) bash syntax)', () => {
    const script = buildWindowsPS1Script({ spTempFile: 'C:\\Users\\foo\\AppData\\Local\\Temp\\claude-sp-1.txt' })
    expect(script).toContain('ReadAllText')
    expect(script).toContain('--append-system-prompt')
    expect(script).toContain('$a.Add($sp)')
    // Must NOT contain bash-style $(cat ...) — incompatible with PowerShell
    expect(script).not.toContain('$(cat')
  })

  it('escapes single quotes in system prompt file path', () => {
    const script = buildWindowsPS1Script({ spTempFile: "C:\\it's a path\\sp.txt" })
    expect(script).toContain("it''s a path")
  })

  it('adds --settings alwaysThinkingEnabled:false when thinkingMode=disabled', () => {
    const script = buildWindowsPS1Script({ thinkingMode: 'disabled' })
    expect(script).toContain("$a.Add('--settings')")
    expect(script).toContain('alwaysThinkingEnabled')
    expect(script).toContain('false')
  })

  it('adds --dangerously-skip-permissions when permissionMode=auto', () => {
    const script = buildWindowsPS1Script({ permissionMode: 'auto' })
    expect(script).toContain("$a.Add('--dangerously-skip-permissions')")
  })

  it('does not add --append-system-prompt when no spTempFile', () => {
    const script = buildWindowsPS1Script({})
    expect(script).not.toContain('--append-system-prompt')
  })

  it('includes expanded PATH enrichment (T933/T939)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('$env:PATH')
    expect(script).toContain('.local\\bin')
    expect(script).toContain('\\npm')
    // New T939 candidates
    expect(script).toContain('Programs\\claude')
    expect(script).toContain('AnthropicClaude\\bin')
    // PATH line must appear before the $claudeExe invocation
    const pathIdx = script.indexOf('$env:PATH')
    const invokeIdx = script.indexOf('& $claudeExe @a')
    expect(pathIdx).toBeLessThan(invokeIdx)
  })

  it('reads user PATH from registry before hardcoded fallback (T996)', () => {
    const script = buildWindowsPS1Script({})
    // Registry read must be present
    expect(script).toContain("HKCU:\\Environment")
    expect(script).toContain('Get-ItemProperty')
    expect(script).toContain('ExpandEnvironmentVariables')
    // Registry injection must appear before hardcoded PATH enrichment
    const regIdx = script.indexOf('HKCU:\\Environment')
    const hardcodedPathIdx = script.indexOf('.local\\bin')
    expect(regIdx).toBeLessThan(hardcodedPathIdx)
    // Registry injection must appear before Get-Command lookup
    const getCommandIdx = script.indexOf('Get-Command')
    expect(regIdx).toBeLessThan(getCommandIdx)
  })

  it('reads system PATH from HKLM after HKCU and before hardcoded paths (T1029)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
    // HKCU must appear before HKLM
    const hkcuIdx = script.indexOf('HKCU:\\Environment')
    const hklmIdx = script.indexOf('HKLM:\\SYSTEM')
    expect(hkcuIdx).toBeLessThan(hklmIdx)
    // HKLM must appear before hardcoded PATH enrichment
    const hardcodedPathIdx = script.indexOf('.local\\bin')
    expect(hklmIdx).toBeLessThan(hardcodedPathIdx)
    // HKLM must appear before Get-Command lookup
    const getCommandIdx = script.indexOf('Get-Command')
    expect(hklmIdx).toBeLessThan(getCommandIdx)
  })

  it('uses claudeBinaryPath directly via Test-Path, bypasses Get-Command (T1029)', () => {
    const script = buildWindowsPS1Script({ claudeBinaryPath: 'C:\\Users\\foo\\AppData\\Local\\AnthropicClaude\\bin\\claude.exe' })
    expect(script).toContain("Test-Path 'C:\\Users\\foo\\AppData\\Local\\AnthropicClaude\\bin\\claude.exe'")
    expect(script).toContain('$claudeExe = $null')
    // Must NOT use Get-Command when a custom path is provided
    expect(script).not.toContain('Get-Command')
  })

  it('escapes single quotes in claudeBinaryPath (T1029)', () => {
    const script = buildWindowsPS1Script({ claudeBinaryPath: "C:\\it's a path\\claude.exe" })
    expect(script).toContain("it''s a path")
    expect(script).not.toContain("it's a path")
  })

  it('uses Get-Command when claudeBinaryPath is not provided (T1029)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('Get-Command claude -ErrorAction SilentlyContinue')
    expect(script).not.toContain('Test-Path')
  })

  it('error message mentions Settings > Claude Binary Path (T1029)', () => {
    const script = buildWindowsPS1Script({})
    const errorLine = script.split('\n').find(l => l.includes('Write-Output') && l.includes('not found'))
    expect(errorLine).toBeDefined()
    expect(errorLine).toContain('Settings')
    expect(errorLine).toContain('Claude Binary Path')
  })

  it('uses Get-Command for dynamic claude discovery (T939)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('Get-Command claude -ErrorAction SilentlyContinue')
    expect(script).toContain('Select-Object -ExpandProperty Source')
    expect(script).toContain('$claudeExe')
  })

  it('emits readable error (not PATH dump) when claude not found (T939/T995)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('if (-not $claudeExe)')
    expect(script).toContain('exit 1')
    // Error message must be short and readable — no raw $env:PATH dump (T995)
    const errorLine = script.split('\n').find(l => l.includes('Write-Output') && l.includes('not found'))
    expect(errorLine).toBeDefined()
    expect(errorLine).toContain('Install Claude CLI')
    expect(errorLine).not.toContain('$env:PATH')
  })
})

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
    expect(ps1Call).toBeTruthy()
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
    expect(id).toBeTruthy()
  })
})
