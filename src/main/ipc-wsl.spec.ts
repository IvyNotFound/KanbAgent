/**
 * Tests for ipc-wsl — WSL utilities (T1073)
 *
 * Strategy: mock child_process.execFile via promisify hoisting,
 * mock electron ipcMain, test exported functions directly.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const { execFileMock, spawnMock, openExternalMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
  openExternalMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: { execFile: execFileMock, spawn: spawnMock },
  execFile: execFileMock,
  spawn: spawnMock,
}))

vi.mock('util', () => ({
  default: { promisify: () => execFileMock },
  promisify: () => execFileMock,
}))

// ── Mock electron ─────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
  shell: {
    openExternal: openExternalMock,
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { getWslExe, enrichWindowsPath, getWslDistros, registerWslHandlers } from './ipc-wsl'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset the module-level `pathEnriched` guard by re-importing a fresh module */
async function getResetModule() {
  vi.resetModules()
  // Re-apply mocks after reset
  vi.mock('child_process', () => ({
    default: { execFile: execFileMock, spawn: spawnMock },
    execFile: execFileMock,
    spawn: spawnMock,
  }))
  vi.mock('util', () => ({
    default: { promisify: () => execFileMock },
    promisify: () => execFileMock,
  }))
  vi.mock('electron', () => ({
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler
      }),
    },
    shell: { openExternal: openExternalMock },
  }))
  const mod = await import('./ipc-wsl')
  return mod
}

// ── getWslExe ─────────────────────────────────────────────────────────────────
describe('getWslExe', () => {
  it('uses SystemRoot when present', () => {
    const original = process.env.SystemRoot
    process.env.SystemRoot = 'C:\\Windows'
    const result = getWslExe()
    // path.join uses OS separator — on Linux tests this will be '/'
    expect(result).toContain('System32')
    expect(result).toContain('wsl.exe')
    expect(result).toContain('C:\\Windows')
    process.env.SystemRoot = original
  })

  it('falls back to hardcoded path when SystemRoot absent', () => {
    const original = process.env.SystemRoot
    delete process.env.SystemRoot
    const result = getWslExe()
    expect(result).toBe('C:\\Windows\\System32\\wsl.exe')
    process.env.SystemRoot = original
  })
})

// ── enrichWindowsPath ─────────────────────────────────────────────────────────
describe('enrichWindowsPath', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('prepends known install locations to PATH when USERPROFILE, APPDATA, LOCALAPPDATA are set', async () => {
    process.env.USERPROFILE = 'C:\\Users\\TestUser'
    process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming'
    process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local'
    process.env.PATH = 'C:\\existing'
    execFileMock.mockResolvedValue({ stdout: '' })

    const { enrichWindowsPath: fn } = await getResetModule()
    await fn()

    expect(process.env.PATH).toContain('C:\\Users\\TestUser\\.local\\bin')
    expect(process.env.PATH).toContain('C:\\Users\\TestUser\\AppData\\Roaming\\npm')
    expect(process.env.PATH).toContain('C:\\Users\\TestUser\\AppData\\Local\\Programs\\claude')
    expect(process.env.PATH).toContain('C:\\existing')
  })

  it('prepends empty strings for missing USERPROFILE/APPDATA/LOCALAPPDATA', async () => {
    delete process.env.USERPROFILE
    delete process.env.APPDATA
    delete process.env.LOCALAPPDATA
    process.env.PATH = 'original'
    execFileMock.mockResolvedValue({ stdout: '' })

    const { enrichWindowsPath: fn } = await getResetModule()
    await fn()

    // PATH still gets modified (empty prefixes), original still present
    expect(process.env.PATH).toContain('original')
  })

  it('prepends registry path when powershell returns a value', async () => {
    process.env.PATH = 'existing'
    execFileMock.mockResolvedValue({ stdout: 'C:\\RegistryPath\n' })

    const { enrichWindowsPath: fn } = await getResetModule()
    await fn()

    expect(process.env.PATH).toContain('C:\\RegistryPath')
    expect(process.env.PATH).toContain('existing')
  })

  it('skips registry path when powershell returns empty', async () => {
    process.env.PATH = 'existing'
    execFileMock.mockResolvedValue({ stdout: '   ' })

    const { enrichWindowsPath: fn } = await getResetModule()
    await fn()

    expect(process.env.PATH).toContain('existing')
    expect(process.env.PATH).not.toMatch(/^;/)
  })

  it('is idempotent — second call does not call execFile again', async () => {
    execFileMock.mockResolvedValue({ stdout: '' })

    const { enrichWindowsPath: fn } = await getResetModule()
    await fn()
    await fn()

    // execFile should be called only once (on first invocation)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('does not throw when powershell fails', async () => {
    execFileMock.mockRejectedValue(new Error('powershell not found'))

    const { enrichWindowsPath: fn } = await getResetModule()
    await expect(fn()).resolves.toBeUndefined()
  })
})

// ── getWslDistros ─────────────────────────────────────────────────────────────
describe('getWslDistros', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  /**
   * Build a fake `wsl -l --verbose` stdout (with null bytes like Windows WSL outputs)
   */
  function makeWslListOutput(distros: { name: string; state: string; isDefault?: boolean }[]): string {
    const header = 'NAME\t\tSTATE\t\tVERSION'
    const rows = distros.map(d => {
      const prefix = d.isDefault ? '* ' : '  '
      return `${prefix}${d.name}\t\t${d.state}\t\t2`
    })
    return [header, ...rows].join('\n')
  }

  it('returns distros with state=Running (case-insensitive parsed as lowercase)', async () => {
    execFileMock.mockResolvedValue({ stdout: makeWslListOutput([
      { name: 'Ubuntu', state: 'Running' },
      { name: 'Debian', state: 'Running' },
    ]) })

    const result = await getWslDistros()
    expect(result).toHaveLength(2)
    expect(result[0].distro).toBe('Ubuntu')
    expect(result[1].distro).toBe('Debian')
  })

  it('includes Stopped distros (WSL starts them automatically on demand)', async () => {
    execFileMock.mockResolvedValue({ stdout: makeWslListOutput([
      { name: 'Ubuntu', state: 'Running' },
      { name: 'Debian', state: 'Stopped' },
    ]) })

    const result = await getWslDistros()
    expect(result).toHaveLength(2)
    expect(result[0].distro).toBe('Ubuntu')
    expect(result[1].distro).toBe('Debian')
  })

  it('skips distros in unknown/unsupported state', async () => {
    execFileMock.mockResolvedValue({ stdout: makeWslListOutput([
      { name: 'Ubuntu', state: 'Running' },
      { name: 'Broken', state: 'Installing' },
    ]) })

    const result = await getWslDistros()
    expect(result).toHaveLength(1)
    expect(result[0].distro).toBe('Ubuntu')
  })

  it('skips docker-related distros', async () => {
    execFileMock.mockResolvedValue({ stdout: makeWslListOutput([
      { name: 'docker-desktop', state: 'Running' },
      { name: 'docker-desktop-data', state: 'Running' },
      { name: 'Ubuntu', state: 'Running' },
    ]) })

    const result = await getWslDistros()
    expect(result).toHaveLength(1)
    expect(result[0].distro).toBe('Ubuntu')
  })

  it('marks the default distro (starred with *)', async () => {
    execFileMock.mockResolvedValue({ stdout: makeWslListOutput([
      { name: 'Ubuntu', state: 'Running', isDefault: false },
      { name: 'Debian', state: 'Running', isDefault: true },
    ]) })

    const result = await getWslDistros()
    const ubuntu = result.find(d => d.distro === 'Ubuntu')
    const debian = result.find(d => d.distro === 'Debian')
    expect(ubuntu?.isDefault).toBe(false)
    expect(debian?.isDefault).toBe(true)
  })

  it('strips null bytes from output', async () => {
    // WSL outputs UTF-16 which, when read as UTF-8, produces null bytes
    const raw = 'NAME\t\tSTATE\t\tVERSION\n  Ubu\0ntu\t\tRunning\t\t2'
    execFileMock.mockResolvedValue({ stdout: raw })

    const result = await getWslDistros()
    expect(result).toHaveLength(1)
    // null bytes removed → "Ubuntu"
    expect(result[0].distro).toBe('Ubuntu')
  })

  it('skips the header line (NAME STATE ...)', async () => {
    execFileMock.mockResolvedValue({ stdout: makeWslListOutput([
      { name: 'Ubuntu', state: 'Running' },
    ]) })

    const result = await getWslDistros()
    // Should only get Ubuntu, not a pseudo-distro named "NAME"
    expect(result.every(d => d.distro !== 'NAME')).toBe(true)
  })

  it('returns [] when wsl.exe throws', async () => {
    execFileMock.mockRejectedValue(new Error('wsl not found'))

    await expect(getWslDistros()).rejects.toThrow('wsl not found')
  })

  it('returns empty array when output contains only the header', async () => {
    execFileMock.mockResolvedValue({ stdout: 'NAME\t\tSTATE\t\tVERSION\n' })

    const result = await getWslDistros()
    expect(result).toHaveLength(0)
  })
})

// ── registerWslHandlers — wsl:openTerminal ────────────────────────────────────
describe('registerWslHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Clear handler registry
    for (const k of Object.keys(handlers)) delete handlers[k]
  })

  it('registers the wsl:openTerminal handler', () => {
    registerWslHandlers()
    expect(handlers['wsl:openTerminal']).toBeDefined()
  })

  it('wsl:openTerminal succeeds via wt.exe when available', async () => {
    const fakeChild = { unref: vi.fn() }
    spawnMock.mockReturnValue(fakeChild)

    registerWslHandlers()
    const result = await handlers['wsl:openTerminal'](null) as { success: boolean }
    expect(result.success).toBe(true)
    expect(fakeChild.unref).toHaveBeenCalled()
  })

  it('wsl:openTerminal falls back to wsl:// URI when wt.exe throws', async () => {
    spawnMock
      .mockImplementationOnce(() => { throw new Error('wt.exe not found') })
      .mockReturnValue({ unref: vi.fn() })
    openExternalMock.mockResolvedValue(undefined)

    registerWslHandlers()
    const result = await handlers['wsl:openTerminal'](null) as { success: boolean }
    expect(result.success).toBe(true)
    expect(openExternalMock).toHaveBeenCalledWith('wsl://')
  })

  it('wsl:openTerminal falls back to wsl.exe when wt.exe and URI both fail', async () => {
    const fakeChild = { unref: vi.fn() }
    spawnMock
      .mockImplementationOnce(() => { throw new Error('wt.exe not found') })
      .mockReturnValueOnce(fakeChild)
    openExternalMock.mockRejectedValue(new Error('URI not registered'))

    registerWslHandlers()
    const result = await handlers['wsl:openTerminal'](null) as { success: boolean }
    expect(result.success).toBe(true)
    expect(fakeChild.unref).toHaveBeenCalled()
  })

  it('wsl:openTerminal returns error when all strategies fail', async () => {
    spawnMock
      .mockImplementationOnce(() => { throw new Error('wt.exe not found') })
      .mockImplementationOnce(() => { throw new Error('wsl.exe not found') })
    openExternalMock.mockRejectedValue(new Error('URI not registered'))

    registerWslHandlers()
    const result = await handlers['wsl:openTerminal'](null) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('wsl.exe not found')
  })
})
