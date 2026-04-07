/**
 * IPC handlers — File system operations
 *
 * Handles fs:listDir, fs:readFile, fs:writeFile for the renderer.
 *
 * @module ipc-fs
 */

import { ipcMain, app } from 'electron'
import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, resolve, sep } from 'path'
import { assertProjectPathAllowed } from './db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FS_SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.DS_Store', '__pycache__'])

/**
 * Lists a single directory level (async, non-blocking).
 * Directories have `children: undefined` — the renderer expands them lazily.
 */
export async function buildTree(dirPath: string): Promise<FileNode[]> {
  let entries: Dirent[]
  try { entries = await readdir(dirPath, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter(e => !FS_SKIP.has(e.name) && (e.name[0] !== '.' || e.name === '.claude'))
    .map(e => {
      const fullPath = join(dirPath, e.name)
      const isDir = e.isDirectory()
      return { name: e.name, path: fullPath, isDir, children: isDir ? undefined : undefined }
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/**
 * Check if a file path is within an allowed directory (with separator boundary check).
 * @param filePath - Path to validate
 * @param allowedDir - Allowed root directory
 * @returns {boolean} true if path is within allowedDir
 */
export function isPathAllowed(filePath: string, allowedDir: string): boolean {
  const resolved = resolve(filePath)
  const allowed = resolve(allowedDir)
  // T318: Require path separator boundary to prevent /project-evil matching /project
  return resolved === allowed || resolved.startsWith(allowed + sep)
}

// T531: Whitelist of file extensions allowed for fs:writeFile
export const ALLOWED_WRITE_EXTENSIONS = ['.md', '.ts', '.js', '.json', '.txt', '.yaml', '.yml', '.toml', '.vue', '.css', '.html', '.sh', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.cs', '.php', '.xml', '.env', '.gitignore', '.eslintrc', '.prettierrc']

// ── Handler registration ─────────────────────────────────────────────────────

/** Register filesystem IPC handlers (listDir, readFile, writeFile, saveImage). */
export function registerFsHandlers(): void {
  /**
   * Save a base64-encoded image to a temp directory.
   * @param base64Data - Base64-encoded image data
   * @param mediaType - MIME type (image/png, image/webp, image/jpeg, etc.)
   * @returns {{ success: true, path: string }} Absolute path to the saved file
   */
  ipcMain.handle('fs:saveImage', async (_event, base64Data: string, mediaType: string): Promise<{ success: true; path: string }> => {
    const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg'
    const dir = join(app.getPath('temp'), 'kanbagent', 'images')
    await mkdir(dir, { recursive: true })
    const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const filePath = join(dir, filename)
    await writeFile(filePath, Buffer.from(base64Data, 'base64'))
    return { success: true, path: filePath }
  })
  /**
   * List directory contents (directories first, sorted). Path must be within allowedDir.
   * @param dirPath - Directory to list
   * @param allowedDir - Allowed root directory for security
   * @returns {FileNode[]} Directory entries
   */
  ipcMain.handle('fs:listDir', async (_event, dirPath: string, allowedDir: string): Promise<FileNode[]> => {
    if (!allowedDir) {
      console.warn('[IPC fs:listDir] Missing mandatory allowedDir')
      return []
    }
    try { assertProjectPathAllowed(allowedDir) } catch {
      console.error('[IPC fs:listDir] BLOCKED: allowedDir not in allowlist:', allowedDir)
      return []
    }
    if (dirPath.includes('..')) {
      console.warn('[IPC fs:listDir] Blocked path traversal attempt:', dirPath)
      return []
    }
    if (!isPathAllowed(dirPath, allowedDir)) {
      console.warn('[IPC fs:listDir] Path not in allowed directory:', dirPath, allowedDir)
      return []
    }
    return buildTree(dirPath)
  })

  /**
   * Read a text file. Path must be within allowedDir.
   * @param filePath - File to read
   * @param allowedDir - Allowed root directory
   * @returns {{ success: boolean, content?: string, error?: string }}
   */
  ipcMain.handle('fs:readFile', async (_event, filePath: string, allowedDir: string) => {
    if (!allowedDir) {
      console.warn('[IPC fs:readFile] Missing mandatory allowedDir')
      return { success: false, error: 'Missing mandatory allowedDir' }
    }
    try { assertProjectPathAllowed(allowedDir) } catch {
      console.warn('[IPC fs:readFile] allowedDir not in allowlist:', allowedDir)
      return { success: false, error: 'Directory not in allowed project paths' }
    }
    if (filePath.includes('..')) {
      console.warn('[IPC fs:readFile] Blocked path traversal attempt:', filePath)
      return { success: false, error: 'Path traversal not allowed' }
    }
    if (!isPathAllowed(filePath, allowedDir)) {
      console.warn('[IPC fs:readFile] Path not in allowed directory:', filePath, allowedDir)
      return { success: false, error: 'Path not in allowed directory' }
    }
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  /**
   * Write a text file. Path must be within allowedDir and not a sensitive system file.
   * @param filePath - File to write
   * @param content - Text content
   * @param allowedDir - Allowed root directory
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string, allowedDir: string): Promise<{ success: boolean; error?: string }> => {
    if (!allowedDir) {
      console.warn('[IPC fs:writeFile] Missing mandatory allowedDir')
      return { success: false, error: 'Missing mandatory allowedDir' }
    }
    try { assertProjectPathAllowed(allowedDir) } catch {
      console.warn('[IPC fs:writeFile] allowedDir not in allowlist:', allowedDir)
      return { success: false, error: 'Directory not in allowed project paths' }
    }
    if (filePath.includes('..')) {
      console.warn('[IPC fs:writeFile] Blocked path traversal attempt:', filePath)
      return { success: false, error: 'Path traversal not allowed' }
    }
    if (!isPathAllowed(filePath, allowedDir)) {
      console.warn('[IPC fs:writeFile] Path not in allowed directory:', filePath, allowedDir)
      return { success: false, error: 'Path not in allowed directory. Write is only permitted within the project directory.' }
    }
    const lastDot = filePath.lastIndexOf('.')
    const ext = lastDot >= 0 ? filePath.slice(lastDot).toLowerCase() : ''
    if (!ext || !ALLOWED_WRITE_EXTENSIONS.includes(ext)) {
      console.warn('[IPC fs:writeFile] Blocked: file extension not allowed:', filePath)
      return { success: false, error: 'File type not allowed' }
    }
    try {
      await writeFile(filePath, content, 'utf-8')
      console.log('[IPC fs:writeFile] File written:', filePath)
      return { success: true }
    } catch (err) {
      console.error('[IPC fs:writeFile]', err)
      return { success: false, error: String(err) }
    }
  })
}
