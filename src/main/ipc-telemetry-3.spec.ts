/**
 * ipc-telemetry-3.spec.ts — Targeted StringLiteral mutation kill tests
 *
 * Covers:
 * - LANGUAGE_MAP: name for every supported extension (lines 17–29)
 * - FALLBACK_IGNORE: all 5 entries including 'out', '.cache', 'coverage' (line 33)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dirent } from 'fs'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => {
  const readdir = vi.fn().mockResolvedValue([])
  const readFile = vi.fn().mockResolvedValue('')
  return { default: { readdir, readFile }, readdir, readFile }
})

vi.mock('./db', () => ({
  assertProjectPathAllowed: vi.fn(),
}))

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

function mockGitignore(content?: string): void {
  if (content !== undefined) {
    vi.mocked(readFile).mockResolvedValueOnce(content)
  } else {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
  }
}

const fakeEvent = {} as Electron.IpcMainInvokeEvent
registerTelemetryHandlers()
const scan = (projectPath: string) => registeredHandlers['telemetry:scan'](fakeEvent, projectPath)

// ── Helper to scan a single file and return its language stat ─────────────────
async function scanSingleFile(fileName: string, content = 'a\nb\nc') {
  vi.mocked(readdir).mockResolvedValueOnce([
    file(fileName),
  ] as unknown as Awaited<ReturnType<typeof readdir>>)
  mockGitignore()
  vi.mocked(readFile).mockResolvedValueOnce(content)
  const result = await scan('/project') as { languages: Array<{ name: string; files: number }> }
  return result.languages[0]
}

// ── LANGUAGE_MAP — name for every extension (StringLiteral kill) ──────────────

describe('LANGUAGE_MAP — TypeScript (.ts)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name TypeScript', async () => {
    const lang = await scanSingleFile('main.ts')
    expect(lang.name).toBe('TypeScript')
  })
})

describe('LANGUAGE_MAP — Vue (.vue)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Vue', async () => {
    const lang = await scanSingleFile('App.vue')
    expect(lang.name).toBe('Vue')
  })
})

describe('LANGUAGE_MAP — JavaScript (.js)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name JavaScript', async () => {
    const lang = await scanSingleFile('app.js')
    expect(lang.name).toBe('JavaScript')
  })
})

describe('LANGUAGE_MAP — CSS (.css)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name CSS', async () => {
    const lang = await scanSingleFile('styles.css')
    expect(lang.name).toBe('CSS')
  })
})

describe('LANGUAGE_MAP — HTML (.html)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name HTML', async () => {
    const lang = await scanSingleFile('index.html')
    expect(lang.name).toBe('HTML')
  })
})

describe('LANGUAGE_MAP — Python (.py)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Python', async () => {
    const lang = await scanSingleFile('script.py')
    expect(lang.name).toBe('Python')
  })
})

describe('LANGUAGE_MAP — Go (.go)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Go', async () => {
    const lang = await scanSingleFile('main.go')
    expect(lang.name).toBe('Go')
  })
})

describe('LANGUAGE_MAP — Rust (.rs)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Rust', async () => {
    const lang = await scanSingleFile('lib.rs')
    expect(lang.name).toBe('Rust')
  })
})

describe('LANGUAGE_MAP — Java (.java)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Java', async () => {
    const lang = await scanSingleFile('Main.java')
    expect(lang.name).toBe('Java')
  })
})

describe('LANGUAGE_MAP — JSON (.json)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name JSON', async () => {
    const lang = await scanSingleFile('package.json')
    expect(lang.name).toBe('JSON')
  })
})

describe('LANGUAGE_MAP — Markdown (.md)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Markdown', async () => {
    const lang = await scanSingleFile('README.md')
    expect(lang.name).toBe('Markdown')
  })
})

describe('LANGUAGE_MAP — Shell (.sh)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name Shell', async () => {
    const lang = await scanSingleFile('build.sh')
    expect(lang.name).toBe('Shell')
  })
})

describe('LANGUAGE_MAP — SQL (.sql)', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns name SQL', async () => {
    const lang = await scanSingleFile('query.sql')
    expect(lang.name).toBe('SQL')
  })
})

// ── FALLBACK_IGNORE — all 5 entries (StringLiteral kill) ──────────────────────

describe('FALLBACK_IGNORE — directories excluded when no .gitignore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ignores "out" directory via fallback', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('out'),
      file('main.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockGitignore() // no .gitignore → use FALLBACK_IGNORE
    vi.mocked(readFile).mockResolvedValueOnce('code')
    const result = await scan('/project') as { totalFiles: number }
    // 'out' should be ignored (not recursed into)
    expect(readdir).toHaveBeenCalledTimes(1) // only root dir, 'out' not traversed
    expect(result.totalFiles).toBe(1)
  })

  it('ignores ".cache" directory via fallback', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('.cache'),
      file('app.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockGitignore()
    vi.mocked(readFile).mockResolvedValueOnce('code')
    const result = await scan('/project') as { totalFiles: number }
    expect(readdir).toHaveBeenCalledTimes(1)
    expect(result.totalFiles).toBe(1)
  })

  it('ignores "coverage" directory via fallback', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('coverage'),
      file('index.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockGitignore()
    vi.mocked(readFile).mockResolvedValueOnce('x')
    const result = await scan('/project') as { totalFiles: number }
    expect(readdir).toHaveBeenCalledTimes(1)
    expect(result.totalFiles).toBe(1)
  })

  it('ignores "dist" directory via fallback', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('dist'),
      file('app.js'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockGitignore()
    vi.mocked(readFile).mockResolvedValueOnce('x')
    const result = await scan('/project') as { totalFiles: number }
    expect(readdir).toHaveBeenCalledTimes(1)
    expect(result.totalFiles).toBe(1)
  })

  it('ignores "node_modules" directory via fallback', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('node_modules'),
      file('lib.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockGitignore()
    vi.mocked(readFile).mockResolvedValueOnce('x')
    const result = await scan('/project') as { totalFiles: number }
    expect(readdir).toHaveBeenCalledTimes(1)
    expect(result.totalFiles).toBe(1)
  })
})
