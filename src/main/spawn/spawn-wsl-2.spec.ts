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

describe('spawnWsl — non-claude adapter (bash script)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const fakeProc = new FakeProc()
    mockSpawn.mockReturnValue(fakeProc)
  })

  it('uses adapter.buildCommand to get command spec', () => {
    const adapter = makeFakeAdapter('codex')
    spawnWsl({
      id: '10',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    expect(adapter.buildCommand).toHaveBeenCalledOnce()
  })

  it('writes a bash script with source ~/.bashrc and exec (StringLiteral)', () => {
    spawnWsl({
      id: '11',
      adapter: makeFakeAdapter('codex') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-11') && String(p).endsWith('.sh')
    )
    expect(writeCall).toBeDefined()
    const content = String(writeCall![1])
    expect(content).toContain('#!/bin/bash')
    expect(content).toContain('~/.bashrc')
    expect(content).toContain('exec ')
  })

  it('passes -- bash -l <script> (not empty array) (ArrayDeclaration)', () => {
    spawnWsl({
      id: '12',
      adapter: makeFakeAdapter('gemini') as never,
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

  it('uses stdio pipe (ObjectLiteral not {})', () => {
    spawnWsl({
      id: '13',
      adapter: makeFakeAdapter('codex') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { stdio: string[] }]
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
  })

  it('returns scriptTempFile for non-claude adapter', () => {
    const result = spawnWsl({
      id: '14',
      adapter: makeFakeAdapter('opencode') as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    expect(result.scriptTempFile).toBeDefined()
    expect(result.scriptTempFile).toMatch(/opencode-start-14.*\.sh$/)
  })

  it('merges spec.env into spawnEnv (ObjectLiteral not {})', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: [],
      env: { CODEX_API_KEY: 'testkey' },
    })
    spawnWsl({
      id: '15',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], { env: Record<string, string> }]
    expect(opts.env).toHaveProperty('CODEX_API_KEY', 'testkey')
    // Also has base env vars (TERM, NO_COLOR, etc.)
    expect(opts.env).toHaveProperty('TERM', 'dumb')
  })

  // ── Regex: /[\s'"\\$`!]/ for shell quoting ──────────────────────────────────

  it('Regex: argument with space is quoted in bash line', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: ['--arg', 'value with space'],
      env: {},
    })
    spawnWsl({
      id: '16',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-16')
    )
    const content = String(writeCall![1])
    // 'value with space' contains a space → must be quoted
    expect(content).toContain("'value with space'")
  })

  it('Regex: argument with single quote is escaped with shell quoting', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: ["it's"],
      env: {},
    })
    spawnWsl({
      id: '17',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-17')
    )
    const content = String(writeCall![1])
    // "it's" must be escaped — shell quote with embedded single quote
    expect(content).toContain("'it'\\''s'")
  })

  it('Regex: argument with dollar sign is quoted', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: ['$HOME/file'],
      env: {},
    })
    spawnWsl({
      id: '18',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-18')
    )
    const content = String(writeCall![1])
    expect(content).toContain("'$HOME/file'")
  })

  it('Regex: plain argument without special chars is NOT quoted (ArrowFunction)', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: ['--plain', 'normalArg'],
      env: {},
    })
    spawnWsl({
      id: '19',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-19')
    )
    const content = String(writeCall![1])
    // Unquoted: --plain and normalArg appear without surrounding quotes
    expect(content).toMatch(/--plain normalArg/)
  })

  it('Regex: backtick in argument is quoted', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: ['arg`backtick'],
      env: {},
    })
    spawnWsl({
      id: '20',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-20')
    )
    const content = String(writeCall![1])
    expect(content).toContain("'arg`backtick'")
  })

  it('Regex: exclamation mark in argument is quoted', () => {
    const adapter = makeFakeAdapter('codex')
    adapter.buildCommand.mockReturnValue({
      command: 'codex',
      args: ['hello!'],
      env: {},
    })
    spawnWsl({
      id: '21',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    const writeCall = mockWriteFileSync.mock.calls.find(
      ([p]: [unknown]) => String(p).includes('codex-start-21')
    )
    const content = String(writeCall![1])
    expect(content).toContain("'hello!'")
  })

  it('converts spTempFile to WSL path for non-claude adapter (StringLiteral ternary)', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: [], env: {} })
    spawnWsl({
      id: '22',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: 'C:\\Windows\\Temp\\sp.txt',
      settingsTempFile: undefined,
    })
    expect(adapter.buildCommand).toHaveBeenCalledWith(
      expect.objectContaining({ systemPromptFile: '/mnt/c/Windows/Temp/sp.txt' })
    )
  })

  it('passes undefined as systemPromptFile when spTempFile absent (StringLiteral ternary false)', () => {
    const adapter = makeFakeAdapter('opencode')
    adapter.buildCommand.mockReturnValue({ command: 'opencode', args: [], env: {} })
    spawnWsl({
      id: '23',
      adapter: adapter as never,
      validConvId: undefined,
      opts: {} as never,
      worktreeInfo: undefined,
      spTempFile: undefined,
      settingsTempFile: undefined,
    })
    expect(adapter.buildCommand).toHaveBeenCalledWith(
      expect.objectContaining({ systemPromptFile: undefined })
    )
  })
})
