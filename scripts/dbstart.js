#!/usr/bin/env node
/**
 * dbstart.js — Unified agent startup query (single DB read)
 *
 * Usage: node scripts/dbstart.js <agent-name>
 *
 * Returns in one pass:
 *   - Last session summary (input session)
 *   - Open tasks assigned to this agent (a_faire / en_cours)
 *
 * Replaces 3-4 separate dbq.js calls at session startup.
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const agent = process.argv[2]
if (!agent) {
  console.error('Usage: node scripts/dbstart.js <agent-name>')
  process.exit(1)
}

const dbPath = path.resolve(process.cwd(), '.claude/project.db')

initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(dbPath))

  // Last session summary
  const session = db.exec(`
    SELECT s.summary, s.ended_at
    FROM sessions s
    JOIN agents a ON a.id = s.agent_id
    WHERE a.name = '${agent}' AND s.statut = 'terminé'
    ORDER BY s.ended_at DESC LIMIT 1
  `)

  // Open tasks (a_faire + en_cours) with last 5 comments inline
  const tasks = db.exec(`
    SELECT t.id, t.statut, t.perimetre, t.titre, t.description
    FROM tasks t
    JOIN agents a ON a.id = t.agent_assigne_id
    WHERE a.name = '${agent}' AND t.statut IN ('a_faire', 'en_cours')
    ORDER BY t.updated_at DESC
  `)

  db.close()

  // === SESSION PRÉCÉDENTE ===
  if (session.length && session[0].values.length) {
    const [summary, endedAt] = session[0].values[0]
    console.log('=== SESSION PRÉCÉDENTE ===')
    console.log(`ended_at: ${endedAt}`)
    console.log(`summary: ${summary ?? '(aucun)'}`)
  } else {
    console.log('=== SESSION PRÉCÉDENTE ===')
    console.log('(aucune session terminée)')
  }

  // === TÂCHES ASSIGNÉES ===
  console.log('\n=== TÂCHES ASSIGNÉES ===')
  if (!tasks.length || !tasks[0].values.length) {
    console.log('(aucune tâche a_faire / en_cours)')
  } else {
    for (const [id, statut, perimetre, titre, description] of tasks[0].values) {
      console.log(`\n[T${id}] ${statut} | ${perimetre ?? '-'} | ${titre}`)
      if (description) console.log(description)
    }
  }
})
