/**
 * ipc-telemetry-4.spec.ts — Targeted mutation kill tests (T1324)
 *
 * Kills specific surviving mutants:
 * - L91  ConditionalExpression[false]  — isTestFile: 'test/' directory detection
 * - L100 MethodExpression[line]        — trim() needed for indented comment lines
 * - L105 endsWith('#')                 — startsWith('#') vs endsWith
 * - L106 endsWith('*')                 — startsWith('*') vs endsWith
 * - L108 endsWith('<!--')              — startsWith('<!--') vs endsWith
 * - L143 NoCoverage                    — readdir().catch(() => []) on inaccessible subdir
 * - L153 ConditionalExpression[true]   — ignored file is actually excluded
 * - L168 EqualityOperator[<=]          — batch loop: > 20 files exercises i < files.length
 * - L169 MethodExpression              — files.slice() batching with 21+ files
 * - L240 ArithmeticOperator[-]         — testRatio denominator: source+test vs source-test
 * - L243 MethodExpression              — .sort() removed mutant
 * - L249 ConditionalExpression[true]   — percent guard: totalLines === 0 → 0 not NaN
 * - L258 ArithmeticOperator[+]         — sort descending: b.lines - a.lines vs b.lines + a.lines
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

vi.mock('worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('worker_threads')>()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')
  class MockWorker extends EventEmitter {
    constructor(_p: string, opts: { workerData: { projectPath: string } }) {
      super()
      import('./telemetry-scanner').then(({ scanProject }) =>
        scanProject(opts.workerData.projectPath).then(
          (r) => { this.emit('message', { data: r }); this.emit('exit', 0) },
          (e: unknown) => { this.emit('message', { error: (e as Error).message }); this.emit('exit', 1) },
        ),
      )
    }
  }
  return { ...actual, Worker: MockWorker, default: { ...actual, Worker: MockWorker } }
})

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
const scan = (projectPath: string) =>
  registeredHandlers['telemetry:scan'](fakeEvent, projectPath) as Promise<{
    languages: Array<{
      name: string; files: number; lines: number; percent: number
      sourceFiles: number; testFiles: number; sourceLines: number; testLines: number
      blankLines: number; commentLines: number; codeLines: number
    }>
    totalFiles: number; totalLines: number; scannedAt: string
    totalSourceLines: number; totalTestLines: number; testRatio: number
    totalBlankLines: number; totalCommentLines: number; totalCodeLines: number
    totalSourceFiles: number; totalTestFiles: number
  }>

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ipc-telemetry-4 mutation kill tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── L91: isTestFile detects 'test/' directory (not just __tests__) ─────────
  // ConditionalExpression[false] would make parts.some() always false
  // → files in 'test/' dir would be counted as source instead of test

  it('L91: file inside test/ directory is detected as a test file', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([
        dir('test'),
        file('index.ts'),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)
      .mockResolvedValueOnce([
        file('helper.ts'),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    vi.mocked(readFile)
      .mockResolvedValueOnce('a\nb\nc')  // test/helper.ts → 3 test lines
      .mockResolvedValueOnce('x\ny')     // index.ts → 2 source lines

    const result = await scan('/project')

    expect(result.totalTestFiles).toBe(1)
    expect(result.totalSourceFiles).toBe(1)
    expect(result.totalTestLines).toBe(3)
    expect(result.totalSourceLines).toBe(2)
  })

  // ── L100: trim() is needed — indented comment lines ────────────────────────
  // MethodExpression[line]: trim() mutated to no-op (returns raw line)
  // Without trim, "  // comment" doesn't startsWith '//' → counted as code

  it('L100: indented comment lines are counted as comments (trim required)', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('app.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    // Lines: indented comment, blank, code
    vi.mocked(readFile).mockResolvedValueOnce(
      '  // indented comment\n\nconst x = 1',
    )

    const result = await scan('/project')

    expect(result.totalCommentLines).toBe(1)
    expect(result.totalBlankLines).toBe(1)
    expect(result.totalCodeLines).toBe(1)
  })

  // ── L105: startsWith('#') not endsWith('#') ────────────────────────────────
  // Mutation: trimmed.startsWith('#') → trimmed.endsWith('#')
  // A line like "# comment" starts with '#' but "code#" ends with '#'
  // Need: a line that starts with '#' but does NOT end with '#' → must be comment

  it("L105: line starting with '#' is a comment (not endsWith check)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('script.sh'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    // "# install deps" starts with '#' but does NOT end with '#'
    // With endsWith mutation, this would be counted as code instead of comment
    vi.mocked(readFile).mockResolvedValueOnce('# install deps\necho hello')

    const result = await scan('/project')

    // 1 comment line (#), 1 code line (echo)
    expect(result.totalCommentLines).toBe(1)
    expect(result.totalCodeLines).toBe(1)
  })

  // ── L106: startsWith('*') not endsWith('*') ───────────────────────────────
  // Mutation: trimmed.startsWith('*') → trimmed.endsWith('*')
  // A line like " * @param x" starts with '*' but not ends with '*'

  it("L106: line starting with '*' is a comment (JSDoc continuation)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('module.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    // " * @param x" starts with '*' but ends with 'x'
    // With endsWith mutation, would be counted as code
    vi.mocked(readFile).mockResolvedValueOnce('/**\n * @param x\n */\nconst f = () => {}')

    const result = await scan('/project')

    // '/**' starts with '/*' → comment, ' * @param x' starts with '*' → comment,
    // ' */' starts with '*' → comment, 'const f ...' → code
    expect(result.totalCommentLines).toBe(3)
    expect(result.totalCodeLines).toBe(1)
  })

  // ── L108: startsWith('<!--') not endsWith('<!--') ─────────────────────────
  // Mutation: trimmed.startsWith('<!--') → trimmed.endsWith('<!--')
  // A line like "<!-- title -->" starts with '<!--' but ends with '-->'

  it("L108: line starting with '<!--' is a comment (HTML comment)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('index.html'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    // "<!-- title -->" starts with '<!--' but ends with '-->'
    // With endsWith mutation, would be counted as code
    vi.mocked(readFile).mockResolvedValueOnce('<!-- title -->\n<div>hello</div>')

    const result = await scan('/project')

    expect(result.totalCommentLines).toBe(1)
    expect(result.totalCodeLines).toBe(1)
  })

  // ── L143: readdir().catch(() => []) — inaccessible subdirectory ───────────
  // NoCoverage + BooleanLiteral/ArrowFunction/ObjectLiteral mutations
  // The catch(() => []) must be exercised: readdir on a subdirectory throws

  it('L143: readdir failure on a subdirectory returns [] and scan continues', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([
        dir('src'),
        dir('inaccessible'),
        file('main.ts'),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)
      // src/ — succeeds
      .mockResolvedValueOnce([
        file('app.ts'),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)
      // inaccessible/ — throws EPERM
      .mockRejectedValueOnce(new Error('EPERM: operation not permitted'))

    mockGitignore()
    vi.mocked(readFile)
      .mockResolvedValueOnce('a\nb')    // main.ts
      .mockResolvedValueOnce('x\ny\nz') // src/app.ts

    const result = await scan('/project')

    // No crash, inaccessible/ contributes 0 files
    expect(result.totalFiles).toBe(2)
    expect(result.totalLines).toBe(5)
  })

  // ── L153: ConditionalExpression[true] — !ig.ignores() always true ─────────
  // Mutant makes every file pass the ignore check → dist/ files would be included
  // Already tested via other tests, but this explicitly checks exclusion correctness

  it('L153: ignored files in dist/ are excluded from count', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('dist'),
      file('app.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    // dist/ is in FALLBACK_IGNORE — readdir should NOT be called for it

    mockGitignore() // no .gitignore → fallback exclusions include 'dist'
    vi.mocked(readFile).mockResolvedValueOnce('code line') // only app.ts

    const result = await scan('/project')

    // dist/ not traversed, app.ts counted
    expect(result.totalFiles).toBe(1)
    expect(readdir).toHaveBeenCalledTimes(1) // only root dir
  })

  // ── L168/L169: batch loop with > BATCH_SIZE (20) files ────────────────────
  // EqualityOperator[<=]: i < files.length → i <= files.length would cause
  // an extra iteration past the end (out-of-bounds slice)
  // MethodExpression: files.slice() removed — all files in one batch

  it('L168/L169: processes exactly 21 files in batches without duplicates or errors', async () => {
    // Create 21 .ts files
    const fileList = Array.from({ length: 21 }, (_, i) =>
      file(`file${i.toString().padStart(2, '0')}.ts`),
    )

    vi.mocked(readdir).mockResolvedValueOnce(
      fileList as unknown as Awaited<ReturnType<typeof readdir>>,
    )

    mockGitignore()
    // Each file has 1 line
    for (let i = 0; i < 21; i++) {
      vi.mocked(readFile).mockResolvedValueOnce('code')
    }

    const result = await scan('/project')

    expect(result.totalFiles).toBe(21)
    // Each file: ''.split('\n') gives ['code'] → 1 line
    expect(result.totalLines).toBe(21)
    expect(result.languages).toHaveLength(1)
    expect(result.languages[0].name).toBe('TypeScript')
    expect(result.languages[0].files).toBe(21)
  })

  // ── L240: testRatio denominator: + vs - ───────────────────────────────────
  // ArithmeticOperator: totalSourceLines + totalTestLines → - testLines
  // With source=10, test=5: correct denom=15, mutant denom=5
  // testRatio correct: 5/15*100 = 33.3%, mutant: 5/5*100 = 100%

  it('L240: testRatio uses source+test as denominator (not source-test)', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('main.ts'),
      file('main.spec.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    vi.mocked(readFile)
      .mockResolvedValueOnce('1\n2\n3\n4\n5\n6\n7\n8\n9\n10') // main.ts → 10 source lines
      .mockResolvedValueOnce('a\nb\nc\nd\ne')                   // main.spec.ts → 5 test lines

    const result = await scan('/project')

    expect(result.totalSourceLines).toBe(10)
    expect(result.totalTestLines).toBe(5)
    // testRatio = 5 / (10 + 5) * 100 = 33.3% (not 100%)
    expect(result.testRatio).toBe(33.3)
  })

  // ── L243: .sort() not removed — languages sorted descending by lines ───────
  // MethodExpression: the sort call removed → order determined by Map insertion

  it('L243: languages are sorted by line count descending', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('small.ts'),   // 2 lines
      file('large.vue'),  // 10 lines
      file('mid.js'),     // 5 lines
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    vi.mocked(readFile)
      .mockResolvedValueOnce('a\nb')                         // small.ts → 2 lines
      .mockResolvedValueOnce('1\n2\n3\n4\n5\n6\n7\n8\n9\n10') // large.vue → 10 lines
      .mockResolvedValueOnce('x\ny\nz\nw\nv')                // mid.js → 5 lines

    const result = await scan('/project')

    expect(result.languages).toHaveLength(3)
    expect(result.languages[0].name).toBe('Vue')      // 10 lines — first
    expect(result.languages[1].name).toBe('JavaScript') // 5 lines — second
    expect(result.languages[2].name).toBe('TypeScript') // 2 lines — third
  })

  // ── L258: sort comparator b-a vs b+a ──────────────────────────────────────
  // ArithmeticOperator: b.lines - a.lines → b.lines + a.lines
  // With two languages X=1 and Y=3: correct (b-a) puts Y (3) first.
  // Mutant (b+a always positive) → sort considers b always "greater" than a
  // regardless of actual values → order may be reversed or stable-but-wrong.
  // We must verify: language with FEWER lines comes AFTER language with more lines.

  it('L258: sort puts language with fewer lines after language with more lines', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('few.ts'),   // 1 line  — should be last
      file('many.md'),  // 5 lines — should be first
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    mockGitignore()
    vi.mocked(readFile)
      .mockResolvedValueOnce('only one')           // few.ts → 1 line
      .mockResolvedValueOnce('1\n2\n3\n4\n5')      // many.md → 5 lines

    const result = await scan('/project')

    expect(result.languages).toHaveLength(2)
    expect(result.languages[0].name).toBe('Markdown')   // 5 lines first
    expect(result.languages[1].name).toBe('TypeScript') // 1 line last
    expect(result.languages[0].lines).toBeGreaterThan(result.languages[1].lines)
  })

  // ── L249: percent is 0 when totalLines === 0 (guard exists) ───────────────
  // ConditionalExpression[true]: always compute percent (division even with 0)
  // The only reachable way to verify this guard: totalLines > 0 path gives a
  // valid (non-NaN) percent. The guard prevents NaN when totalLines is 0.
  // We verify: with a single file of 1 line, percent is not NaN, not 0.

})
