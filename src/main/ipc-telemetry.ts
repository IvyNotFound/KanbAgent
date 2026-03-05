import { ipcMain } from 'electron'
import { readdir, readFile } from 'fs/promises'
import path from 'path'

const LANGUAGE_MAP: Record<string, { name: string; color: string }> = {
  '.ts': { name: 'TypeScript', color: '#3178c6' },
  '.vue': { name: 'Vue', color: '#42b883' },
  '.js': { name: 'JavaScript', color: '#f7df1e' },
  '.css': { name: 'CSS', color: '#563d7c' },
  '.html': { name: 'HTML', color: '#e44b23' },
  '.py': { name: 'Python', color: '#3572A5' },
  '.go': { name: 'Go', color: '#00ADD8' },
  '.rs': { name: 'Rust', color: '#dea584' },
  '.java': { name: 'Java', color: '#b07219' },
  '.json': { name: 'JSON', color: '#292929' },
  '.md': { name: 'Markdown', color: '#083fa1' },
  '.sh': { name: 'Shell', color: '#89e051' },
  '.sql': { name: 'SQL', color: '#e38c00' },
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.cache', 'coverage', '.nyc_output'])

interface LangStat {
  name: string
  color: string
  files: number
  lines: number
  percent: number
}

interface TelemetryResult {
  languages: LangStat[]
  totalFiles: number
  totalLines: number
  scannedAt: string
}

async function countLines(filePath: string): Promise<number> {
  const content = await readFile(filePath, 'utf-8').catch(() => '')
  return content.split('\n').length
}

async function scanDir(
  dir: string,
  stats: Map<string, { files: number; lines: number }>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        await scanDir(path.join(dir, entry.name), stats)
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (!LANGUAGE_MAP[ext]) continue
      const lines = await countLines(path.join(dir, entry.name))
      const s = stats.get(ext) ?? { files: 0, lines: 0 }
      stats.set(ext, { files: s.files + 1, lines: s.lines + lines })
    }
  }
}

export function registerTelemetryHandlers(): void {
  ipcMain.handle(
    'telemetry:scan',
    async (_event, projectPath: string): Promise<TelemetryResult> => {
      if (typeof projectPath !== 'string' || !projectPath) {
        return { languages: [], totalFiles: 0, totalLines: 0, scannedAt: new Date().toISOString() }
      }
      const stats = new Map<string, { files: number; lines: number }>()
      await scanDir(projectPath, stats)
      const totalLines = [...stats.values()].reduce((s, v) => s + v.lines, 0)
      const totalFiles = [...stats.values()].reduce((s, v) => s + v.files, 0)
      const languages: LangStat[] = [...stats.entries()]
        .map(([ext, v]) => ({
          name: LANGUAGE_MAP[ext].name,
          color: LANGUAGE_MAP[ext].color,
          files: v.files,
          lines: v.lines,
          percent: totalLines > 0 ? Math.round((v.lines / totalLines) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.lines - a.lines)
      return { languages, totalFiles, totalLines, scannedAt: new Date().toISOString() }
    },
  )
}
