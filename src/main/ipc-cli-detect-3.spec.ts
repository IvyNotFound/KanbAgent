/**
 * Tests for ipc-cli-detect — Part 3 (T1225)
 *
 * Targets surviving mutants:
 * - StringLiteral on 'where', '--version', 'bash', '-c', 'local', 'wsl', 'utf-8'
 * - Regex precision on parseVersion
 * - MethodExpression on .split('\n')[0], .map, .filter, .slice
 * - ConditionalExpression on platform branches, colonIdx, filterClis
 * - BooleanLiteral on isDefault
 * - ObjectLiteral/ArrayDeclaration on CLI_REGISTRY entries
 * - LogicalOperator on platform || condition and handler forceRefresh
 * - ArithmeticOperator on colonIdx ± 1
 * - BlockStatement on warmupCliDetection, linux/darwin branch, detectionCache
 * - ArrowFunction on catch(() => [])
 * - EqualityOperator on i < distros.length
 * - NoCoverage lines 38-59 (WSL_TIMEOUT, LOCAL_TIMEOUT, CONCURRENCY, CLI_REGISTRY)
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const { execFileMock, enrichWindowsPathMock, getWslDistrosMock, writeFileSyncMock, unlinkSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  enrichWindowsPathMock: vi.fn().mockResolvedValue(undefined),
  getWslDistrosMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}))

vi.mock('util', () => ({
  default: { promisify: () => execFileMock },
  promisify: () => execFileMock,
}))

vi.mock('fs', () => ({
  default: { writeFileSync: writeFileSyncMock, unlinkSync: unlinkSyncMock },
  writeFileSync: writeFileSyncMock,
  unlinkSync: unlinkSyncMock,
}))

// ── Mock electron ─────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('./ipc-wsl', () => ({
  enrichWindowsPath: enrichWindowsPathMock,
  getWslDistros: getWslDistrosMock,
  getWslExe: () => 'wsl.exe',
}))

vi.mock('./utils/wsl', () => ({
  toWslPath: (p: string) => {
    const drive = p.charAt(0).toLowerCase()
    const rest = p.slice(2).replace(/\\/g, '/')
    return `/mnt/${drive}${rest}`
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import {
  registerCliDetectHandlers,
  detectLocalClis,
  detectWslClis,
  warmupCliDetection,
  _resetDetectionCacheForTest,
} from './ipc-cli-detect'

// ── Helpers ───────────────────────────────────────────────────────────────────
function callHandler(args?: { clis?: string[]; forceRefresh?: boolean }): Promise<unknown> {
  const handler = handlers['wsl:get-cli-instances']
  if (!handler) throw new Error('Handler not registered')
  return handler(null, args) as Promise<unknown>
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Windows local detection — exact command arguments (StringLiteral) ─────────
// ══════════════════════════════════════════════════════════════════════════════
describe('detectLocalClis — Windows — exact command arguments', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    enrichWindowsPathMock.mockResolvedValue(undefined)
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('calls execFile with exact "where" command (not renamed)', async () => {
    execFileMock.mockRejectedValue(new Error('not found'))
    await detectLocalClis()
    // First call should be 'where'
    const firstCall = execFileMock.mock.calls[0] as [string, string[]]
    expect(firstCall[0]).toBe('where')
  })

  it('passes binary as argument to "where", not hardcoded string', async () => {
    execFileMock.mockRejectedValue(new Error('not found'))
    await detectLocalClis(['claude'])
    const whereCall = execFileMock.mock.calls[0] as [string, string[]]
    expect(whereCall[1]).toContain('claude')
    expect(whereCall[1][0]).toBe('claude')
  })

  it('calls execFile with ["--version"] for version check (exact array)', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' }) // where claude
      .mockResolvedValueOnce({ stdout: '2.1.58\n', stderr: '' })         // claude --version
      .mockRejectedValue(new Error('not found'))
    await detectLocalClis(['claude'])
    const versionCall = execFileMock.mock.calls[1] as [string, string[]]
    expect(versionCall[1]).toEqual(['--version'])
  })

  it('pushes result with type: "local" (exact string, not renamed)', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2.1.58\n', stderr: '' })
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis(['claude'])
    expect(result[0].type).toBe('local')
  })

  it('pushes result with distro: "local" (exact string)', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2.1.58\n', stderr: '' })
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis(['claude'])
    expect(result[0].distro).toBe('local')
  })

  it('pushes result with isDefault: true (not false)', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '3.0.0\n', stderr: '' })
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis(['claude'])
    expect(result[0].isDefault).toBe(true)
  })

  it('trims stdout before parsing version (skips empty after trim)', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '   \n  ', stderr: '' }) // whitespace only
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis(['claude'])
    // Empty after trim → skip, no result
    expect(result).toHaveLength(0)
  })

  it('pushes the exact cli name returned from CLI_REGISTRY (not hardcoded)', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\aider.cmd\n', stderr: '' }) // where aider
      .mockResolvedValueOnce({ stdout: '0.50.1\n', stderr: '' })         // aider --version
    const result = await detectLocalClis(['aider'])
    expect(result[0].cli).toBe('aider')
  })

  it('detects all 6 CLIs when all are present', async () => {
    const clis = ['claude', 'codex', 'gemini', 'opencode', 'aider', 'goose']
    for (const cli of clis) {
      execFileMock.mockResolvedValueOnce({ stdout: `C:\\${cli}.cmd\n`, stderr: '' })
      execFileMock.mockResolvedValueOnce({ stdout: '1.0.0\n', stderr: '' })
    }
    const result = await detectLocalClis()
    expect(result).toHaveLength(6)
    expect(result.map(r => r.cli).sort()).toEqual(clis.sort())
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── Linux/macOS local detection — exact command arguments (StringLiteral) ─────
// ══════════════════════════════════════════════════════════════════════════════
describe('detectLocalClis — Linux — exact command arguments', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('calls "bash" (not other shell) as first argument', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectLocalClis()
    const firstCall = execFileMock.mock.calls[0] as [string, string[]]
    expect(firstCall[0]).toBe('bash')
  })

  it('passes ["-c", script] as arguments to bash (exact flags)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectLocalClis()
    const firstCall = execFileMock.mock.calls[0] as [string, string[]]
    expect(firstCall[1][0]).toBe('-c')
    expect(typeof firstCall[1][1]).toBe('string')
  })

  it('returns type: "local" for linux results', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.1.58\n', stderr: '' })
    const result = await detectLocalClis()
    expect(result[0].type).toBe('local')
  })

  it('returns distro: "local" for linux results', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.1.58\n', stderr: '' })
    const result = await detectLocalClis()
    expect(result[0].distro).toBe('local')
  })

  it('returns isDefault: true for linux results', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'aider:0.50.0\n', stderr: '' })
    const result = await detectLocalClis()
    expect(result[0].isDefault).toBe(true)
  })

  it('uses colonIdx correctly — version starts at colonIdx+1, not colonIdx-1', async () => {
    // "claude:2.1.58" → cli='claude', version parsed from '2.1.58'
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.1.58\n', stderr: '' })
    const result = await detectLocalClis()
    expect(result[0].version).toBe('2.1.58')
    // If colonIdx-1 was used, version would start at 'laude:2.1.58' → wrong
  })

  it('skips lines where colonIdx === -1 (no colon)', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'no-colon-line\nclaude:2.0.0\n',
      stderr: '',
    })
    const result = await detectLocalClis()
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
  })

  it('filters by filterClis — excludes CLIs not in filter list', async () => {
    // Output contains 'aider' but filter is only ['claude']
    execFileMock.mockResolvedValueOnce({
      stdout: 'aider:0.50.0\nclaude:2.0.0\n',
      stderr: '',
    })
    const result = await detectLocalClis(['claude'])
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
  })

  it('includes all CLIs when filterClis is undefined', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\naider:0.50.0\ngemini:0.1.0\n',
      stderr: '',
    })
    const result = await detectLocalClis()
    expect(result).toHaveLength(3)
  })

  it('bash script contains all 6 CLI binaries when no filter', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectLocalClis()
    const scriptArg = (execFileMock.mock.calls[0] as [string, string[]])[1][1]
    expect(scriptArg).toContain('claude')
    expect(scriptArg).toContain('codex')
    expect(scriptArg).toContain('gemini')
    expect(scriptArg).toContain('opencode')
    expect(scriptArg).toContain('aider')
    expect(scriptArg).toContain('goose')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── macOS platform — runFullDetection (L228 ConditionalExpression/LogicalOp) ──
// ══════════════════════════════════════════════════════════════════════════════
describe('wsl:get-cli-instances — macOS', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    _resetDetectionCacheForTest()
    for (const key of Object.keys(handlers)) delete handlers[key]
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    registerCliDetectHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('returns local CLIs on macOS (darwin branch is triggered)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:3.0.0\n', stderr: '' })
    const result = await callHandler() as Array<{ cli: string; type: string }>
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
    expect(result[0].type).toBe('local')
  })

  it('does not call wsl.exe on macOS', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await callHandler()
    const calls = execFileMock.mock.calls as Array<[string, ...unknown[]]>
    expect(calls.find(c => c[0] === 'wsl.exe')).toBeUndefined()
  })

  it('returns [] when bash fails on macOS', async () => {
    execFileMock.mockRejectedValueOnce(new Error('bash failed'))
    const result = await callHandler()
    expect(result).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── WSL detection — script content StringLiterals ─────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════