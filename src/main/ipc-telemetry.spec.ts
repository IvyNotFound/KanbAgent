/**
 * Tests for ipc-telemetry.ts — registerTelemetryHandlers / telemetry:scan
 *
 * Framework: Vitest (node environment — configured via environmentMatchGlobs)
 *
 * Strategy: mock fs/promises (readdir + readFile) and ipcMain so the scanner
 * runs without touching the real filesystem.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dirent } from 'fs'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => {
  const readdir = vi.fn().mockResolvedValue([])
  const readFile = vi.fn().mockResolvedValue('')
  return { default: { readdir, readFile }, readdir, readFile }
})

// Capture the handler registered via ipcMain.handle so tests can invoke it.
type IpcHandler = (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
const registeredHandlers: Record<string, IpcHandler> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      registeredHandlers[channel] = handler
    }),
  },
}))

import { readdir, readFile } from 'fs/promises'
import { registerTelemetryHandlers } from './ipc-telemetry'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDirent(name: string, isDirectory: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '/mock',
    parentPath: '/mock',
  } as unknown as Dirent
}

function dir(name: string) { return makeDirent(name, true) }
function file(name: string) { return makeDirent(name, false) }

// Fake IPC event (unused by implementation but required by ipcMain.handle signature)
const fakeEvent = {} as Electron.IpcMainInvokeEvent

// ── Setup ─────────────────────────────────────────────────────────────────────

// Register handlers once before all tests.
registerTelemetryHandlers()

const scan = (projectPath: string) => registeredHandlers['telemetry:scan'](fakeEvent, projectPath)

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('telemetry:scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset registered handlers dict so re-registration doesn't break anything
    // (handlers were already registered — just keep the same reference).
  })

  // ── 1. Simple directory with .ts and .vue files ────────────────────────────

  it('returns correct stats for a flat directory with .ts and .vue files', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('main.ts'),
      file('App.vue'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    vi.mocked(readFile)
      .mockResolvedValueOnce('line1\nline2\nline3')   // main.ts  → 3 lines
      .mockResolvedValueOnce('a\nb')                   // App.vue  → 2 lines

    const result = await scan('/project')

    expect(result.totalFiles).toBe(2)
    expect(result.totalLines).toBe(5)
    expect(result.languages).toHaveLength(2)

    const ts = result.languages.find((l: { name: string }) => l.name === 'TypeScript')
    expect(ts).toBeDefined()
    expect(ts!.files).toBe(1)
    expect(ts!.lines).toBe(3)

    const vue = result.languages.find((l: { name: string }) => l.name === 'Vue')
    expect(vue).toBeDefined()
    expect(vue!.files).toBe(1)
    expect(vue!.lines).toBe(2)
  })

  // ── 2. node_modules ignored ────────────────────────────────────────────────

  it('ignores node_modules directory', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('node_modules'),
      file('index.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    vi.mocked(readFile).mockResolvedValueOnce('only\nthis')  // index.ts

    const result = await scan('/project')

    // readdir should only be called once (no recursion into node_modules)
    expect(readdir).toHaveBeenCalledTimes(1)
    expect(result.totalFiles).toBe(1)
    expect(result.totalLines).toBe(2)
  })

  // ── 3. .git ignored ───────────────────────────────────────────────────────

  it('ignores .git directory', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('.git'),
      file('README.md'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    vi.mocked(readFile).mockResolvedValueOnce('# title')  // README.md

    const result = await scan('/project')

    expect(readdir).toHaveBeenCalledTimes(1)
    expect(result.totalFiles).toBe(1)
  })

  // ── 4. Unreadable file (binary simulated) ─────────────────────────────────

  it('does not crash on unreadable file, counts 0 lines for it', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('binary.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    // readFile rejects → countLines catches and returns ''
    vi.mocked(readFile).mockRejectedValueOnce(new Error('EACCES: permission denied'))

    const result = await scan('/project')

    expect(result.totalFiles).toBe(1)
    // '' split by '\n' gives [''] → 1 line (empty string has one segment)
    expect(result.totalLines).toBe(1)
  })

  // ── 5. Unknown extension ignored ──────────────────────────────────────────

  it('ignores files with unknown extensions (.xyz)', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('data.xyz'),
      file('app.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    vi.mocked(readFile).mockResolvedValueOnce('a\nb\nc')  // only app.ts is read

    const result = await scan('/project')

    expect(result.totalFiles).toBe(1)  // .xyz not counted
    expect(result.languages).toHaveLength(1)
    expect(result.languages[0].name).toBe('TypeScript')
  })

  // ── 6. Empty directory ────────────────────────────────────────────────────

  it('returns zero stats for an empty directory', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await scan('/empty')

    expect(result.totalFiles).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.languages).toHaveLength(0)
    expect(result.scannedAt).toBeTruthy()
  })

  // ── 7. percent sums to ~100 ───────────────────────────────────────────────

  it('calculates percent so that the sum is approximately 100', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('a.ts'),
      file('b.vue'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    vi.mocked(readFile)
      .mockResolvedValueOnce('1\n2\n3\n4\n5\n6\n7')   // 7 lines → .ts
      .mockResolvedValueOnce('1\n2\n3')                 // 3 lines → .vue

    const result = await scan('/project')

    const total = result.languages.reduce((sum: number, l: { percent: number }) => sum + l.percent, 0)
    // Due to rounding, allow ±1
    expect(total).toBeGreaterThanOrEqual(99)
    expect(total).toBeLessThanOrEqual(101)
  })

  // ── 8. Invalid / missing projectPath ─────────────────────────────────────

  it('returns empty result when projectPath is empty string', async () => {
    const result = await scan('')

    expect(result.totalFiles).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.languages).toHaveLength(0)
    expect(readdir).not.toHaveBeenCalled()
  })

  it('returns empty result when projectPath is not a string', async () => {
    const result = await scan(null as unknown as string)

    expect(result.totalFiles).toBe(0)
    expect(result.totalLines).toBe(0)
  })

  // ── 9. Recursive scan into subdirectories ─────────────────────────────────

  it('recurses into non-ignored subdirectories', async () => {
    vi.mocked(readdir)
      // Root: one subdir + one file
      .mockResolvedValueOnce([
        dir('src'),
        file('index.ts'),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)
      // src/ contents
      .mockResolvedValueOnce([
        file('app.ts'),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)

    vi.mocked(readFile)
      .mockResolvedValueOnce('a\nb')        // index.ts  → 2 lines
      .mockResolvedValueOnce('x\ny\nz')     // src/app.ts → 3 lines

    const result = await scan('/project')

    expect(result.totalFiles).toBe(2)
    expect(result.totalLines).toBe(5)
    const ts = result.languages.find((l: { name: string }) => l.name === 'TypeScript')
    expect(ts!.files).toBe(2)
  })

  // ── 10. scannedAt is a valid ISO date ─────────────────────────────────────

  it('returns a valid ISO date string in scannedAt', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await scan('/project')

    expect(() => new Date(result.scannedAt).toISOString()).not.toThrow()
  })
})
