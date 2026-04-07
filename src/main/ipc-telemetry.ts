/**
 * IPC Handlers — Project telemetry (language statistics)
 *
 * Provides `telemetry:scan` which walks the project directory tree and returns
 * per-language file/line counts (ignoring build artifacts and `node_modules`).
 * Results are displayed in {@link TelemetryView}.
 *
 * @module ipc-telemetry
 */
import { ipcMain } from 'electron'
import { readdir, readFile } from 'fs/promises'
import path from 'path'
import ignore from 'ignore'
import { assertProjectPathAllowed } from './db'

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.vue': 'Vue',
  '.js': 'JavaScript',
  '.css': 'CSS',
  '.html': 'HTML',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.sh': 'Shell',
  '.sql': 'SQL',
}

/** Fallback exclusions when no .gitignore is found in the project root. */
const FALLBACK_IGNORE = ['node_modules', 'dist', 'out', '.cache', 'coverage']

/** Load .gitignore rules from the project root. Always excludes .git. */
async function loadGitignore(projectRoot: string): ReturnType<typeof ignore> {
  const ig = ignore()
  ig.add('.git')
  try {
    const content = await readFile(path.join(projectRoot, '.gitignore'), 'utf-8')
    ig.add(content)
  } catch {
    ig.add(FALLBACK_IGNORE)
  }
  return ig
}

const TEST_NAME_RE = /\.(spec|test)\./

interface LineStats {
  total: number
  blank: number
  comment: number
  code: number
}

interface LangStat {
  name: string
  files: number
  lines: number
  percent: number
  sourceFiles: number
  testFiles: number
  sourceLines: number
  testLines: number
  blankLines: number
  commentLines: number
  codeLines: number
}

interface TelemetryResult {
  languages: LangStat[]
  totalFiles: number
  totalLines: number
  scannedAt: string
  totalSourceLines: number
  totalTestLines: number
  testRatio: number
  totalBlankLines: number
  totalCommentLines: number
  totalCodeLines: number
  totalSourceFiles: number
  totalTestFiles: number
}

function isTestFile(filePath: string): boolean {
  const basename = path.basename(filePath)
  if (TEST_NAME_RE.test(basename)) return true
  const parts = filePath.split(/[\\/]/)
  return parts.some((p) => p === '__tests__' || p === 'test')
}

async function analyzeFile(filePath: string): Promise<LineStats> {
  const content = await readFile(filePath, 'utf-8').catch(() => '')
  const lines = content.split('\n')
  let blank = 0
  let comment = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      blank++
    } else if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('<!--')
    ) {
      comment++
    }
  }
  return { total: lines.length, blank, comment, code: lines.length - blank - comment }
}

interface ExtStats {
  files: number
  lines: number
  sourceFiles: number
  testFiles: number
  sourceLines: number
  testLines: number
  blankLines: number
  commentLines: number
  codeLines: number
}

interface FileEntry {
  filePath: string
  ext: string
  isTest: boolean
}

const BATCH_SIZE = 20

/** Phase 1: DFS to collect all matching file paths (sequential, avoids EMFILE on deep trees). */
async function collectFiles(
  dir: string,
  rootDir: string,
  ig: ReturnType<typeof ignore>,
): Promise<FileEntry[]> {
  const result: FileEntry[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (!ig.ignores(relativePath + '/')) {
        const sub = await collectFiles(fullPath, rootDir, ig)
        result.push(...sub)
      }
    } else {
      if (!ig.ignores(relativePath)) {
        const ext = path.extname(entry.name).toLowerCase()
        if (LANGUAGE_MAP[ext]) {
          result.push({ filePath: fullPath, ext, isTest: isTestFile(fullPath) })
        }
      }
    }
  }
  return result
}

/** Phase 2: Analyze files in parallel batches then accumulate stats. */
async function scanDir(dir: string, stats: Map<string, ExtStats>): Promise<void> {
  const ig = await loadGitignore(dir)
  const files = await collectFiles(dir, dir, ig)
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const lineStats = await Promise.all(batch.map(({ filePath }) => analyzeFile(filePath)))
    for (let j = 0; j < batch.length; j++) {
      const { ext, isTest } = batch[j]
      const ls = lineStats[j]
      const s = stats.get(ext) ?? {
        files: 0,
        lines: 0,
        sourceFiles: 0,
        testFiles: 0,
        sourceLines: 0,
        testLines: 0,
        blankLines: 0,
        commentLines: 0,
        codeLines: 0,
      }
      stats.set(ext, {
        files: s.files + 1,
        lines: s.lines + ls.total,
        sourceFiles: s.sourceFiles + (isTest ? 0 : 1),
        testFiles: s.testFiles + (isTest ? 1 : 0),
        sourceLines: s.sourceLines + (isTest ? 0 : ls.total),
        testLines: s.testLines + (isTest ? ls.total : 0),
        blankLines: s.blankLines + ls.blank,
        commentLines: s.commentLines + ls.comment,
        codeLines: s.codeLines + ls.code,
      })
    }
  }
}

/** Register telemetry IPC handlers. */
export function registerTelemetryHandlers(): void {
  /**
   * Recursively scan `projectPath` and return per-language statistics.
   * Build directories (`dist`, `node_modules`, `.git`, etc.) are skipped.
   * @param projectPath - Absolute path to the project root
   * @returns {TelemetryResult} Language breakdown, total counts, and scan timestamp
   */
  ipcMain.handle(
    'telemetry:scan',
    async (_event, projectPath: string): Promise<TelemetryResult> => {
      if (typeof projectPath !== 'string' || !projectPath) {
        return {
          languages: [],
          totalFiles: 0,
          totalLines: 0,
          scannedAt: new Date().toISOString(),
          totalSourceLines: 0,
          totalTestLines: 0,
          testRatio: 0,
          totalBlankLines: 0,
          totalCommentLines: 0,
          totalCodeLines: 0,
          totalSourceFiles: 0,
          totalTestFiles: 0,
        }
      }
      assertProjectPathAllowed(projectPath)
      const stats = new Map<string, ExtStats>()
      await scanDir(projectPath, stats)
      const totalLines = [...stats.values()].reduce((s, v) => s + v.lines, 0)
      const totalFiles = [...stats.values()].reduce((s, v) => s + v.files, 0)
      const totalSourceLines = [...stats.values()].reduce((s, v) => s + v.sourceLines, 0)
      const totalTestLines = [...stats.values()].reduce((s, v) => s + v.testLines, 0)
      const totalBlankLines = [...stats.values()].reduce((s, v) => s + v.blankLines, 0)
      const totalCommentLines = [...stats.values()].reduce((s, v) => s + v.commentLines, 0)
      const totalCodeLines = [...stats.values()].reduce((s, v) => s + v.codeLines, 0)
      const totalSourceFiles = [...stats.values()].reduce((s, v) => s + v.sourceFiles, 0)
      const totalTestFiles = [...stats.values()].reduce((s, v) => s + v.testFiles, 0)
      const testRatio =
        totalSourceLines + totalTestLines > 0
          ? Math.round((totalTestLines / (totalSourceLines + totalTestLines)) * 1000) / 10
          : 0
      const languages: LangStat[] = [...stats.entries()]
        .map(([ext, v]) => ({
          name: LANGUAGE_MAP[ext],
          files: v.files,
          lines: v.lines,
          percent: totalLines > 0 ? Math.round((v.lines / totalLines) * 1000) / 10 : 0,
          sourceFiles: v.sourceFiles,
          testFiles: v.testFiles,
          sourceLines: v.sourceLines,
          testLines: v.testLines,
          blankLines: v.blankLines,
          commentLines: v.commentLines,
          codeLines: v.codeLines,
        }))
        .sort((a, b) => b.lines - a.lines)
      return {
        languages,
        totalFiles,
        totalLines,
        scannedAt: new Date().toISOString(),
        totalSourceLines,
        totalTestLines,
        testRatio,
        totalBlankLines,
        totalCommentLines,
        totalCodeLines,
        totalSourceFiles,
        totalTestFiles,
      }
    },
  )
}
