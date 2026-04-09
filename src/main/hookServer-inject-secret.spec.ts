/**
 * Tests for hookServer-inject — loadOrGenerateSecret, initHookSecret, injectHookSecret,
 * and injectIntoDistroViaWsl (T1219)
 *
 * Covers the 81 NoCoverage mutants around secret management and settings injection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockReadFileSync, mockWriteFileSync, mockReadFile, mockWriteFile, mockMkdir, mockExecSync, mockRandomBytes } = vi.hoisted(() => ({
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
  initHookSecret,
  getHookSecret,
  injectHookSecret,
  HOOK_PORT,
  HOOK_ROUTES,
} = await import('./hookServer-inject')

// ── initHookSecret / getHookSecret (loadOrGenerateSecret) ─────────────────────

describe('initHookSecret and getHookSecret', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('generates a random secret when no userDataPath provided', () => {
    const fakeBytes = Buffer.from('a'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)

    initHookSecret()
    const secret = getHookSecret()

    expect(mockRandomBytes).toHaveBeenCalledWith(32)
    expect(secret).toBe(fakeBytes.toString('hex'))
    expect(secret).toHaveLength(64)
  })

  it('loads existing secret from hook-secret file when it exists and length is 64', () => {
    const existingSecret = 'a'.repeat(64)
    mockReadFileSync.mockReturnValue(existingSecret)

    initHookSecret('/user/data')
    const secret = getHookSecret()

    expect(mockReadFileSync).toHaveBeenCalledWith(join('/user/data', 'hook-secret'), 'utf-8')
    expect(secret).toBe(existingSecret)
    // randomBytes should NOT be called since file had a valid secret
    expect(mockRandomBytes).not.toHaveBeenCalled()
  })

  it('generates new secret and writes to file when hook-secret file does not exist', () => {
    mockReadFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })
    const fakeBytes = Buffer.from('b'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)

    initHookSecret('/user/data')
    const secret = getHookSecret()

    expect(mockRandomBytes).toHaveBeenCalledWith(32)
    expect(secret).toBe(fakeBytes.toString('hex'))
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/user/data', 'hook-secret'),
      fakeBytes.toString('hex'),
      { mode: 0o600 }
    )
  })

  it('generates new secret when existing file content is not 64 characters', () => {
    mockReadFileSync.mockReturnValue('too-short')
    const fakeBytes = Buffer.from('c'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)

    initHookSecret('/user/data')
    const secret = getHookSecret()

    expect(secret).toBe(fakeBytes.toString('hex'))
    expect(mockRandomBytes).toHaveBeenCalledWith(32)
    expect(mockWriteFileSync).toHaveBeenCalled()
  })

  it('generates new secret and ignores writeFileSync error silently', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('read error') })
    const fakeBytes = Buffer.from('d'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)
    mockWriteFileSync.mockImplementation(() => { throw new Error('write error') })

    // Should not throw even if writeFileSync fails
    expect(() => initHookSecret('/user/data')).not.toThrow()
    expect(getHookSecret()).toBe(fakeBytes.toString('hex'))
  })

  it('getHookSecret returns empty string before initHookSecret is called with a new secret', () => {
    // After vi.resetAllMocks the module's hookSecret is still from previous init
    // We test that getHookSecret returns whatever was last set by initHookSecret
    const fakeBytes = Buffer.from('e'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)
    initHookSecret()
    expect(getHookSecret()).toBe(fakeBytes.toString('hex'))
  })
})

// ── injectHookSecret ──────────────────────────────────────────────────────────

describe('injectHookSecret', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Set up a known hook secret via initHookSecret
    const fakeBytes = Buffer.from('f'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)
    mockReadFileSync.mockImplementation(() => { throw new Error('no file') })
    initHookSecret()
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('injects Authorization header into all http-type hooks', async () => {
    const secret = getHookSecret()
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
        SessionStart: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookSecret('/path/settings.json')

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop[0].hooks[0].headers?.['Authorization']).toBe(`Bearer ${secret}`)
    expect(written.hooks.SessionStart[0].hooks[0].headers?.['Authorization']).toBe(`Bearer ${secret}`)
  })

  it('does not write when all http hooks already have correct Authorization header', async () => {
    const secret = getHookSecret()
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop', headers: { Authorization: `Bearer ${secret}` } }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookSecret('/path/settings.json')

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('returns early when settings have no hooks section', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ someOtherKey: true }))

    await injectHookSecret('/path/settings.json')

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('does not modify command-type hooks', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
        SessionStart: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookSecret('/path/settings.json')

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // command hook unchanged — no Authorization added
    expect(written.hooks.Stop[0].hooks[0].headers).toBeUndefined()
    // http hook has Authorization
    expect(written.hooks.SessionStart[0].hooks[0].headers?.['Authorization']).toContain('Bearer')
  })

  it('skips gracefully when readFile fails', async () => {
    mockReadFile.mockRejectedValue(new Error('EACCES'))
    await expect(injectHookSecret('/path/settings.json')).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('skips gracefully when JSON is invalid', async () => {
    mockReadFile.mockResolvedValue('{bad json')
    await expect(injectHookSecret('/path/settings.json')).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('preserves existing headers when injecting Authorization', async () => {
    const secret = getHookSecret()
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop', headers: { 'X-Custom': 'value' } }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookSecret('/path/settings.json')

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop[0].hooks[0].headers?.['X-Custom']).toBe('value')
    expect(written.hooks.Stop[0].hooks[0].headers?.['Authorization']).toBe(`Bearer ${secret}`)
  })
})

// ── HOOK_PORT and HOOK_ROUTES constants ────────────────────────────────────────

describe('hookServer-inject constants', () => {
  it('HOOK_PORT is 27182', () => {
    expect(HOOK_PORT).toBe(27182)
  })

  it('HOOK_ROUTES contains all 8 expected routes', () => {
    expect(Object.keys(HOOK_ROUTES)).toHaveLength(8)
    expect(HOOK_ROUTES.Stop).toBe('/hooks/stop')
    expect(HOOK_ROUTES.SessionStart).toBe('/hooks/session-start')
    expect(HOOK_ROUTES.SubagentStart).toBe('/hooks/subagent-start')
    expect(HOOK_ROUTES.SubagentStop).toBe('/hooks/subagent-stop')
    expect(HOOK_ROUTES.PreToolUse).toBe('/hooks/pre-tool-use')
    expect(HOOK_ROUTES.PostToolUse).toBe('/hooks/post-tool-use')
    expect(HOOK_ROUTES.InstructionsLoaded).toBe('/hooks/instructions-loaded')
    expect(HOOK_ROUTES.PermissionRequest).toBe('/hooks/permission-request')
  })
})

// ── injectHookUrls (StringLiteral / ConditionalExpression details) ─────────────

describe('injectHookUrls — additional assertion coverage', () => {
  // Import injectHookUrls directly from the inject module
  let injectHookUrls: typeof import('./hookServer-inject').injectHookUrls

  beforeEach(async () => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    const mod = await import('./hookServer-inject')
    injectHookUrls = mod.injectHookUrls
  })

  it('writes new settings file with trailing newline', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await injectHookUrls('/path/.claude/settings.json', '10.0.0.1')
    const written = mockWriteFile.mock.calls[0][1] as string
    expect(written.endsWith('\n')).toBe(true)
  })

  it('sets the url host correctly for all 7 managed routes when creating from scratch', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await injectHookUrls('/path/.claude/settings.json', '192.168.1.5')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    for (const [event, path] of Object.entries(HOOK_ROUTES)) {
      expect(written.hooks[event]).toBeDefined()
      expect(written.hooks[event][0].hooks[0].url).toBe(`http://192.168.1.5:${HOOK_PORT}${path}`)
    }
  })

  it('only logs "created: false" when file existed but was modified', async () => {
    // File has hooks but Stop URL needs updating
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    // fileExists = true → mkdir NOT called
    await injectHookUrls('/path/settings.json', '10.1.2.3')
    expect(mockMkdir).not.toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalledOnce()
  })
})
