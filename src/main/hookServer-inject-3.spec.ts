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

    await injectIntoWslDistros('172.17.0.1', 27182)

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

    await injectIntoWslDistros('172.17.0.1', 27182)

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

    await injectIntoWslDistros('10.1.2.3', 27182)

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

    await injectIntoWslDistros('172.25.48.1', 27182)

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

    await injectIntoWslDistros('172.17.0.1', 27182)

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

    await injectIntoWslDistros('10.0.0.1', 27182)

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

    await injectIntoWslDistros('10.0.0.1', 27182)

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

    await injectIntoWslDistros('10.0.0.1', 27182)

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

    await injectIntoWslDistros('10.0.0.1', 27182)

    expect(mockExecSync).toHaveBeenCalledWith('wsl.exe --list --quiet', { timeout: 5000 })
  })

  it('uses correct wsl.exe cat command template for each distro', async () => {
    const distroList = Buffer.from('MyDistro\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce(undefined)

    await injectIntoWslDistros('10.0.0.1', 27182)

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

    await injectIntoWslDistros('10.0.0.1', 27182)

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
