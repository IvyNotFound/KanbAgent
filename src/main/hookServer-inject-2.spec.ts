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
    await injectHookUrls('/path/settings.json', '10.0.0.5', 27182)
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
    await injectHookUrls('/path/settings.json', '192.168.100.200', 27182)
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
    await injectHookUrls('/path/settings.json', '10.0.0.1', 27182)
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
    await injectHookUrls('/path/settings.json', '192.168.1.1', 27182)
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
    await injectHookUrls('/path/settings.json', '10.0.0.2', 27182)
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Path suffix must be preserved exactly
    expect(written.hooks.Stop[0].hooks[0].url).toMatch(/\/hooks\/stop$/)
    expect(written.hooks.SessionStart[0].hooks[0].url).toMatch(/\/hooks\/session-start$/)
  })

  it('fileExists=false: calls mkdir before writeFile', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await injectHookUrls('/path/.claude/settings.json', '10.0.0.1', 27182)
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
    await injectHookUrls('/path/settings.json', '10.0.0.1', 27182)
    // No changes → no write
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockMkdir).not.toHaveBeenCalled()
  })
})

// ── injectIntoDistroViaWsl — auth injection loop (lines 230-244) ──────────────
// Kills: NoCoverage mutants on the hookSecret injection loop in injectIntoDistroViaWsl
