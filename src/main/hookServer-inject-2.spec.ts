/**
 * Tests for hookServer-inject — targeted mutation killing (T1267)
 *
 * Targets survived mutants in hookServer-inject.ts:
 * - injectHookSecret: changed flag, 'http' type check, Authorization header key
 * - injectHookUrls: regex URL pattern, fileExists flag, hook URL host replacement
 * - injectIntoDistroViaWsl: auth injection loop (lines 230-244), URL update loop (258-276)
 * - injectIntoWslDistros: distro list parsing (lines 311-317)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

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

const {
  initHookSecret,
  getHookSecret,
  injectHookSecret,
  injectHookUrls,
  injectIntoWslDistros,
  HOOK_PORT,
  HOOK_ROUTES,
} = await import('./hookServer-inject')

// ── injectHookSecret — targeted mutations ────────────────────────────────────

describe('injectHookSecret — mutation-killing assertions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Set a known secret
    const fakeBytes = Buffer.from('a'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)
    mockReadFileSync.mockImplementation(() => { throw new Error('no file') })
    initHookSecret()
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('does not write when hooks object is present but empty (no events)', async () => {
    // settings.hooks = {} → no http hooks → changed never set → no write
    mockReadFile.mockResolvedValue(JSON.stringify({ hooks: {} }))
    await injectHookSecret('/path/settings.json')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('does not write when http hook already has EXACT Authorization value', async () => {
    const secret = getHookSecret()
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://x', headers: { Authorization: `Bearer ${secret}` } }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookSecret('/path/settings.json')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('writes when http hook has Authorization with WRONG secret value', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://x', headers: { Authorization: 'Bearer old-secret' } }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookSecret('/path/settings.json')
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop[0].hooks[0].headers.Authorization).toBe(`Bearer ${getHookSecret()}`)
  })

  it('skips non-http hooks (type=command) — never adds Authorization', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookSecret('/path/settings.json')
    // command hook never changes
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('uses Authorization key (capital A) — not authorization or other casing', async () => {
    const secret = getHookSecret()
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://x' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookSecret('/path/settings.json')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    const headers = written.hooks.Stop[0].hooks[0].headers
    // Key must be 'Authorization' exactly
    expect(Object.keys(headers)).toContain('Authorization')
    expect(headers['Authorization']).toBe(`Bearer ${secret}`)
    expect(headers['authorization']).toBeUndefined()
  })

  it('adds Authorization with Bearer prefix (not empty string)', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://x' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookSecret('/path/settings.json')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    const auth = written.hooks.Stop[0].hooks[0].headers?.['Authorization'] as string
    expect(auth).toMatch(/^Bearer /)
    expect(auth.length).toBeGreaterThan(7) // "Bearer " + secret
  })

  it('writes file with trailing newline', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://x' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookSecret('/path/settings.json')
    const written = mockWriteFile.mock.calls[0][1] as string
    expect(written.endsWith('\n')).toBe(true)
  })

  it('skips hooks with no hooks array on the group', async () => {
    // group.hooks is undefined → should not throw
    const settings = {
      hooks: {
        Stop: [{}], // group has no hooks array
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await expect(injectHookSecret('/path/settings.json')).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

// ── injectHookUrls — regex and URL replacement ────────────────────────────────

describe('injectHookUrls — URL host replacement (regex mutants)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
  })

  it('replaces http://127.0.0.1:PORT/hooks/ prefix with new IP', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/instructions-loaded' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '10.0.0.5')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://10.0.0.5:27182/hooks/stop')
    expect(written.hooks.SessionStart[0].hooks[0].url).toBe('http://10.0.0.5:27182/hooks/session-start')
  })

  it('replaces URL with long IP segment correctly (not just one char)', async () => {
    // Kills regex mutant `/^http:\/\/[/]+\/hooks\//` (which would match only literal slashes)
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/instructions-loaded' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '192.168.100.200')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Must replace multi-segment IP (172.17.240.1 → 192.168.100.200)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://192.168.100.200:27182/hooks/stop')
  })

  it('does not replace URLs that are NOT http type', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'peon-ping', url: 'http://should-not-change/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/instructions-loaded' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '10.0.0.1')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // command hook url unchanged (http type = false → skip)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://should-not-change/hooks/stop')
  })

  it('new URL contains correct HOOK_PORT number in the replacement', async () => {
    // Kills StringLiteral mutant where the port would be "" or wrong
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/instructions-loaded' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '192.168.1.1')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    const url = written.hooks.Stop[0].hooks[0].url as string
    expect(url).toContain(`:${HOOK_PORT}/`)
    expect(url).toContain(':27182/')
  })

  it('preserves /hooks/<route> path after replacement (not replaced)', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/instructions-loaded' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '10.0.0.2')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Path suffix must be preserved exactly
    expect(written.hooks.Stop[0].hooks[0].url).toMatch(/\/hooks\/stop$/)
    expect(written.hooks.SessionStart[0].hooks[0].url).toMatch(/\/hooks\/session-start$/)
  })

  it('fileExists=false: calls mkdir before writeFile', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await injectHookUrls('/path/.claude/settings.json', '10.0.0.1')
    // mkdir must be called before writeFile
    expect(mockMkdir).toHaveBeenCalledBefore
    expect(mockMkdir).toHaveBeenCalledWith('/path/.claude', { recursive: true })
    expect(mockWriteFile).toHaveBeenCalledOnce()
  })

  it('fileExists=true + no changes: does NOT call writeFile', async () => {
    // All 8 hooks with matching URLs
    const settings = {
      hooks: {
        Stop:               [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/instructions-loaded' }] }],
        PermissionRequest:  [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/permission-request' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '10.0.0.1')
    // No changes → no write
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockMkdir).not.toHaveBeenCalled()
  })
})

// ── injectIntoDistroViaWsl — auth injection loop (lines 230-244) ──────────────
// Kills: NoCoverage mutants on the hookSecret injection loop in injectIntoDistroViaWsl

describe('injectIntoWslDistros — auth injection into existing http hooks', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetAllMocks()
    // Set a known secret via initHookSecret
    const fakeBytes = Buffer.from('b'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)
    mockReadFileSync.mockImplementation(() => { throw new Error('no file') })
    initHookSecret()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('injects Authorization header into existing http hooks in WSL distro settings', async () => {
    const secret = getHookSecret()
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/stop' }] }],
      },
    })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)        // wsl.exe --list --quiet
      .mockReturnValueOnce(existingSettings)  // cat settings.json
      .mockReturnValueOnce(undefined)         // write

    await injectIntoWslDistros('172.17.0.1')

    const writeCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    expect(writeCall).toBeDefined()
    const written = JSON.parse((writeCall![1] as { input: string }).input)
    const auth = written.hooks.Stop[0].hooks[0].headers?.['Authorization']
    expect(auth).toBe(`Bearer ${secret}`)
  })

  it('does NOT write when auth header already correct and URLs already match', async () => {
    const secret = getHookSecret()
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'http',
            url: 'http://172.17.0.1:27182/hooks/stop',
            headers: { Authorization: `Bearer ${secret}` },
          }],
        }],
        SessionStart: [{
          hooks: [{
            type: 'http',
            url: 'http://172.17.0.1:27182/hooks/session-start',
            headers: { Authorization: `Bearer ${secret}` },
          }],
        }],
        SubagentStart: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/subagent-start', headers: { Authorization: `Bearer ${secret}` } }] }],
        SubagentStop: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/subagent-stop', headers: { Authorization: `Bearer ${secret}` } }] }],
        PreToolUse: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/pre-tool-use', headers: { Authorization: `Bearer ${secret}` } }] }],
        PostToolUse: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/post-tool-use', headers: { Authorization: `Bearer ${secret}` } }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/instructions-loaded', headers: { Authorization: `Bearer ${secret}` } }] }],
        PermissionRequest: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/permission-request', headers: { Authorization: `Bearer ${secret}` } }] }],
      },
    })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)       // wsl.exe --list
      .mockReturnValueOnce(existingSettings) // cat settings.json

    await injectIntoWslDistros('172.17.0.1')

    // No changes → no write call
    const writeCalls = mockExecSync.mock.calls.filter((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    expect(writeCalls).toHaveLength(0)
  })

  it('injects URL with correct HOOK_PORT and path for each route when distro has no hooks', async () => {
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)  // wsl.exe --list
      .mockReturnValueOnce('{}')        // cat settings.json → empty
      .mockReturnValueOnce(undefined)   // write

    await injectIntoWslDistros('10.1.2.3')

    const writeCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    const written = JSON.parse((writeCall![1] as { input: string }).input)
    // All 7 routes must be injected with correct URL
    for (const [event, path] of Object.entries(HOOK_ROUTES)) {
      expect(written.hooks[event]).toBeDefined()
      expect(written.hooks[event][0].hooks[0].url).toBe(`http://10.1.2.3:${HOOK_PORT}${path}`)
    }
  })

  it('updates URL host in existing http hooks in WSL distro (URL replacement)', async () => {
    // Kills: ConditionalExpression/EqualityOperator on line 271-276 (URL update in distro)
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
        SessionStart: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/instructions-loaded' }] }],
      },
    })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce(existingSettings)
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('172.25.48.1')

    const writeCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    const written = JSON.parse((writeCall![1] as { input: string }).input)
    // All URLs must be updated to the new WSL IP
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.25.48.1:27182/hooks/stop')
    expect(written.hooks.SessionStart[0].hooks[0].url).toBe('http://172.25.48.1:27182/hooks/session-start')
  })

  it('does not add http hook group when hasHttp=true (already has http hook)', async () => {
    // Kills: ConditionalExpression on hasHttp (line 258-259 in injectIntoDistroViaWsl)
    const secret = getHookSecret()
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/stop', headers: { Authorization: `Bearer ${secret}` } }] }],
        SessionStart: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/session-start', headers: { Authorization: `Bearer ${secret}` } }] }],
        SubagentStart: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/subagent-start', headers: { Authorization: `Bearer ${secret}` } }] }],
        SubagentStop: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/subagent-stop', headers: { Authorization: `Bearer ${secret}` } }] }],
        PreToolUse: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/pre-tool-use', headers: { Authorization: `Bearer ${secret}` } }] }],
        PostToolUse: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/post-tool-use', headers: { Authorization: `Bearer ${secret}` } }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/instructions-loaded', headers: { Authorization: `Bearer ${secret}` } }] }],
        PermissionRequest: [{ hooks: [{ type: 'http', url: 'http://172.17.0.1:27182/hooks/permission-request', headers: { Authorization: `Bearer ${secret}` } }] }],
      },
    })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce(existingSettings)

    await injectIntoWslDistros('172.17.0.1')

    // No write → no changes (auth already correct, URLs match)
    const writeCalls = mockExecSync.mock.calls.filter((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    expect(writeCalls).toHaveLength(0)
  })
})

// ── injectIntoWslDistros — distro list parsing (lines 311-317) ───────────────
// Kills: StringLiteral for 'utf16le', replace patterns, filter/map operations

describe('injectIntoWslDistros — distro list parsing', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    // Initialize a secret
    const fakeBytes = Buffer.from('c'.repeat(32))
    mockRandomBytes.mockReturnValue(fakeBytes)
    mockReadFileSync.mockImplementation(() => { throw new Error('no file') })
    initHookSecret()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('filters out empty lines from distro list', async () => {
    // Distro list with blank lines and trailing newline
    const distroList = Buffer.from('Ubuntu\n\nDebian\n\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList) // wsl.exe --list --quiet
      .mockReturnValueOnce('{}')        // Ubuntu settings
      .mockReturnValueOnce(undefined)   // Ubuntu write
      .mockReturnValueOnce('{}')        // Debian settings
      .mockReturnValueOnce(undefined)   // Debian write

    await injectIntoWslDistros('10.0.0.1')

    // Only Ubuntu and Debian should be processed (not empty strings)
    const catCalls = mockExecSync.mock.calls.filter((c) =>
      (c[0] as string).includes('cat ~/.claude/settings.json')
    )
    expect(catCalls).toHaveLength(2)
    expect(catCalls[0][0]).toContain('"Ubuntu"')
    expect(catCalls[1][0]).toContain('"Debian"')
  })

  it('handles distro name with null chars (utf16le parsing strips \\0)', async () => {
    // Raw UTF-16LE has null bytes between chars — after toString('utf16le') they should be stripped
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('10.0.0.1')

    // Distro name passed to wsl.exe should be 'Ubuntu', not 'U\0b\0u\0n\0t\0u\0'
    const catCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('cat ~/.claude/settings.json')
    )
    expect(catCall![0]).toContain('"Ubuntu"')
    expect(catCall![0]).not.toContain('\0')
  })

  it('filters carriage returns from distro names', async () => {
    // Windows line endings \r\n
    const distroList = Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('10.0.0.1')

    const catCalls = mockExecSync.mock.calls.filter((c) =>
      (c[0] as string).includes('cat ~/.claude/settings.json')
    )
    // Distro names must not contain \r
    for (const call of catCalls) {
      expect(call[0]).not.toContain('\\r')
      expect(call[0]).not.toContain('\r')
    }
  })

  it('passes wsl.exe --list --quiet with timeout=5000 exactly', async () => {
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('10.0.0.1')

    expect(mockExecSync).toHaveBeenCalledWith('wsl.exe --list --quiet', { timeout: 5000 })
  })

  it('uses correct wsl.exe cat command template for each distro', async () => {
    const distroList = Buffer.from('MyDistro\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('10.0.0.1')

    // Must use the exact cat command with fallback echo '{}'
    const catCall = mockExecSync.mock.calls[1]
    expect(catCall[0]).toBe(`wsl.exe -d "MyDistro" -- bash -c "cat ~/.claude/settings.json 2>/dev/null || echo '{}'"`
    )
  })

  it('uses correct wsl.exe write command with mkdir -p', async () => {
    const distroList = Buffer.from('MyDistro\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('10.0.0.1')

    const writeCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    expect(writeCall![0]).toBe(
      `wsl.exe -d "MyDistro" -- bash -c "mkdir -p ~/.claude && cat > ~/.claude/settings.json"`
    )
  })
})

// ── HOOK_ROUTES content assertions ───────────────────────────────────────────
// Kills: StringLiteral mutants on individual route path values

describe('HOOK_ROUTES — exact path values', () => {
  it('Stop route is /hooks/stop', () => {
    expect(HOOK_ROUTES.Stop).toBe('/hooks/stop')
  })
  it('SessionStart route is /hooks/session-start', () => {
    expect(HOOK_ROUTES.SessionStart).toBe('/hooks/session-start')
  })
  it('SubagentStart route is /hooks/subagent-start', () => {
    expect(HOOK_ROUTES.SubagentStart).toBe('/hooks/subagent-start')
  })
  it('SubagentStop route is /hooks/subagent-stop', () => {
    expect(HOOK_ROUTES.SubagentStop).toBe('/hooks/subagent-stop')
  })
  it('PreToolUse route is /hooks/pre-tool-use', () => {
    expect(HOOK_ROUTES.PreToolUse).toBe('/hooks/pre-tool-use')
  })
  it('PostToolUse route is /hooks/post-tool-use', () => {
    expect(HOOK_ROUTES.PostToolUse).toBe('/hooks/post-tool-use')
  })
  it('InstructionsLoaded route is /hooks/instructions-loaded', () => {
    expect(HOOK_ROUTES.InstructionsLoaded).toBe('/hooks/instructions-loaded')
  })
})

// ── injectHookUrls — hasHttp check (MethodExpression mutant line 171) ─────────

describe('injectHookUrls — hasHttp check via some() vs every()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
  })

  it('hasHttp=false when group has only command hooks → adds http group', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
        // other hooks absent → will be created
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '10.0.0.1')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Stop now has 2 groups: original command + new http
    expect(written.hooks.Stop).toHaveLength(2)
    expect(written.hooks.Stop[0].hooks[0].type).toBe('command')
    expect(written.hooks.Stop[1].hooks[0].type).toBe('http')
    expect(written.hooks.Stop[1].hooks[0].url).toBe('http://10.0.0.1:27182/hooks/stop')
  })

  it('hasHttp=true when group has at least one http hook → does NOT add duplicate', async () => {
    // One http hook already present among multiple hooks in group
    const settings = {
      hooks: {
        Stop: [{
          hooks: [
            { type: 'command', command: 'echo done' },
            { type: 'http', url: 'http://10.0.0.1:27182/hooks/stop' },
          ],
        }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/instructions-loaded' }] }],
        PermissionRequest:  [{ hooks: [{ type: 'http', url: 'http://10.0.0.1:27182/hooks/permission-request' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/path/settings.json', '10.0.0.1')
    // No changes → no write
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

// ── injectHookUrls — !fileExists branch (line 199) ───────────────────────────
// Kills: BooleanLiteral `fileExists` → when !fileExists mkdir must be called

describe('injectHookUrls — fileExists conditional', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
  })

  it('calls mkdir when file was missing (fileExists=false)', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await injectHookUrls('/root/.claude/settings.json', '10.0.0.1')
    expect(mockMkdir).toHaveBeenCalledWith('/root/.claude', { recursive: true })
  })

  it('does NOT call mkdir when file existed (fileExists=true)', async () => {
    // File existed but had no hooks section → adds hooks but no mkdir
    mockReadFile.mockResolvedValue('{}')
    await injectHookUrls('/root/.claude/settings.json', '10.0.0.1')
    expect(mockMkdir).not.toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalledOnce()
  })
})
