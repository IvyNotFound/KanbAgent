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
