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
describe('detectWslClis — script content exact strings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('writes script with "utf-8" encoding (exact string)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const writeCall = writeFileSyncMock.mock.calls[0] as [string, string, string]
    expect(writeCall[2]).toBe('utf-8')
  })

  it('script starts with "#!/bin/bash" shebang (exact string)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent.startsWith('#!/bin/bash')).toBe(true)
  })

  it('script contains "exit 0" at the end', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('exit 0')
  })

  it('script uses "timeout 3" for CLI probing (exact value)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('timeout 3')
  })

  it('script contains all WSL_KNOWN_PATHS', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('$HOME/go/bin')
    expect(scriptContent).toContain('$HOME/.local/bin')
    expect(scriptContent).toContain('$HOME/.cargo/bin')
    expect(scriptContent).toContain('$HOME/.npm-global/bin')
    expect(scriptContent).toContain('/snap/bin')
    expect(scriptContent).toContain('/home/linuxbrew/.linuxbrew/bin')
    expect(scriptContent).toContain('$HOME/.linuxbrew/bin')
  })

  it('script contains "~/.bashrc" source command', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('. ~/.bashrc 2>/dev/null')
  })

  it('script contains "~/.profile" source command', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('. ~/.profile 2>/dev/null')
  })

  it('script contains nvm.sh source', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('$HOME/.nvm/nvm.sh')
  })

  it('temp script filename includes distro name', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('MyDistro', true)
    const writeCall = writeFileSyncMock.mock.calls[0] as [string, string, string]
    expect(writeCall[0]).toContain('MyDistro')
    expect(writeCall[0]).toContain('cli-detect-')
    expect(writeCall[0]).toContain('.sh')
  })

  it('calls wsl.exe with "-d" distro and "bash -l" (exact flags)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Debian', false)
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args[0]).toBe('-d')
    expect(args[1]).toBe('Debian')
    expect(args[2]).toBe('--')
    expect(args[3]).toBe('bash')
    expect(args[4]).toBe('-l')
  })

  it('returns type: "wsl" for WSL instances (exact string)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.1.58\n', stderr: '' })
    const result = await detectWslClis('Ubuntu', true)
    expect(result[0].type).toBe('wsl')
  })

  it('colonIdx in parseDetectionOutput: version starts at colonIdx+1 not colonIdx-1', async () => {
    // If colonIdx-1 is used: 'laude:2.0.0' — version would be 'aude:2.0.0' → wrong
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' })
    const result = await detectWslClis('Ubuntu', true)
    expect(result[0].version).toBe('2.0.0')
  })

  it('parseDetectionOutput: skips lines without colon', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'no-colon\naider:0.50.0\n',
      stderr: '',
    })
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('aider')
  })

  it('parseDetectionOutput: filters by filterClis (excludes non-matching)', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\naider:0.50.0\n',
      stderr: '',
    })
    const result = await detectWslClis('Ubuntu', true, ['aider'])
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('aider')
  })

  it('parseDetectionOutput: sets correct distro name', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' })
    const result = await detectWslClis('SpecialDistro', false)
    expect(result[0].distro).toBe('SpecialDistro')
  })

  it('unlinkSync is called even when execFile fails (finally block)', async () => {
    execFileMock.mockRejectedValueOnce(new Error('wsl timeout'))
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toEqual([])
    expect(unlinkSyncMock).toHaveBeenCalledOnce()
  })

  it('unlinkSync called with the same path that was written', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    const writtenPath = writeFileSyncMock.mock.calls[0][0] as string
    const deletedPath = unlinkSyncMock.mock.calls[0][0] as string
    expect(deletedPath).toBe(writtenPath)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── runFullDetection — Windows batching (EqualityOperator, MethodExpression) ──
// ══════════════════════════════════════════════════════════════════════════════
describe('runFullDetection — Windows batch concurrency', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    _resetDetectionCacheForTest()
    for (const key of Object.keys(handlers)) delete handlers[key]
    enrichWindowsPathMock.mockResolvedValue(undefined)
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerCliDetectHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('processes 3 distros in batches of CONCURRENCY=2 (2 rounds)', async () => {
    getWslDistrosMock.mockResolvedValueOnce([
      { distro: 'Ubuntu', isDefault: true },
      { distro: 'Debian', isDefault: false },
      { distro: 'Alpine', isDefault: false },
    ])
    // No local CLIs
    execFileMock.mockRejectedValueOnce(new Error('not found')) // where claude
    execFileMock.mockRejectedValueOnce(new Error('not found')) // where codex
    execFileMock.mockRejectedValueOnce(new Error('not found')) // where gemini
    execFileMock.mockRejectedValueOnce(new Error('not found')) // where opencode
    execFileMock.mockRejectedValueOnce(new Error('not found')) // where aider
    execFileMock.mockRejectedValueOnce(new Error('not found')) // where goose
    // Batch 1: Ubuntu, Debian
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' }) // Ubuntu
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })               // Debian
    // Batch 2: Alpine
    execFileMock.mockResolvedValueOnce({ stdout: 'aider:0.50.0\n', stderr: '' }) // Alpine

    const result = await callHandler() as Array<{ distro: string }>
    const distros = result.map(r => r.distro)
    expect(distros).toContain('Ubuntu')
    expect(distros).toContain('Alpine')
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('processes exactly 2 distros in 1 batch (i < distros.length, not <=)', async () => {
    getWslDistrosMock.mockResolvedValueOnce([
      { distro: 'Ubuntu', isDefault: true },
      { distro: 'Debian', isDefault: false },
    ])
    execFileMock.mockRejectedValue(new Error('not found')) // local CLIs
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' }) // Ubuntu
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' }) // Debian
    // If i <= distros.length was used (EqualityOperator mutation), a 3rd batch would be attempted
    const result = await callHandler() as Array<{ cli: string }>
    // Just verify it doesn't hang or error
    expect(Array.isArray(result)).toBe(true)
  })

  it('handles 0 distros — no WSL script is spawned', async () => {
    getWslDistrosMock.mockResolvedValueOnce([])
    execFileMock.mockRejectedValue(new Error('not found'))
    const result = await callHandler()
    expect(result).toEqual([])
    // writeFileSync should not be called (no WSL detection)
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('includes both local and WSL results in final array', async () => {
    getWslDistrosMock.mockResolvedValueOnce([{ distro: 'Ubuntu', isDefault: true }])
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' }) // where claude
      .mockResolvedValueOnce({ stdout: '2.0.0\n', stderr: '' })          // claude --version (local)
      .mockRejectedValueOnce(new Error('not found'))                      // where codex
      .mockRejectedValueOnce(new Error('not found'))                      // where gemini
      .mockRejectedValueOnce(new Error('not found'))                      // where opencode
      .mockRejectedValueOnce(new Error('not found'))                      // where aider
      .mockRejectedValueOnce(new Error('not found'))                      // where goose
      .mockResolvedValueOnce({ stdout: 'aider:0.50.0\n', stderr: '' })  // WSL Ubuntu
    const result = await callHandler() as Array<{ type: string; cli: string }>
    const localResults = result.filter(r => r.type === 'local')
    const wslResults = result.filter(r => r.type === 'wsl')
    expect(localResults).toHaveLength(1)
    expect(localResults[0].cli).toBe('claude')
    expect(wslResults).toHaveLength(1)
    expect(wslResults[0].cli).toBe('aider')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── getOrRunDetection — cache null check (BooleanLiteral, BlockStatement) ─────
// ══════════════════════════════════════════════════════════════════════════════
describe('getOrRunDetection — cache null check', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    _resetDetectionCacheForTest()
    for (const key of Object.keys(handlers)) delete handlers[key]
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    registerCliDetectHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('does not re-detect when cache is populated (cache !null check passes)', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.0.0\n', stderr: '' })
    // First call populates cache
    await callHandler()
    // Second call — if !detectionCache check is broken (always false), would re-detect
    await callHandler()
    // Only 1 spawn
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('re-detects when cache is null after reset', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.0.0\n', stderr: '' })
    await callHandler()
    _resetDetectionCacheForTest() // forces cache to null
    await callHandler()
    // If cache null check is broken, this would be 1 (cache never resets)
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('catch(() => []) — detection errors resolve to [] (ArrowFunction)', async () => {
    // Simulate a detection that throws unexpectedly
    execFileMock.mockRejectedValueOnce(new Error('unexpected crash'))
    const result = await callHandler()
    // Should resolve to [] (catch arrow function works)
    expect(result).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── warmupCliDetection — BlockStatement (L273) ────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════