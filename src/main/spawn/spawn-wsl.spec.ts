/**
 * Unit tests for spawn-wsl.ts — kills surviving mutants (T1273).
 *
 * Strategy:
 * - Assert exact spawn args (StringLiteral, ArrayDeclaration mutants)
 * - Assert conditional branches (ConditionalExpression mutants)
 * - Assert regex behavior at boundaries (Regex mutants)
 * - Assert ObjectLiteral/ArrowFunction side effects
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
  pid = 99
  kill = vi.fn()
}

function makeFakeAdapter(cli = 'claude') {
  return {
    cli,
    buildCommand: vi.fn().mockReturnValue({
      command: 'codex',
      args: ['--arg1', 'val 1'],
      env: {},
    }),
    parseLine: vi.fn().mockReturnValue(null),
    extractConvId: vi.fn().mockReturnValue(null),
  }
}

import { spawnWsl } from './spawn-wsl'

// ── spawnWsl — claude branch ───────────────────────────────────────────────────

describe('spawnWsl — claude adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const fakeProc = new FakeProc()
    mockSpawn.mockReturnValue(fakeProc)
  })

  it('spawns wsl.exe (not empty string) when SystemRoot set', () => {
    const origSystemRoot = process.env.SystemRoot
    process.env.SystemRoot = 'C:\\Windows'
    try {
      spawnWsl({
        id: '1',
        adapter: makeFakeAdapter('claude') as never,
        validConvId: undefined,
        opts: { projectPath: '/some/path' } as never,
        worktreeInfo: undefined,
        spTempFile: undefined,
        settingsTempFile: undefined,
      })
      const [cmd] = mockSpawn.mock.calls[0] as [string]
      expect(cmd).toContain('wsl.exe')
      expect(cmd).not.toBe('')
      expect(cmd).toContain('System32')
    } finally {
      process.env.SystemRoot = origSystemRoot
    }
  })

  it('falls back to C:\\Windows\\System32\\wsl.exe when SystemRoot is undefined', () => {
    const origSystemRoot = process.env.SystemRoot
    delete process.env.SystemRoot
    try {
      spawnWsl({
        id: '1',
        adapter: makeFakeAdapter('claude') as never,
        validConvId: undefined,
        opts: {} as never,
        worktreeInfo: undefined,
        spTempFile: undefined,
        settingsTempFile: undefined,
      })
      const [cmd] = mockSpawn.mock.calls[0] as [string]
      expect(cmd).toBe('C:\\Windows\\System32\\wsl.exe')
    } finally {
      process.env.SystemRoot = origSystemRoot
    }
  })

  it('adds -d and distro name when wslDistro is provided (not empty)', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { wslDistro: 'Ubuntu' } as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toContain('-d')
    expect(args).toContain('Ubuntu')
  })

  it('omits -d flag when wslDistro is local (ConditionalExpression)', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { wslDistro: 'local' } as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).not.toContain('-d')
  })

  it('omits -d flag when wslDistro is undefined', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).not.toContain('-d')
  })

  it('adds --cd with worktree path when worktreeInfo is set (ConditionalExpression)', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { workDir: '/other', projectPath: '/project' } as never,
      worktreeInfo: { path: 'C:\\worktrees\\42', branch: 'agent/42' },
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toContain('--cd')
    const cdIdx = args.indexOf('--cd')
    // WSL path from worktreeInfo.path (not opts.workDir)
    expect(args[cdIdx + 1]).toContain('/mnt/')
  })

  it('uses workDir when worktreeInfo is absent but workDir is set', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { workDir: 'C:\\my\\project', projectPath: '/fallback' } as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toContain('--cd')
    const cdIdx = args.indexOf('--cd')
    expect(args[cdIdx + 1]).toContain('/mnt/c/my/project')
  })

  it('uses projectPath when both worktreeInfo and workDir are absent', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: { projectPath: 'C:\\my\\proj' } as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toContain('--cd')
  })

  it('omits --cd when all cwd options are absent (ConditionalExpression false)', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).not.toContain('--cd')
  })

  it('passes -- bash -l <script> args in claude branch (ArrayDeclaration)', () => {
    spawnWsl({
      id: '1',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    expect(args).toContain('--')
    expect(args).toContain('bash')
    expect(args).toContain('-l')
  })

  it('uses stdio pipe not empty (ObjectLiteral)', () => {
    spawnWsl({
      id: '1',
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

  it('writes a bash script with #!/bin/bash and exec (StringLiteral)', () => {
    spawnWsl({
      id: '5',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start-5') && String(p).endsWith('.sh')
    )
    expect(writeCall).toBeDefined()
    const content = String(writeCall![1])
    expect(content).toContain('#!/bin/bash')
    expect(content).toContain('exec ')
  })

  it('script file written with utf-8 encoding (StringLiteral)', () => {
    spawnWsl({
      id: '6',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start-6')
    )
    expect(writeCall).toBeDefined()
    expect(writeCall![2]).toBe('utf-8')
  })

  it('returns a proc and scriptTempFile (not undefined)', () => {
    const result = spawnWsl({
      id: '7',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    expect(result.proc).toBeDefined()
    expect(result.scriptTempFile).toBeDefined()
    expect(result.scriptTempFile).toMatch(/claude-start-7.*\.sh$/)
  })

  it('converts spTempFile to WSL path when provided (StringLiteral ternary)', () => {
    spawnWsl({
      id: '8',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: 'C:\\Users\\Temp\\sp.txt',
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start-8')
    )
    const content = String(writeCall![1])
    // spTempFile was converted to WSL path before being embedded
    expect(content).toContain('/mnt/c/Users/Temp/sp.txt')
  })

  it('omits system prompt from script when spTempFile is undefined', () => {
    spawnWsl({
      id: '9',
      adapter: makeFakeAdapter('claude') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('claude-start-9')
    )
    const content = String(writeCall![1])
    expect(content).not.toContain('--append-system-prompt')
  })
})

// ── spawnWsl — non-claude adapter (bash script branch) ────────────────────────
