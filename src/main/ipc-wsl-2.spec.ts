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
  // Top-level vi.mock factories persist across resetModules — no need to re-declare
  const mod = await import('./ipc-wsl')
  return mod
}

// ── getWslExe ─────────────────────────────────────────────────────────────────
describe('registerWslHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Clear handler registry
    for (const k of Object.keys(handlers)) delete handlers[k]
  })

  it('registers the wsl:openTerminal handler', () => {
    registerWslHandlers()
    expect(typeof handlers['wsl:openTerminal']).toBe('function')
  })

  it('wsl:openTerminal succeeds via wt.exe when available', async () => {
    const fakeChild = { unref: vi.fn() }
    spawnMock.mockReturnValue(fakeChild)

    registerWslHandlers()
    const result = await handlers['wsl:openTerminal'](null) as { success: boolean }
    expect(result.success).toBe(true)
    expect(fakeChild.unref).toHaveBeenCalled()
  })

  it('wsl:openTerminal spawns wt.exe with windowsHide: false', async () => {
    const fakeChild = { unref: vi.fn() }
    spawnMock.mockReturnValue(fakeChild)

    registerWslHandlers()
    await handlers['wsl:openTerminal'](null)

    expect(spawnMock).toHaveBeenCalledWith(
      'wt.exe',
      ['wsl'],
      expect.objectContaining({ windowsHide: false })
    )
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
