#!/usr/bin/env node
/**
 * dbstart.js — All-in-one agent session startup (better-sqlite3)
 *
 * Usage: node scripts/dbstart.js <agent-name> [type] [scope]
 *
 * Performs in one pass:
 *   1. Registers agent (INSERT OR IGNORE)
 *   2. Creates new session (INSERT) → prints session_id + agent_id
 *   3. Shows last terminated session summary
 *   4. Lists open tasks assigned to this agent (todo / in_progress)
 *
 * Replaces 3-5 separate dbq/dbw calls at session startup.
 */

const Database = require('better-sqlite3')
const path = require('path')
const { randomUUID } = require('node:crypto')
const { execSync } = require('child_process')
const { acquireLock, releaseLock, cleanupOrphanTmp } = require('./dblock')

const agent = process.argv[2]
const type = process.argv[3] || agent
const scope = process.argv[4] || 'global'

if (agent === '--help' || agent === '-h') {
  console.log('Usage: node scripts/dbstart.js <agent-name> [type] [scope]')
  process.exit(0)
}

if (!agent) {
  console.error('Usage: node scripts/dbstart.js <agent-name> [type] [scope]')
  process.exit(1)
}

// Worktree detection — agents should always run DB scripts from the main repo
const cwd = process.cwd()
const normalizedCwd = cwd.replace(/\\/g, '/')
const worktreeMarker = '.claude/worktrees'
const isInWorktree = normalizedCwd.includes(worktreeMarker)
const mainRepoPath = isInWorktree
  ? cwd.slice(0, normalizedCwd.indexOf(worktreeMarker)).replace(/[\\/]+$/, '')
  : cwd
const dbPath = path.resolve(mainRepoPath, '.claude/project.db')

try {
  cleanupOrphanTmp(dbPath)
  const lockPath = acquireLock(dbPath)
  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')

    // Guard: reject purely numeric agent names (likely an agent_id passed by mistake)
    if (/^\d+$/.test(agent)) {
      const byId = db.prepare('SELECT name FROM agents WHERE id = ?').get(parseInt(agent, 10))
      const hint = byId ? ` Utilisez: node scripts/dbstart.js ${byId.name}` : ''
      db.close()
      releaseLock(lockPath)
      console.error(`ERREUR: nom d'agent "${agent}" est un entier (probablement un agent_id).${hint}`)
      process.exit(3)
    }

    // 1. Register agent (idempotent)
    db.prepare(
      `INSERT OR IGNORE INTO agents (name, type, scope) VALUES (?, ?, ?)`
    ).run(agent, type, scope)

    // 2. Get agent_id
    const agentRow = db.prepare('SELECT id FROM agents WHERE name = ?').get(agent)
    const agentId = agentRow.id

    // 2c. Mark zombie sessions as terminated
    const zombieResult = db.prepare(`
      UPDATE sessions
      SET status = 'completed',
          ended_at = datetime('now'),
          summary = 'Auto-closed: zombie session (no activity for 60min)'
      WHERE status = 'started'
        AND ended_at IS NULL
        AND started_at < datetime('now', '-60 minutes')
    `).run()
    if (zombieResult.changes > 0) {
      console.log(`\n[auto-release] ${zombieResult.changes} zombie session(s) marked as completed`)
    }

    // 3. Check parallel session limit (reads max_sessions from agents table, default 3)
    const agentCols = db.pragma('table_info(agents)')
    const hasMaxSessions = agentCols.some(c => c.name === 'max_sessions')
    const maxSessions = hasMaxSessions
      ? (db.prepare('SELECT max_sessions FROM agents WHERE id = ?').get(agentId)?.max_sessions ?? 3)
      : 3
    const activeRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM sessions WHERE agent_id = ? AND status = ?'
    ).get(agentId, 'started')
    const activeCount = activeRow.cnt
    if (maxSessions !== -1 && activeCount >= maxSessions) {
      db.close()
      releaseLock(lockPath)
      console.error(
        `ERREUR: ${agent} a déjà ${activeCount} session(s) active(s) (max ${maxSessions}). Terminer une session avant d'en ouvrir une nouvelle.`
      )
      process.exit(2)
    }

    // 4. Create session with pre-assigned conv_id (T626)
    const sessionUUID = randomUUID()
    db.prepare('INSERT INTO sessions (agent_id, claude_conv_id) VALUES (?, ?)').run(agentId, sessionUUID)
    const sessionId = db.prepare('SELECT last_insert_rowid() as id').get().id

    // Release lock — writes are done
    releaseLock(lockPath)

    // === OUTPUT ===

    console.log(`=== IDENTIFIANTS ===`)
    console.log(`agent_id: ${agentId}`)
    console.log(`session_id: ${sessionId}`)
    console.log(`SESSION_ID=${sessionUUID}`)

    if (isInWorktree) {
      console.log('\n=== WORKTREE ACTIF ===')
      console.log(`Dev depuis : ${cwd}`)
      console.log(`DB via : cd ${mainRepoPath} && node scripts/dbq.js ...`)
    }

    // 4. Last terminated session
    const session = db.prepare(`
      SELECT s.summary, s.ended_at FROM sessions s
      WHERE s.agent_id = ? AND s.status = 'completed' AND s.id != ?
      ORDER BY s.ended_at DESC LIMIT 1
    `).get(agentId, sessionId)

    console.log('\n=== SESSION PRÉCÉDENTE ===')
    if (session) {
      console.log(`ended_at: ${session.ended_at}`)
      console.log(`summary: ${session.summary ?? '(aucun)'}`)
    } else {
      console.log('(aucune session completed)')
    }

    // 5. Open tasks (todo + in_progress)
    const tasks = db.prepare(`
      SELECT t.id, t.status, t.scope, t.priority, t.title, t.description
      FROM tasks t
      WHERE t.agent_assigned_id = ? AND t.status IN ('todo', 'in_progress')
      ORDER BY t.status DESC, t.updated_at DESC
    `).all(agentId)

    console.log('\n=== TÂCHES ASSIGNÉES ===')
    if (tasks.length === 0) {
      console.log('(aucune tâche todo / in_progress)')
    } else {
      for (const t of tasks) {
        console.log(`
[T${t.id}] ${t.status} | ${t.scope ?? '-'} | prio:${t.priority} | ${t.title}`)
        if (t.description) console.log(t.description)
      }
    }

    db.close()
  } catch (err) {
    releaseLock(lockPath)
    throw err
  }

  // Non-fatal: prune orphan worktrees on startup (ADR-006)
  try {
    execSync('git worktree prune', { cwd: process.cwd(), stdio: 'pipe' })
  } catch (e) {
    console.warn('[dbstart] git worktree prune failed:', e.message)
  }
} catch (err) {
  console.error('ERREUR dbstart:', err.message)
  process.exit(1)
}
