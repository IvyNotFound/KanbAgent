/**
 * Tests for ipc-cli-detect — multi-CLI detection (T1011)
 *
 * Strategy: mock child_process.execFile via promisify hoisting,
 * capture the handler registered with ipcMain.handle, then call it directly.
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

// ── Mock ipc-wsl (shared utilities) ──────────────────────────────────────────
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
import { registerCliDetectHandlers, detectLocalClis, detectWslClis, _resetDetectionCacheForTest } from './ipc-cli-detect'

// ── Helper ────────────────────────────────────────────────────────────────────
function callHandler(args?: { clis?: string[] }): Promise<unknown> {
  const handler = handlers['wsl:get-cli-instances']
  if (!handler) throw new Error('Handler not registered')
  return handler(null, args) as Promise<unknown>
}

// ── detectLocalClis — Linux/macOS ─────────────────────────────────────────────
describe('detectLocalClis — Linux/macOS', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('returns detected CLIs from bash one-liner output', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.1.58 (Claude Code)\ncodex:1.0.0\n',
      stderr: '',
    })
    const result = await detectLocalClis()
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ cli: 'claude', distro: 'local', version: '2.1.58', type: 'local' })
    expect(result[1]).toMatchObject({ cli: 'codex', distro: 'local', version: '1.0.0', type: 'local' })
  })

  it('returns [] when no CLIs found', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await detectLocalClis()
    expect(result).toEqual([])
  })

  it('returns [] when bash spawn fails', async () => {
    execFileMock.mockRejectedValueOnce(new Error('bash: command not found'))
    const result = await detectLocalClis()
    expect(result).toEqual([])
  })

  it('filters by clis when filterClis provided', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.1.58\n',
      stderr: '',
    })
    const result = await detectLocalClis(['claude'])
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
    // Only 'claude' binary should be in the bash script
    const scriptArg = execFileMock.mock.calls[0][1][1] as string
    expect(scriptArg).toContain('claude')
    expect(scriptArg).not.toContain('codex')
  })

  it('ignores unknown CLI names from one-liner output', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'unknown-cli:1.0.0\nclaude:2.0.0\n',
      stderr: '',
    })
    const result = await detectLocalClis()
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
  })

  it('parses version with v-prefix (e.g. opencode v0.1.2)', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'opencode:opencode v0.1.2\n',
      stderr: '',
    })
    const result = await detectLocalClis(['opencode'])
    expect(result[0].version).toBe('0.1.2')
  })

})

// ── detectLocalClis — Windows ─────────────────────────────────────────────────
describe('detectLocalClis — Windows', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    enrichWindowsPathMock.mockResolvedValue(undefined)
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('detects claude and codex via where loop', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' }) // where claude
      .mockResolvedValueOnce({ stdout: '2.1.58 (Claude Code)\n', stderr: '' }) // claude --version
      .mockResolvedValueOnce({ stdout: 'C:\\codex.cmd\n', stderr: '' }) // where codex
      .mockResolvedValueOnce({ stdout: '1.0.0\n', stderr: '' }) // codex --version
      // remaining CLIs: where fails
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis()
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ cli: 'claude', version: '2.1.58', type: 'local' })
    expect(result[1]).toMatchObject({ cli: 'codex', version: '1.0.0', type: 'local' })
  })

  it('skips CLI when where fails', async () => {
    execFileMock.mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis()
    expect(result).toEqual([])
  })

  it('skips CLI when --version returns empty', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // empty version
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis()
    expect(result).toEqual([])
  })

  it('calls enrichWindowsPath exactly once', async () => {
    execFileMock.mockRejectedValue(new Error('not found'))
    await detectLocalClis()
    expect(enrichWindowsPathMock).toHaveBeenCalledTimes(1)
  })
})

// ── detectWslClis ─────────────────────────────────────────────────────────────
describe('detectWslClis', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns installed CLIs from script file output', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.1.58\ngemini:0.2.0\n',
      stderr: '',
    })
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ cli: 'claude', distro: 'Ubuntu', isDefault: true, type: 'wsl' })
    expect(result[1]).toMatchObject({ cli: 'gemini', distro: 'Ubuntu', isDefault: true, version: '0.2.0', type: 'wsl' })
  })

  it('strips UTF-16 null bytes from wsl.exe output', async () => {
    const raw = 'claude:2.0.0\n'.split('').join('\0')
    execFileMock.mockResolvedValueOnce({ stdout: raw, stderr: '' })
    const result = await detectWslClis('Debian', false)
    expect(result[0]).toMatchObject({ cli: 'claude', version: '2.0.0' })
  })

  it('returns [] when wsl.exe fails or times out', async () => {
    execFileMock.mockRejectedValueOnce(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }))
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toEqual([])
  })

  it('returns [] when no CLIs are installed', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toEqual([])
  })

  it('writes a temp script file and uses bash -l <file> for WSL calls', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await detectWslClis('Ubuntu', true)
    // Script file should be written
    expect(writeFileSyncMock).toHaveBeenCalledOnce()
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('#!/bin/bash')
    expect(scriptContent).toContain('~/.bashrc')
    expect(scriptContent).toContain('exit 0')
    // wsl.exe should be called with bash -l <wslPath>
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args[0]).toBe('-d')
    expect(args[1]).toBe('Ubuntu')
    expect(args).toContain('bash')
    expect(args).toContain('-l')
    expect(args).not.toContain('-lc')
    // Cleanup: unlinkSync should be called
    expect(unlinkSyncMock).toHaveBeenCalledOnce()
  })

  it('filters by clis when filterClis provided', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'aider:0.50.0\n', stderr: '' })
    const result = await detectWslClis('Ubuntu', false, ['aider'])
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('aider')
    // Script content should only contain filtered CLIs
    const scriptContent = writeFileSyncMock.mock.calls[0][1] as string
    expect(scriptContent).toContain('aider')
    expect(scriptContent).not.toContain('codex')
  })
})

// ── registerCliDetectHandlers / wsl:get-cli-instances ────────────────────────
describe('wsl:get-cli-instances — Windows', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    _resetDetectionCacheForTest()
    enrichWindowsPathMock.mockResolvedValue(undefined)
    for (const key of Object.keys(handlers)) delete handlers[key]
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerCliDetectHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('returns local + WSL instances', async () => {
    getWslDistrosMock.mockResolvedValueOnce([{ distro: 'Ubuntu', isDefault: true }])
    execFileMock
      // Local: where claude
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2.1.58\n', stderr: '' })
      // Local: remaining CLIs not found
      .mockRejectedValue(new Error('not found'))
    // WSL one-liner for Ubuntu — override rejections for this specific call
    execFileMock.mockResolvedValueOnce({ stdout: 'codex:1.0.0\n', stderr: '' })

    // Reset and re-setup mock sequence properly
    execFileMock.mockReset()
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' }) // where claude
      .mockResolvedValueOnce({ stdout: '2.1.58\n', stderr: '' })         // claude --version
      .mockRejectedValueOnce(new Error('not found'))                      // where codex
      .mockRejectedValueOnce(new Error('not found'))                      // where gemini
      .mockRejectedValueOnce(new Error('not found'))                      // where opencode
      .mockRejectedValueOnce(new Error('not found'))                      // where aider
      .mockRejectedValueOnce(new Error('not found'))                      // where goose
      .mockResolvedValueOnce({ stdout: 'codex:1.0.0\n', stderr: '' })    // WSL Ubuntu one-liner

    const result = await callHandler() as Array<{ cli: string; type: string }>
    expect(result.find(r => r.cli === 'claude' && r.type === 'local')).toBeDefined()
    expect(result.find(r => r.cli === 'codex' && r.type === 'wsl')).toBeDefined()
  })

  it('returns [] when all detections fail', async () => {
    getWslDistrosMock.mockRejectedValueOnce(new Error('wsl not available'))
    execFileMock.mockRejectedValue(new Error('not found'))
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('accepts optional clis filter', async () => {
    getWslDistrosMock.mockResolvedValueOnce([])
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2.0.0\n', stderr: '' })
    const result = await callHandler({ clis: ['claude'] }) as Array<{ cli: string }>
    expect(result.every(r => r.cli === 'claude')).toBe(true)
  })
})

describe('wsl:get-cli-instances — Linux', () => {
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

  it('returns local instances only (no wsl.exe)', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.1.58\n', stderr: '' })
    const result = await callHandler() as Array<{ type: string }>
    expect(result.every(r => r.type === 'local')).toBe(true)
    const calls = execFileMock.mock.calls as Array<[string, ...unknown[]]>
    expect(calls.find(c => c[0] === 'wsl.exe')).toBeUndefined()
  })

  it('returns [] when bash fails', async () => {
    execFileMock.mockRejectedValueOnce(new Error('bash not found'))
    const result = await callHandler()
    expect(result).toEqual([])
  })
})

// ── parseVersion — via detectLocalClis Linux output ───────────────────────────
describe('parseVersion — version string extraction', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  async function parseViaDetect(raw: string): Promise<string> {
    execFileMock.mockResolvedValueOnce({ stdout: `claude:${raw}\n`, stderr: '' })
    const result = await detectLocalClis(['claude'])
    return result[0]?.version ?? ''
  }

  it('parses plain version "2.1.58"', async () => {
    expect(await parseViaDetect('2.1.58')).toBe('2.1.58')
  })

  it('strips leading v from "v2.1.58"', async () => {
    expect(await parseViaDetect('v2.1.58')).toBe('2.1.58')
  })

  it('extracts version from "opencode v0.1.2 (build info)"', async () => {
    expect(await parseViaDetect('opencode v0.1.2 (build info)')).toBe('0.1.2')
  })

  it('parses only the first line of multiline output', async () => {
    // The bash one-liner uses head -1, so only first line reaches parseVersion
    // Simulate multiline by embedding newline in the raw version field
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.1.58\nignored:9.9.9\n', stderr: '' })
    const result = await detectLocalClis(['claude'])
    expect(result).toHaveLength(1)
    expect(result[0].version).toBe('2.1.58')
  })

  it('falls back to first word when no version pattern matches', async () => {
    // "no-version-here" has no digits → fallback to split(" ")[0]
    expect(await parseViaDetect('no-version-here')).toBe('no-version-here')
  })

  it('parses version with extra patch segments "1.2.3.4"', async () => {
    expect(await parseViaDetect('1.2.3.4')).toBe('1.2.3.4')
  })
})

// ── parseDetectionOutput — via detectWslClis ──────────────────────────────────
describe('parseDetectionOutput — line parsing edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('ignores lines without a colon separator', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'no-colon-line\nclaude:2.0.0\n', stderr: '' })
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
  })

  it('ignores lines with unknown CLI name before colon', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'unknown-tool:1.2.3\nclaude:2.0.0\n', stderr: '' })
    const result = await detectWslClis('Ubuntu', true)
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('claude')
  })

  it('sets isDefault=false for non-default distro', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' })
    const result = await detectWslClis('Debian', false)
    expect(result[0].isDefault).toBe(false)
    expect(result[0].distro).toBe('Debian')
  })
})

// ── Detection cache ───────────────────────────────────────────────────────────
describe('detection cache', () => {
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

  it('calls bash only once for two consecutive handler calls (cache hit)', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.1.58\n', stderr: '' })
    await callHandler()
    await callHandler()
    // Only 1 bash spawn despite 2 handler calls
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('_resetDetectionCacheForTest clears cache so next call re-detects', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.1.58\n', stderr: '' })
    await callHandler()
    _resetDetectionCacheForTest()
    await callHandler()
    // Two separate detections → 2 bash spawns
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })
})

// ── warmupCliDetection ────────────────────────────────────────────────────────
describe('warmupCliDetection', () => {
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

  it('pre-warms cache so IPC handler uses cached result without extra spawn', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.1.58\n', stderr: '' })
    const { warmupCliDetection } = await import('./ipc-cli-detect')
    warmupCliDetection()
    // Wait for the warmup promise to resolve
    await new Promise(resolve => setTimeout(resolve, 0))
    const result = await callHandler() as Array<{ cli: string }>
    // Result should be from cache
    expect(result[0]?.cli).toBe('claude')
    // Only 1 spawn (warmup), handler reuses the cache
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })
})
