/**
 * Tests for hookServer-inject — Gemini and Codex hook injection (T1371)
 *
 * Covers:
 * - generateHookStub: stub file creation (Unix and Windows code paths)
 * - injectGeminiHooks: settings.json creation, idempotency, error handling
 * - injectCodexHooks: hooks.json creation, Windows skip, idempotency, error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const {
  mockReadFileSync,
  mockWriteFileSync,
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockExecSync,
  mockRandomBytes,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockExecSync: vi.fn(),
  mockRandomBytes: vi.fn(),
}))

vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}))

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

vi.mock('child_process', () => ({
  default: { execSync: mockExecSync },
  execSync: mockExecSync,
}))

vi.mock('crypto', () => ({
  default: { randomBytes: mockRandomBytes },
  randomBytes: mockRandomBytes,
}))

// ── Import module ──────────────────────────────────────────────────────────────

const {
  generateHookStub,
  injectGeminiHooks,
  injectCodexHooks,
  HOOK_PORT,
} = await import('./hookServer-inject')

// ── generateHookStub ──────────────────────────────────────────────────────────

describe('generateHookStub', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('creates the output directory and writes a Unix shell stub', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await generateHookStub('/stubs/gemini-stop.sh', '10.0.0.1', 27182, '/hooks/stop', 'mysecret')

    expect(mockMkdir).toHaveBeenCalledWith('/stubs', { recursive: true })
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [path, content, opts] = mockWriteFile.mock.calls[0]
    expect(path).toBe('/stubs/gemini-stop.sh')
    expect(content).toContain('#!/bin/sh')
    expect(content).toContain('curl -s -X POST "http://10.0.0.1:27182/hooks/stop"')
    expect(content).toContain('Authorization: Bearer mysecret')
    expect(content).toContain('-d @-')
    expect(opts).toMatchObject({ mode: 0o755 })
  })

  it('writes a Windows .cmd stub when platform is win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    await generateHookStub('C:\\stubs\\gemini-stop.cmd', '127.0.0.1', 27182, '/hooks/stop', 'winsecret')

    const [, content] = mockWriteFile.mock.calls[0]
    expect(content).toContain('@echo off')
    expect(content).toContain('curl -s -X POST "http://127.0.0.1:27182/hooks/stop"')
    expect(content).toContain('Authorization: Bearer winsecret')
    // Restore
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  })

  it('embeds the correct IP, port, route and secret in the stub', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await generateHookStub('/stubs/stub.sh', '192.168.1.5', 27182, '/hooks/session-start', 'abc123')

    const [, content] = mockWriteFile.mock.calls[0]
    expect(content).toContain('192.168.1.5:27182')
    expect(content).toContain('/hooks/session-start')
    expect(content).toContain('abc123')
  })
})

// ── injectGeminiHooks ─────────────────────────────────────────────────────────

describe('injectGeminiHooks', () => {
  const STUBS_DIR = '/userData/hooks'
  const SETTINGS_PATH = '/home/user/.gemini/settings.json'

  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('creates settings.json with all 4 Gemini hook events when file is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    // writeFile called: 4 stubs + 1 settings = 5 total
    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    expect(settingsCall).toBeDefined()
    const settings = JSON.parse(settingsCall![1] as string)
    expect(settings.hooks.SessionStart).toBeDefined()
    expect(settings.hooks.SessionEnd).toBeDefined()
    expect(settings.hooks.BeforeTool).toBeDefined()
    expect(settings.hooks.AfterTool).toBeDefined()
  })

  it('injects command-type hooks with correct stub paths', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    const settings = JSON.parse(settingsCall![1] as string)

    const stopHook = settings.hooks.SessionEnd[0].hooks[0]
    expect(stopHook.type).toBe('command')
    expect(stopHook.command).toBe(join(STUBS_DIR, 'gemini-sessionend.sh'))
    expect(stopHook.timeout).toBe(5000)
  })

  it('is idempotent: does not add duplicate entries when settings already have our hooks', async () => {
    const stubPath = join(STUBS_DIR, 'gemini-sessionend.sh')
    const existingSettings = {
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: stubPath, timeout: 5000 }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingSettings))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    // Settings file only written because other events (SessionStart, etc.) are missing
    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    const settings = JSON.parse(settingsCall![1] as string)
    // SessionEnd should still have only 1 group
    expect(settings.hooks.SessionEnd).toHaveLength(1)
  })

  it('does not write settings when all 4 events are already registered', async () => {
    const makeGroup = (name: string) => ({
      hooks: [{ type: 'command', command: join(STUBS_DIR, `gemini-${name}.sh`), timeout: 5000 }],
    })
    const existingSettings = {
      hooks: {
        SessionStart: [makeGroup('sessionstart')],
        SessionEnd:   [makeGroup('sessionend')],
        BeforeTool:   [makeGroup('beforetool')],
        AfterTool:    [makeGroup('aftertool')],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingSettings))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    // Settings unchanged — no write for settings file
    expect(settingsCall).toBeUndefined()
  })

  it('still regenerates stub files even when settings are unchanged', async () => {
    const makeGroup = (name: string) => ({
      hooks: [{ type: 'command', command: join(STUBS_DIR, `gemini-${name}.sh`), timeout: 5000 }],
    })
    const existingSettings = {
      hooks: {
        SessionStart: [makeGroup('sessionstart')],
        SessionEnd:   [makeGroup('sessionend')],
        BeforeTool:   [makeGroup('beforetool')],
        AfterTool:    [makeGroup('aftertool')],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingSettings))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    // 4 stub files written (stubs always regenerated)
    const stubCalls = mockWriteFile.mock.calls.filter((c) => (c[0] as string).includes('gemini-'))
    expect(stubCalls).toHaveLength(4)
  })

  it('adds command hook alongside existing non-command hooks for the same event', async () => {
    const existingSettings = {
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'http', url: 'http://other.server/stop' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingSettings))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    const settings = JSON.parse(settingsCall![1] as string)
    // Two groups: the original http hook + our command hook
    expect(settings.hooks.SessionEnd).toHaveLength(2)
    expect(settings.hooks.SessionEnd[1].hooks[0].type).toBe('command')
  })

  it('skips gracefully on non-ENOENT read errors', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    await expect(injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)).resolves.toBeUndefined()

    // No settings file written
    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    expect(settingsCall).toBeUndefined()
  })

  it('creates the parent directory when settings file is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    // mkdir called for stub dir (×4) + settings dir
    const settingsDirCall = mockMkdir.mock.calls.find((c) => c[0] === '/home/user/.gemini')
    expect(settingsDirCall).toBeDefined()
  })

  it('writes settings with trailing newline', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const settingsCall = mockWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH)
    expect((settingsCall![1] as string).endsWith('\n')).toBe(true)
  })

  it('uses HOOK_PORT constant in generated stubs', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectGeminiHooks(SETTINGS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const stubCalls = mockWriteFile.mock.calls.filter((c) => (c[0] as string).includes('gemini-'))
    for (const [, content] of stubCalls) {
      expect(content).toContain(String(HOOK_PORT))
    }
  })
})

// ── injectCodexHooks ──────────────────────────────────────────────────────────

describe('injectCodexHooks', () => {
  const STUBS_DIR = '/userData/hooks'
  const HOOKS_PATH = '/home/user/.codex/hooks.json'

  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('is a no-op on Windows native', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    await injectCodexHooks(HOOKS_PATH, '127.0.0.1', 'secret', STUBS_DIR)

    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  })

  it('creates hooks.json with all 4 Codex events when file is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const hooksCall = mockWriteFile.mock.calls.find((c) => c[0] === HOOKS_PATH)
    expect(hooksCall).toBeDefined()
    const hooks = JSON.parse(hooksCall![1] as string)
    expect(hooks.SessionStart).toBeDefined()
    expect(hooks.Stop).toBeDefined()
    expect(hooks.PreToolUse).toBeDefined()
    expect(hooks.PostToolUse).toBeDefined()
  })

  it('maps each event to the correct stub path', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const hooksCall = mockWriteFile.mock.calls.find((c) => c[0] === HOOKS_PATH)
    const hooks = JSON.parse(hooksCall![1] as string)
    expect(hooks.Stop).toBe(join(STUBS_DIR, 'codex-stop.sh'))
    expect(hooks.SessionStart).toBe(join(STUBS_DIR, 'codex-sessionstart.sh'))
    expect(hooks.PreToolUse).toBe(join(STUBS_DIR, 'codex-pretooluse.sh'))
    expect(hooks.PostToolUse).toBe(join(STUBS_DIR, 'codex-posttooluse.sh'))
  })

  it('is idempotent: does not write when all entries already point to our stubs', async () => {
    const existingHooks = {
      SessionStart: join(STUBS_DIR, 'codex-sessionstart.sh'),
      Stop:         join(STUBS_DIR, 'codex-stop.sh'),
      PreToolUse:   join(STUBS_DIR, 'codex-pretooluse.sh'),
      PostToolUse:  join(STUBS_DIR, 'codex-posttooluse.sh'),
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingHooks))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const hooksCall = mockWriteFile.mock.calls.find((c) => c[0] === HOOKS_PATH)
    expect(hooksCall).toBeUndefined()
  })

  it('still regenerates stubs even when hooks.json is unchanged', async () => {
    const existingHooks = {
      SessionStart: join(STUBS_DIR, 'codex-sessionstart.sh'),
      Stop:         join(STUBS_DIR, 'codex-stop.sh'),
      PreToolUse:   join(STUBS_DIR, 'codex-pretooluse.sh'),
      PostToolUse:  join(STUBS_DIR, 'codex-posttooluse.sh'),
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingHooks))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const stubCalls = mockWriteFile.mock.calls.filter((c) => (c[0] as string).includes('codex-'))
    expect(stubCalls).toHaveLength(4)
  })

  it('overwrites existing entries pointing to different paths', async () => {
    const existingHooks = {
      Stop: '/old/path/stop.sh',
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existingHooks))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const hooksCall = mockWriteFile.mock.calls.find((c) => c[0] === HOOKS_PATH)
    const hooks = JSON.parse(hooksCall![1] as string)
    expect(hooks.Stop).toBe(join(STUBS_DIR, 'codex-stop.sh'))
  })

  it('skips gracefully on non-ENOENT read errors', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    await expect(injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)).resolves.toBeUndefined()

    const hooksCall = mockWriteFile.mock.calls.find((c) => c[0] === HOOKS_PATH)
    expect(hooksCall).toBeUndefined()
  })

  it('creates parent directory when hooks.json is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const dirCall = mockMkdir.mock.calls.find((c) => c[0] === '/home/user/.codex')
    expect(dirCall).toBeDefined()
  })

  it('writes hooks.json with trailing newline', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await injectCodexHooks(HOOKS_PATH, '10.0.0.1', 'secret', STUBS_DIR)

    const hooksCall = mockWriteFile.mock.calls.find((c) => c[0] === HOOKS_PATH)
    expect((hooksCall![1] as string).endsWith('\n')).toBe(true)
  })
})
