/**
 * Git worktree manager for agent session isolation.
 *
 * Creates an isolated git worktree before spawning a CLI session and removes it
 * when the session ends. Works for all CLI adapters (Claude, Codex, Gemini, etc.)
 * without adapter-specific changes.
 *
 * Worktree location: <repoRoot>/../agent-worktrees/<sessionId>
 * Branch name: agent/<sessionId>
 *
 * @module worktree-manager
 */
import { execFile } from 'child_process'
import { copyFile, mkdir } from 'fs/promises'
import { promisify } from 'util'
import path from 'path'
import { queryLive } from './db'
import type { CliType } from '../shared/cli-types'

const execFileAsync = promisify(execFile)

export interface WorktreeInfo {
  /** Absolute path to the created worktree directory. */
  path: string
  /** Name of the branch created for this worktree. */
  branch: string
}

/**
 * Create an isolated git worktree for an agent session.
 *
 * Branch: agent/<sessionId>
 * Path: <repoRoot>/../agent-worktrees/<sessionId>
 *
 * If the branch already exists (session restart), falls back to attaching
 * the existing branch without -b.
 *
 * @throws if git is unavailable or the repo root is invalid
 */
export async function createWorktree(repoRoot: string, sessionId: number): Promise<WorktreeInfo> {
  const branch = `agent/${sessionId}`
  const wtPath = path.resolve(repoRoot, '..', 'agent-worktrees', String(sessionId))

  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, wtPath, 'HEAD'])
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Branch already exists (session restart) — attach without -b
    if (msg.includes('already exists') || msg.includes('already linked') || msg.includes('already checked out')) {
      await execFileAsync('git', ['-C', repoRoot, 'worktree', 'add', wtPath, branch])
    } else {
      throw err
    }
  }

  return { path: wtPath, branch }
}

// ── Worktree config file copy ────────────────────────────────────────────────

/**
 * Non-git-tracked config files that must be copied into worktrees per CLI.
 * Git-tracked files (GEMINI.md, .codex/, .aider.conf.yml) are already present.
 */
export const WORKTREE_CONFIG_FILES: Record<CliType, string[]> = {
  claude: ['.claude/settings.json', '.claude/settings.local.json'],
  gemini: [],
  codex: [],
  aider: [],
  goose: [],
  opencode: [],
}

/**
 * Copy non-git-tracked CLI config files from the main repo into a worktree.
 *
 * Called after worktree creation and before session spawn (refresh).
 * Missing source files are silently skipped. Target directories are created
 * as needed. Errors are non-fatal — logged but never thrown.
 *
 * @param repoRoot     - Absolute path to the main git repository root.
 * @param worktreePath - Absolute path to the worktree directory.
 * @param cliTypes     - CLI types whose config files should be copied.
 *                        Defaults to `['claude']` (the only CLI with non-tracked config).
 */
export async function copyWorktreeConfigs(
  repoRoot: string,
  worktreePath: string,
  cliTypes: CliType[] = ['claude'],
): Promise<void> {
  const files = new Set<string>()
  for (const cli of cliTypes) {
    for (const f of WORKTREE_CONFIG_FILES[cli] ?? []) files.add(f)
  }

  for (const relPath of files) {
    const src = path.join(repoRoot, relPath)
    const dst = path.join(worktreePath, relPath)
    try {
      await mkdir(path.dirname(dst), { recursive: true })
      await copyFile(src, dst)
    } catch {
      // Source file absent or copy failed — non-fatal, skip silently
    }
  }
}

/**
 * Remove the worktree and its branch after a session ends.
 * Errors are swallowed — removal is best-effort.
 */
export async function removeWorktree(repoRoot: string, sessionId: number): Promise<void> {
  const branch = `agent/${sessionId}`
  const wtPath = path.resolve(repoRoot, '..', 'agent-worktrees', String(sessionId))

  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wtPath])
  } catch { /* already removed or missing — ignore */ }

  try {
    await execFileAsync('git', ['-C', repoRoot, 'branch', '-D', branch])
  } catch { /* already deleted or missing — ignore */ }
}

/**
 * Remove a worktree by its absolute path rather than by session ID.
 *
 * Discovers the associated branch via `git worktree list --porcelain` before removal,
 * so the branch is deleted even when the session ID is not available (e.g. on tab close).
 * Both the worktree removal and the branch deletion are best-effort: errors are swallowed.
 *
 * Idempotent: if the worktree or branch is already gone, resolves without error.
 *
 * @param repoRoot     - Absolute path to the git repository root.
 * @param worktreePath - Absolute path to the worktree directory to remove.
 */
export async function removeWorktreeByPath(repoRoot: string, worktreePath: string): Promise<void> {
  const targetPath = path.resolve(worktreePath)

  // Discover the branch associated with the worktree (best-effort).
  // Uses a manual Promise wrapper (not execFileAsync) to reliably capture stdout as a string.
  let branch: string | null = null
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], (err, out) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
    for (const block of stdout.trim().split(/\n\n+/)) {
      const lines = block.trim().split('\n')
      const worktreeLine = lines.find(l => l.startsWith('worktree '))
      const branchLine = lines.find(l => l.startsWith('branch '))
      if (worktreeLine && branchLine && path.resolve(worktreeLine.slice('worktree '.length).trim()) === targetPath) {
        branch = branchLine.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
        break
      }
    }
  } catch { /* best-effort — ignore */ }

  // Remove the worktree
  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', targetPath])
  } catch { /* already removed or missing — ignore */ }

  // Delete the associated branch if found
  if (branch) {
    try {
      await execFileAsync('git', ['-C', repoRoot, 'branch', '-D', branch])
    } catch { /* already deleted — ignore */ }
  }
}

/**
 * Prune stale worktree administrative files.
 * Call at app startup to clean up orphaned worktrees from crashed sessions.
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await execFileAsync('git', ['-C', repoRoot, 'worktree', 'prune'])
}

/** Parse `git worktree list --porcelain` output into a list of entries. */
export function parseWorktreeList(output: string): Array<{ path: string; branch: string | null }> {
  return output
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n')
      const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
      const branch = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length) ?? null
      return { path: wtPath, branch }
    })
    .filter((wt) => wt.path !== '')
}

/**
 * Prune orphaned worktrees when a project is loaded.
 *
 * Handles two branch formats:
 * - Old: `agent/<sessionId>` — checked against DB via {@link queryLive}; removed if
 *   session ended (`ended_at` set or status `completed`) or absent from the DB.
 * - New: `agent/<name>/s<timestamp>` — DB check first: queries `sessions JOIN agents`
 *   by agent name within ±5 minutes of the timestamp. If the session is active
 *   (`started`) the worktree is kept; if completed it is removed. Falls back to a
 *   4-hour temporal heuristic when no matching session is found.
 *
 * Calls `git worktree prune` at the end to clean up git admin files.
 * Best-effort: errors are logged but do not throw.
 *
 * @param repoRoot - Absolute path to the git repository root.
 * @param dbPath   - Registered path to the project SQLite database.
 */
export async function pruneOrphanedWorktrees(repoRoot: string, dbPath: string): Promise<void> {
  // Uses a manual Promise wrapper (not execFileAsync) to reliably capture stdout as a string.
  let stdout: string
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      execFile('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], (err, out) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
  } catch (err) {
    console.warn('[pruneOrphanedWorktrees] git worktree list failed:', err)
    return
  }

  const worktrees = parseWorktreeList(stdout)

  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

  // ── First pass: categorize worktrees by branch format ─────────────────────

  interface OldEntry { sessionId: number; wt: (typeof worktrees)[number] }
  interface NewEntry { agentName: string; timestamp: number; fullBranch: string; wt: (typeof worktrees)[number] }

  const oldEntries: OldEntry[] = []
  const newEntries: NewEntry[] = []

  for (const wt of worktrees) {
    if (!wt.branch) continue

    const oldMatch = /^refs\/heads\/agent\/(\d+)$/.exec(wt.branch)
    if (oldMatch) {
      oldEntries.push({ sessionId: parseInt(oldMatch[1], 10), wt })
      continue
    }

    const newMatch = /^refs\/heads\/agent\/([^/]+)\/s(\d+)$/.exec(wt.branch)
    if (newMatch) {
      newEntries.push({
        agentName: newMatch[1],
        timestamp: parseInt(newMatch[2], 10),
        fullBranch: `agent/${newMatch[1]}/s${newMatch[2]}`,
        wt,
      })
    }
  }

  // ── Batch query: old-format sessions (single round-trip) ──────────────────

  const oldSessionMap = new Map<number, { ended_at: string | null; status: string }>()
  if (oldEntries.length > 0) {
    const ids = oldEntries.map(e => e.sessionId)
    const placeholders = ids.map(() => '?').join(', ')
    try {
      const rows = await queryLive(
        dbPath,
        `SELECT id, ended_at, status FROM sessions WHERE id IN (${placeholders})`,
        ids
      )
      for (const row of rows as Array<{ id: number; ended_at: string | null; status: string }>) {
        oldSessionMap.set(row.id, { ended_at: row.ended_at, status: row.status })
      }
    } catch (err) {
      console.warn('[pruneOrphanedWorktrees] batch DB query failed for old-format sessions:', err)
      // Safe default: skip all old-format processing (keep worktrees)
      oldEntries.length = 0
    }
  }

  // ── Batch query: new-format sessions (single round-trip) ──────────────────

  let newSessionRows: Array<{ status: string; name: string; started_ms: number }> = []
  if (newEntries.length > 0) {
    const uniqueNames = [...new Set(newEntries.map(e => e.agentName))]
    const placeholders = uniqueNames.map(() => '?').join(', ')
    try {
      const rows = await queryLive(
        dbPath,
        `SELECT s.status, a.name, CAST(strftime('%s', s.started_at) AS INTEGER) * 1000 as started_ms
         FROM sessions s
         JOIN agents a ON s.agent_id = a.id
         WHERE a.name IN (${placeholders})`,
        uniqueNames
      )
      newSessionRows = rows as Array<{ status: string; name: string; started_ms: number }>
    } catch (err) {
      console.warn('[pruneOrphanedWorktrees] batch DB query failed for new-format sessions:', err)
      // Safe default: skip all new-format processing (keep worktrees)
      newEntries.length = 0
    }
  }

  // ── Process old-format worktrees ──────────────────────────────────────────

  for (const { sessionId } of oldEntries) {
    const session = oldSessionMap.get(sessionId)
    const shouldRemove = !session || session.ended_at !== null || session.status === 'completed'
    if (!shouldRemove) continue

    console.log(`[pruneOrphanedWorktrees] removing orphaned worktree for session ${sessionId}`)
    await removeWorktree(repoRoot, sessionId)
  }

  // ── Process new-format worktrees ──────────────────────────────────────────

  for (const { agentName, timestamp, fullBranch, wt } of newEntries) {
    // Find closest session for this agent within ±5 minutes of the timestamp.
    // If found and active (started) → keep; if completed → remove.
    // If not found → fall back to temporal heuristic.
    let shouldRemoveNewFormat: boolean | null = null

    const candidates = newSessionRows
      .filter(r => r.name === agentName && Math.abs(r.started_ms - timestamp) < 300000)
      .sort((a, b) => Math.abs(a.started_ms - timestamp) - Math.abs(b.started_ms - timestamp))

    if (candidates.length > 0) {
      shouldRemoveNewFormat = candidates[0].status !== 'started'
    }

    // Fall back to temporal heuristic when no matching session was found in DB
    if (shouldRemoveNewFormat === null) {
      shouldRemoveNewFormat = Date.now() - timestamp > FOUR_HOURS_MS
    }

    if (!shouldRemoveNewFormat) continue

    console.log(`[pruneOrphanedWorktrees] removing stale new-format worktree: ${fullBranch}`)
    try {
      await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wt.path])
    } catch { /* best-effort */ }
    try {
      await execFileAsync('git', ['-C', repoRoot, 'branch', '-D', fullBranch])
    } catch { /* best-effort */ }
  }

  try {
    await pruneWorktrees(repoRoot)
  } catch (err) {
    console.warn('[pruneOrphanedWorktrees] git worktree prune failed:', err)
  }
}
