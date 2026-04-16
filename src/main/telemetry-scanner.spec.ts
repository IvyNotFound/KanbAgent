/**
 * Tests for telemetry-scanner.ts (T1952)
 *
 * Covers:
 * - LANGUAGE_MAP: key extension coverage
 * - loadGitignore (via scanProject): .gitignore present vs FALLBACK_IGNORE
 * - TEST_NAME_RE (via isTestFile detection): .spec. and .test. in filename
 * - scanDirectory / scanProject: files/lines counting, sourceFiles vs testFiles
 * - gitignore exclusion (node_modules / dist ignored)
 * - percent calculation sums to 100%
 * - countLines (analyzeFile): blank/comment/code correctly separated for TS
 *
 * Framework: Vitest (node environment — configured via environmentMatchGlobs)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dirent } from 'fs'

// ── fs/promises mock ──────────────────────────────────────────────────────────

const mockReaddir = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())

vi.mock('fs/promises', () => ({
  default: { readdir: mockReaddir, readFile: mockReadFile },
  readdir: mockReaddir,
  readFile: mockReadFile,
}))

// ── ignore mock ───────────────────────────────────────────────────────────────
// We let the real `ignore` library run so gitignore logic is actually tested.
// (no vi.mock for 'ignore')

import { LANGUAGE_MAP, scanProject } from './telemetry-scanner'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDirent(name: string, isDir: boolean, parentPath = '/project'): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: parentPath,
    parentPath,
  } as unknown as Dirent
}

function dir(name: string, parent = '/project'): Dirent {
  return makeDirent(name, true, parent)
}
function file(name: string, parent = '/project'): Dirent {
  return makeDirent(name, false, parent)
}

// ── LANGUAGE_MAP ──────────────────────────────────────────────────────────────

describe('LANGUAGE_MAP', () => {
  it('contains .ts → TypeScript', () => {
    expect(LANGUAGE_MAP['.ts']).toBe('TypeScript')
  })

  it('contains .vue → Vue', () => {
    expect(LANGUAGE_MAP['.vue']).toBe('Vue')
  })

  it('contains .js → JavaScript', () => {
    expect(LANGUAGE_MAP['.js']).toBe('JavaScript')
  })

  it('contains .py → Python', () => {
    expect(LANGUAGE_MAP['.py']).toBe('Python')
  })

  it('contains .go → Go', () => {
    expect(LANGUAGE_MAP['.go']).toBe('Go')
  })

  it('contains .rs → Rust', () => {
    expect(LANGUAGE_MAP['.rs']).toBe('Rust')
  })

  it('contains .css → CSS', () => {
    expect(LANGUAGE_MAP['.css']).toBe('CSS')
  })

  it('contains .sql → SQL', () => {
    expect(LANGUAGE_MAP['.sql']).toBe('SQL')
  })

  it('does not map unknown extensions', () => {
    expect(LANGUAGE_MAP['.xyz']).toBeUndefined()
  })
})

// ── scanProject — basic file counting ────────────────────────────────────────

describe('scanProject — file/line counting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zero totals when directory is empty', async () => {
    // readFile throws (no .gitignore) → uses FALLBACK_IGNORE
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockReaddir.mockResolvedValue([])

    const result = await scanProject('/project')

    expect(result.totalFiles).toBe(0)
    expect(result.totalLines).toBe(0)
    expect(result.languages).toHaveLength(0)
    expect(result.testRatio).toBe(0)
  })

  it('counts a single TypeScript source file correctly', async () => {
    // No .gitignore
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      // The actual .ts file content: 3 code lines
      return Promise.resolve('const a = 1\nconst b = 2\nconst c = 3')
    })

    mockReaddir.mockResolvedValueOnce([file('index.ts')])

    const result = await scanProject('/project')

    expect(result.totalFiles).toBe(1)
    expect(result.totalLines).toBe(3)
    expect(result.languages).toHaveLength(1)
    expect(result.languages[0].name).toBe('TypeScript')
    expect(result.languages[0].files).toBe(1)
    expect(result.languages[0].lines).toBe(3)
    expect(result.languages[0].sourceFiles).toBe(1)
    expect(result.languages[0].testFiles).toBe(0)
  })

  it('separates sourceFiles and testFiles by .spec. in name', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('line1\nline2')
    })

    // Two .ts files: one source, one spec
    mockReaddir.mockResolvedValueOnce([
      file('index.ts'),
      file('index.spec.ts'),
    ])

    const result = await scanProject('/project')

    const ts = result.languages.find((l) => l.name === 'TypeScript')!
    expect(ts).toBeDefined()
    expect(ts.sourceFiles).toBe(1)
    expect(ts.testFiles).toBe(1)
    expect(result.totalSourceFiles).toBe(1)
    expect(result.totalTestFiles).toBe(1)
  })

  it('separates sourceLines and testLines correctly', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('a\nb\nc')  // 3 lines per file
    })

    mockReaddir.mockResolvedValueOnce([
      file('app.ts'),
      file('app.test.ts'),
    ])

    const result = await scanProject('/project')

    const ts = result.languages.find((l) => l.name === 'TypeScript')!
    expect(ts.sourceLines).toBe(3)
    expect(ts.testLines).toBe(3)
    expect(result.totalSourceLines).toBe(3)
    expect(result.totalTestLines).toBe(3)
  })

  it('percent sums to 100% with two languages', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10')
    })

    mockReaddir.mockResolvedValueOnce([
      file('a.ts'),
      file('b.vue'),
    ])

    const result = await scanProject('/project')

    const total = result.languages.reduce((sum, l) => sum + l.percent, 0)
    // With equal line counts, each is 50% → sum = 100
    expect(Math.round(total)).toBe(100)
  })
})

// ── scanProject — gitignore integration ──────────────────────────────────────

describe('scanProject — gitignore exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores node_modules directory when .gitignore contains it', async () => {
    // .gitignore lists node_modules
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) return Promise.resolve('node_modules\n')
      return Promise.resolve('code')
    })

    // Root dir has node_modules/ dir and one real file
    mockReaddir.mockImplementation((dirPath: string) => {
      if (dirPath === '/project') {
        return Promise.resolve([
          dir('node_modules'),
          file('index.ts'),
        ])
      }
      // node_modules subdir should never be visited
      return Promise.resolve([file('lodash.js')])
    })

    const result = await scanProject('/project')

    // Only index.ts should be counted, not lodash.js inside node_modules
    expect(result.totalFiles).toBe(1)
  })

  it('uses FALLBACK_IGNORE (node_modules, dist) when no .gitignore', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('code')
    })

    mockReaddir.mockImplementation((dirPath: string) => {
      if (dirPath === '/project') {
        return Promise.resolve([
          dir('node_modules'),
          dir('dist'),
          file('index.ts'),
        ])
      }
      return Promise.resolve([file('something.js')])
    })

    const result = await scanProject('/project')

    // node_modules and dist are in FALLBACK_IGNORE, so only index.ts counted
    expect(result.totalFiles).toBe(1)
    const ts = result.languages.find((l) => l.name === 'TypeScript')
    expect(ts).toBeDefined()
  })

  it('ignores dist directory via FALLBACK_IGNORE', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('line')
    })

    mockReaddir.mockImplementation((dirPath: string) => {
      if (dirPath === '/project') {
        return Promise.resolve([dir('dist'), file('src.ts')])
      }
      return Promise.resolve([file('bundle.js')])
    })

    const result = await scanProject('/project')

    expect(result.totalFiles).toBe(1)
  })
})

// ── analyzeFile (via scanProject) — line counting ────────────────────────────

describe('scanProject — line type counting (blank/comment/code)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts blank lines correctly', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      // 2 code lines, 2 blank lines
      return Promise.resolve('const a = 1\n\nconst b = 2\n')
    })

    mockReaddir.mockResolvedValueOnce([file('a.ts')])

    const result = await scanProject('/project')

    const ts = result.languages[0]
    expect(ts.blankLines).toBe(2)  // "" and trailing newline creates empty line
    expect(ts.codeLines).toBe(2)
  })

  it('counts // comment lines for TypeScript', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('// a comment\nconst x = 1\n// another comment')
    })

    mockReaddir.mockResolvedValueOnce([file('b.ts')])

    const result = await scanProject('/project')

    const ts = result.languages[0]
    expect(ts.commentLines).toBe(2)
    expect(ts.codeLines).toBe(1)
  })

  it('counts /* block comment lines', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('/* start\n * continuation\n */\ncode()')
    })

    mockReaddir.mockResolvedValueOnce([file('c.ts')])

    const result = await scanProject('/project')

    const ts = result.languages[0]
    // "/* start" → comment, " * continuation" → comment (starts with *), " */" → comment
    expect(ts.commentLines).toBe(3)
    expect(ts.codeLines).toBe(1)
  })

  it('counts # comment lines (Python)', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('# comment\nprint("hello")')
    })

    mockReaddir.mockResolvedValueOnce([file('script.py')])

    const result = await scanProject('/project')

    const py = result.languages.find((l) => l.name === 'Python')!
    expect(py.commentLines).toBe(1)
    expect(py.codeLines).toBe(1)
  })
})

// ── scanProject — testRatio ───────────────────────────────────────────────────

describe('scanProject — testRatio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when no files exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockReaddir.mockResolvedValue([])

    const result = await scanProject('/project')

    expect(result.testRatio).toBe(0)
  })

  it('returns 50 when source and test lines are equal', async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if ((filePath as string).endsWith('.gitignore')) throw new Error('ENOENT')
      return Promise.resolve('line1\nline2')
    })

    mockReaddir.mockResolvedValueOnce([file('a.ts'), file('a.spec.ts')])

    const result = await scanProject('/project')

    expect(result.testRatio).toBe(50)
  })
})

// ── scanProject — scannedAt ───────────────────────────────────────────────────

describe('scanProject — metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes a valid ISO scannedAt timestamp', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    mockReaddir.mockResolvedValue([])

    const result = await scanProject('/project')

    expect(() => new Date(result.scannedAt)).not.toThrow()
    expect(isNaN(new Date(result.scannedAt).getTime())).toBe(false)
  })
})
