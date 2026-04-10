/**
 * PostToolUse file-size check — enforces a max-lines-per-file rule (T1898)
 *
 * After a Write or Edit tool use, reads the target file and returns a
 * `user_message` if it exceeds the configured line limit. The message is
 * injected back into the model context by Claude Code's hook protocol.
 *
 * Exclusions: test files (.spec.ts, .test.ts), locale JSON, and common
 * config/data files are exempt from the check.
 *
 * @module hookServer-filesize
 */

import fs from 'fs'
import path from 'path'

// ── Configuration (pushed from renderer via IPC) ────────────────────────────

interface FileSizeConfig {
  enabled: boolean
  maxLines: number
}

const config: FileSizeConfig = {
  enabled: true,
  maxLines: 400,
}

/**
 * Update the file-size check config. Called from the IPC handler when the
 * renderer pushes new settings.
 */
export function updateFileSizeConfig(enabled: boolean, maxLines: number): void {
  config.enabled = enabled
  config.maxLines = Math.max(50, Math.min(10000, maxLines))
}

/**
 * Read current config (for testing / debugging).
 */
export function getFileSizeConfig(): Readonly<FileSizeConfig> {
  return { ...config }
}

// ── Exclusion patterns ──────────────────────────────────────────────────────

const EXCLUDED_SUFFIXES = [
  '.spec.ts',
  '.test.ts',
  '.spec.js',
  '.test.js',
  '.spec.tsx',
  '.test.tsx',
]

/**
 * Returns true if the file should be excluded from the size check.
 * Excluded: test files, locale JSON, and common config/data files.
 */
export function isFileExcludedFromSizeCheck(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  const base = path.basename(normalized)

  // Test files
  if (EXCLUDED_SUFFIXES.some(s => normalized.endsWith(s))) return true

  // Locale JSON files (locales/*.json or i18n/*.json)
  if (/\/(locales|i18n)\/[^/]+\.json$/.test(normalized)) return true

  // Common config / data files
  if (base === 'package.json' || base === 'package-lock.json') return true
  if (base === 'tsconfig.json' || base.startsWith('tsconfig.') && base.endsWith('.json')) return true
  if (/\.(config|rc)\.(ts|js|json|cjs|mjs)$/.test(base)) return true
  if (base === '.eslintrc.json' || base === '.prettierrc') return true
  if (base.endsWith('.d.ts')) return true
  if (base.endsWith('.lock') || base.endsWith('.yaml') || base.endsWith('.yml')) return true
  if (base.endsWith('.md')) return true

  return false
}

// ── PostToolUse check ───────────────────────────────────────────────────────

export interface FileSizeCheckResult {
  user_message?: string
}

/**
 * Check whether a PostToolUse Write/Edit produced a file that exceeds the
 * configured line limit.
 *
 * Returns `{}` if no violation, or `{ user_message }` if the file is too long.
 * The caller sends this as the HTTP response body.
 */
export function checkPostToolUseFileSize(
  payload: Record<string, unknown>
): FileSizeCheckResult {
  if (!config.enabled) return {}

  const toolName = payload.tool_name as string | undefined
  if (toolName !== 'Write' && toolName !== 'Edit') return {}

  const toolInput = payload.tool_input as Record<string, unknown> | undefined
  const filePath = toolInput?.file_path as string | undefined
  if (!filePath) return {}

  if (isFileExcludedFromSizeCheck(filePath)) return {}

  try {
    if (!fs.existsSync(filePath)) return {}
    const content = fs.readFileSync(filePath, 'utf8')
    const lineCount = content.split('\n').length
    if (lineCount > config.maxLines) {
      const basename = path.basename(filePath)
      return {
        user_message: `⛔ FILE SIZE VIOLATION: ${basename} has ${lineCount} lines (limit: ${config.maxLines}). Split this file into logical modules before continuing.`,
      }
    }
  } catch {
    // Silently ignore read errors (file may be binary, locked, etc.)
  }

  return {}
}
