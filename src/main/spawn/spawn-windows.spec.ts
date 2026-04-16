/**
 * Unit tests for spawn-windows.ts — kills surviving mutants (T1273).
 *
 * Strategy:
 * - Assert exact spawn args and script content (StringLiteral, ArrayDeclaration mutants)
 * - Assert LogicalOperator for cwd priority (worktreeInfo?.path ?? opts.workDir ?? opts.projectPath)
 * - Assert ObjectLiteral spawn options are correct
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockWriteFileSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync }
  return { default: fns, ...fns }
})

const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => {
  const spawnFn = (...args: unknown[]) => mockSpawn(...args)
  return { default: { spawn: spawnFn }, spawn: spawnFn }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { on: vi.fn(), getPath: vi.fn().mockReturnValue('/tmp') },
  webContents: { fromId: vi.fn().mockReturnValue(null) },
}))

vi.mock('../db', () => ({
  queryLive: vi.fn().mockResolvedValue([]),
  assertDbPathAllowed: vi.fn(),
  registerDbPath: vi.fn(),
  registerProjectPath: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

class FakeProc extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() }
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 42
  kill = vi.fn()
}

function makeFakeAdapter(cli = 'claude') {
  return {
    cli,
    buildCommand: vi.fn().mockReturnValue({
      command: 'opencode',
      args: ['--stream'],
      env: {},
    }),
    parseLine: vi.fn().mockReturnValue(null),
    extractConvId: vi.fn().mockReturnValue(null),
  }
}

import { spawnWindows, escapeCmdArg } from './spawn-windows'

// ── escapeCmdArg — cmd.exe metacharacter escaping (T1943) ─────────────────────

describe('escapeCmdArg', () => {
  it('returns clean args unchanged (no metacharacters)', () => {
    expect(escapeCmdArg('--model')).toBe('--model')
    expect(escapeCmdArg('gpt-4o')).toBe('gpt-4o')
    expect(escapeCmdArg('full-auto')).toBe('full-auto')
    expect(escapeCmdArg('C:\\tmp\\ka-sp-1.txt')).toBe('C:\\tmp\\ka-sp-1.txt')
  })

  it('escapes & (command separator) with ^', () => {
    expect(escapeCmdArg('foo & calc.exe')).toBe('foo ^& calc.exe')
  })

  it('escapes | (pipe) with ^', () => {
    expect(escapeCmdArg('foo|bar')).toBe('foo^|bar')
  })

  it('escapes < and > (redirections) with ^', () => {
    expect(escapeCmdArg('a<b>c')).toBe('a^<b^>c')
  })

  it('escapes ( and ) (grouping) with ^', () => {
    expect(escapeCmdArg('(cmd)')).toBe('^(cmd^)')
  })

  it('escapes ^ (escape char itself) with ^^', () => {
    expect(escapeCmdArg('a^b')).toBe('a^^b')
  })

  it('escapes ! (delayed expansion) with ^', () => {
    expect(escapeCmdArg('!var!')).toBe('^!var^!')
  })

  it('escapes % (variable delimiter) with ^', () => {
    expect(escapeCmdArg('%PATH%')).toBe('^%PATH^%')
  })

  it('escapes @ with ^', () => {
    expect(escapeCmdArg('@echo off')).toBe('^@echo off')
  })

  it('escapes all metacharacters in a PoC injection string', () => {
    // PoC from T1943 security audit: modelId = "foo & calc.exe"
    expect(escapeCmdArg('foo & calc.exe')).toBe('foo ^& calc.exe')
  })

  it('escapes multiple metacharacters in one arg', () => {
    expect(escapeCmdArg('a & b | c')).toBe('a ^& b ^| c')
  })

  it('handles empty string', () => {
    expect(escapeCmdArg('')).toBe('')
  })
})

// ── spawnWindows — claude branch ───────────────────────────────────────────────

describe('spawnWindows — claude adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockReturnValue(new FakeProc())
  })

  it('spawns powershell.exe (StringLiteral, not empty)', () => {
    spawnWindows({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [cmd] = mockSpawn.mock.calls[0] as [string]
    expect(cmd).toBe('powershell.exe')
    expect(cmd).not.toBe('')
  })

  it('passes -NoProfile -ExecutionPolicy Bypass -File <script> (ArrayDeclaration)', () => {
    spawnWindows({
      id: '2',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']))
    expect(args).not.toEqual([]) // ArrayDeclaration mutant: not []
  })

  it('-NoProfile appears before -ExecutionPolicy in exact order', () => {
    spawnWindows({
      id: '3',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args[0]).toBe('-NoProfile')
    expect(args[1]).toBe('-ExecutionPolicy')
    expect(args[2]).toBe('Bypass')
    expect(args[3]).toBe('-File')
  })

  it('script path ends with .ps1 (StringLiteral)', () => {
    spawnWindows({
      id: '4',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    const scriptPath = args[4]
    expect(scriptPath).toMatch(/claude-start-4.*\.ps1$/)
  })

  it('uses stdio pipe (ObjectLiteral not {})', () => {
    spawnWindows({
      id: '5',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { stdio: string[] }]
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
  })

  it('uses worktreeInfo.path as cwd when set (LogicalOperator priority)', () => {
    spawnWindows({
      id: '6',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { workDir: 'C:\\other', projectPath: 'C:\\proj' } as never,
      worktreeInfo: { path: 'C:\\worktrees\\42', branch: 'agent/42' },
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(opts.cwd).toBe('C:\\worktrees\\42')
  })

  it('uses opts.workDir when worktreeInfo is absent (LogicalOperator fallback)', () => {
    spawnWindows({
      id: '7',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { workDir: 'C:\\workdir', projectPath: 'C:\\proj' } as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(opts.cwd).toBe('C:\\workdir')
  })

  it('uses opts.projectPath when workDir is also absent', () => {
    spawnWindows({
      id: '8',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { projectPath: 'C:\\project' } as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(opts.cwd).toBe('C:\\project')
  })

  it('cwd is undefined when all path options absent', () => {
    spawnWindows({
      id: '9',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(opts.cwd).toBeUndefined()
  })

  it('writes .ps1 script with utf-8 encoding (StringLiteral)', () => {
    spawnWindows({
      id: '10',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).endsWith('.ps1')
    )
    expect(writeCall).toBeDefined()
    expect(writeCall![2]).toBe('utf-8')
  })

  it('returns proc and scriptTempFile ending in .ps1', () => {
    const result = spawnWindows({
      id: '11',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    expect(result.proc).toBeDefined()
    expect(result.scriptTempFile).toMatch(/claude-start-11.*\.ps1$/)
  })
})

// ── spawnWindows — non-claude branch ──────────────────────────────────────────

describe('spawnWindows — non-claude adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockReturnValue(new FakeProc())
  })

  it('spawns spec.command directly (not powershell.exe) (StringLiteral)', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: ['--stream'], env: {} })
    spawnWindows({
      id: '20',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [cmd] = mockSpawn.mock.calls[0] as [string]
    expect(cmd).toBe('opencode')
  })

  it('passes spec.args to spawn (ArrayDeclaration not [])', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: ['--stream', '--json'], env: {} })
    spawnWindows({
      id: '21',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toEqual(['--stream', '--json'])
  })

  it('enables shell: true for non-claude (StringLiteral)', () => {
    const adapter = makeFakeAdapter('gemini')
    adapter.buildCommand.mockReturnValue({ command: 'gemini', args: [], env: {} })
    spawnWindows({
      id: '22',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { shell?: boolean }]
    expect(opts.shell).toBe(true)
  })

  it('uses stdio pipe (ObjectLiteral not {})', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: [], env: {} })
    spawnWindows({
      id: '23',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { stdio: string[] }]
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
  })

  it('returns scriptTempFile as undefined for non-claude (StringLiteral)', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: [], env: {} })
    const result = spawnWindows({
      id: '24',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    expect(result.scriptTempFile).toBeUndefined()
  })

  it('merges spec.env into Windows env (ObjectLiteral not {})', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: [],
      env: { CODEX_KEY: 'mykey' },
    })
    spawnWindows({
      id: '25',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { env?: Record<string, string> }]
    expect(opts.env).toHaveProperty('CODEX_KEY', 'mykey')
    expect(opts.env).toHaveProperty('TERM', 'dumb')
  })

  it('escapes cmd.exe metacharacters in args (T1943 — injection prevention)', () => {
    const adapter = makeFakeAdapter('aider')
    // Simulate a malicious modelId containing & (command injection PoC)
    adapter.buildCommand.mockReturnValue({
      command: 'aider',
      args: ['--model', 'foo & calc.exe'],
      env: {},
    })
    spawnWindows({
      id: '30',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    // The & must be escaped to ^& so cmd.exe does not interpret it as a separator
    expect(args).toContain('foo ^& calc.exe')
    expect(args).not.toContain('foo & calc.exe')
  })

  it('clean args (no metacharacters) pass through unchanged (T1943)', () => {
    const adapter = makeFakeAdapter('gemini')
    adapter.buildCommand.mockReturnValue({
      command: 'gemini',
      args: ['-m', 'gemini-2.0-flash', '-p', 'Fix the bug'],
      env: {},
    })
    spawnWindows({
      id: '31',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toEqual(['-m', 'gemini-2.0-flash', '-p', 'Fix the bug'])
  })

  it('cwd priority: worktreeInfo.path wins over workDir (LogicalOperator)', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: [], env: {} })
    spawnWindows({
      id: '26',
      adapter: adapter as never,
      validConvId: undefined,
      opts: { workDir: 'C:\\workdir', projectPath: 'C:\\proj' } as never,
      worktreeInfo: { path: 'C:\\worktrees\\99', branch: 'agent/99' },
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(opts.cwd).toBe('C:\\worktrees\\99')
  })
})
