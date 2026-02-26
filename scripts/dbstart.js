#!/usr/bin/env node
/**
 * dbstart.js — All-in-one agent session startup (single DB open)
 *
 * Usage: node scripts/dbstart.js <agent-name> [type] [perimetre]
 *
 * Performs in one pass:
 *   1. Registers agent (INSERT OR IGNORE)
 *   2. Creates new session (INSERT) → prints session_id + agent_id
 *   3. Shows last terminated session summary
 *   4. Lists open tasks assigned to this agent (todo / in_progress)
 *   5. Shows active locks (conflict check)
 *
 * Replaces 3-5 separate dbq/dbw calls at session startup.
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const agent = process.argv[2]
const type = process.argv[3] || agent
const perimetre = process.argv[4] || 'global'

if (!agent) {
  console.error('Usage: node scripts/dbstart.js <agent-name> [type] [perimetre]')
  process.exit(1)
}

const dbPath = path.resolve(process.cwd(), '.claude/project.db')

initSqlJs().then((SQL) => {
  const buf = fs.readFileSync(dbPath)
  const db = new SQL.Database(buf)

  // Guard: reject purely numeric agent names (likely an agent_id passed by mistake)
  if (/^\d+$/.test(agent)) {
    const byId = db.exec(`SELECT name FROM agents WHERE id = ${parseInt(agent, 10)}`)
    const hint =
      byId.length && byId[0].values.length
        ? ` Utilisez: node scripts/dbstart.js ${byId[0].values[0][0]}`
        : ''
    db.close()
    console.error(`ERREUR: nom d'agent "${agent}" est un entier (probablement un agent_id).${hint}`)
    process.exit(3)
  }

  // 1. Register agent (idempotent)
  db.run(
    `INSERT OR IGNORE INTO agents (name, type, perimetre) VALUES ('${agent}', '${type}', '${perimetre}')`
  )

  // 2. Get agent_id
  const agentRow = db.exec(`SELECT id FROM agents WHERE name = '${agent}'`)
  const agentId = agentRow[0].values[0][0]

  // 3. Check parallel session limit (max 3 active per agent)
  const MAX_PARALLEL_SESSIONS = 3
  const activeRow = db.exec(
    `SELECT COUNT(*) FROM sessions WHERE agent_id = ${agentId} AND statut = 'started'`
  )
  const activeCount = activeRow[0].values[0][0]
  if (activeCount >= MAX_PARALLEL_SESSIONS) {
    db.close()
    console.error(
      `ERREUR: ${agent} a déjà ${activeCount} session(s) active(s) (max ${MAX_PARALLEL_SESSIONS}). Terminer une session avant d'en ouvrir une nouvelle.`
    )
    process.exit(2)
  }

  // 4. Create session
  db.run(`INSERT INTO sessions (agent_id) VALUES (${agentId})`)
  const sessionRow = db.exec(`SELECT last_insert_rowid()`)
  const sessionId = sessionRow[0].values[0][0]

  // 4b. Auto-release orphan locks from terminated sessions
  const released = db.exec(`
    SELECT COUNT(*) FROM locks
    WHERE released_at IS NULL
      AND session_id IN (SELECT id FROM sessions WHERE statut = 'completed')
  `)
  const orphanCount = released[0].values[0][0]
  if (orphanCount > 0) {
    db.run(`
      UPDATE locks SET released_at = datetime('now')
      WHERE released_at IS NULL
        AND session_id IN (SELECT id FROM sessions WHERE statut = 'completed')
    `)
    console.log(`\n[auto-release] ${orphanCount} orphan lock(s) released from terminated sessions`)
  }

  // 4c. Auto-release locks from zombie sessions (started, inactive >60 min)
  const zombieLocks = db.exec(`
    SELECT COUNT(*) FROM locks
    WHERE released_at IS NULL
      AND session_id IN (
        SELECT id FROM sessions
        WHERE statut = 'started'
          AND ended_at IS NULL
          AND started_at < datetime('now', '-60 minutes')
      )
  `)
  const zombieLockCount = zombieLocks[0].values[0][0]
  if (zombieLockCount > 0) {
    db.run(`
      UPDATE locks SET released_at = datetime('now')
      WHERE released_at IS NULL
        AND session_id IN (
          SELECT id FROM sessions
          WHERE statut = 'started'
            AND ended_at IS NULL
            AND started_at < datetime('now', '-60 minutes')
        )
    `)
    console.log(`\n[auto-release] ${zombieLockCount} zombie lock(s) released from inactive started sessions (>60 min)`)
  }

  // 4d. Mark zombie sessions as terminated
  const zombieSessions = db.exec(`
    SELECT COUNT(*) FROM sessions
    WHERE statut = 'started'
      AND ended_at IS NULL
      AND started_at < datetime('now', '-60 minutes')
  `)
  const zombieSessionCount = zombieSessions[0].values[0][0]
  if (zombieSessionCount > 0) {
    db.run(`
      UPDATE sessions
      SET statut = 'completed',
          ended_at = datetime('now'),
          summary = 'Auto-closed: zombie session (no activity for 60min)'
      WHERE statut = 'started'
        AND ended_at IS NULL
        AND started_at < datetime('now', '-60 minutes')
    `)
    console.log(`\n[auto-release] ${zombieSessionCount} zombie session(s) marked as completed`)
  }

  // Persist writes (atomic: tmp + rename)
  const tmpPath = dbPath + '.tmp'
  fs.writeFileSync(tmpPath, Buffer.from(db.export()))
  fs.renameSync(tmpPath, dbPath)

  // === OUTPUT ===

  console.log(`=== IDENTIFIANTS ===`)
  console.log(`agent_id: ${agentId}`)
  console.log(`session_id: ${sessionId}`)

  // 4. Last terminated session
  const session = db.exec(`
    SELECT s.summary, s.ended_at FROM sessions s
    WHERE s.agent_id = ${agentId} AND s.statut = 'completed' AND s.id != ${sessionId}
    ORDER BY s.ended_at DESC LIMIT 1
  `)

  console.log('\n=== SESSION PRÉCÉDENTE ===')
  if (session.length && session[0].values.length) {
    const [summary, endedAt] = session[0].values[0]
    console.log(`ended_at: ${endedAt}`)
    console.log(`summary: ${summary ?? '(aucun)'}`)
  } else {
    console.log('(aucune session completed)')
  }

  // 5. Open tasks (todo + in_progress)
  const tasks = db.exec(`
    SELECT t.id, t.statut, t.perimetre, t.priority, t.titre, t.description
    FROM tasks t
    WHERE t.agent_assigne_id = ${agentId} AND t.statut IN ('todo', 'in_progress')
    ORDER BY t.statut DESC, t.updated_at DESC
  `)

  console.log('\n=== TÂCHES ASSIGNÉES ===')
  if (!tasks.length || !tasks[0].values.length) {
    console.log('(aucune tâche todo / in_progress)')
  } else {
    for (const [id, statut, peri, priority, titre, description] of tasks[0].values) {
      console.log(`\n[T${id}] ${statut} | ${peri ?? '-'} | prio:${priority} | ${titre}`)
      if (description) console.log(description)
    }
  }

  // 6. Active locks (conflict check)
  const locks = db.exec(`
    SELECT l.fichier, a.name FROM locks l
    JOIN agents a ON a.id = l.agent_id
    WHERE l.released_at IS NULL
  `)

  console.log('\n=== LOCKS ACTIFS ===')
  if (!locks.length || !locks[0].values.length) {
    console.log('(aucun)')
  } else {
    for (const [fichier, owner] of locks[0].values) {
      console.log(`${fichier} → ${owner}`)
    }
  }

  db.close()
})
