#!/usr/bin/env node
/**
 * dbq.js — SQLite read wrapper (bypasses Windows file locks via fs.readFile)
 *
 * Usage:
 *   node scripts/dbq.js "SELECT id, titre, statut FROM tasks LIMIT 10"
 *   node scripts/dbq.js --json "SELECT ..."   # JSON output (programmatic)
 *
 * Default output: compact pipe-separated table (minimal tokens)
 *   id|titre|statut
 *   1|Setup|archivé
 *
 * Uses sql.js + fs.readFile (ReadFile() on Windows) to bypass byte-range locks.
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const sql = args.find((a) => !a.startsWith('--'))

if (!sql) {
  console.error('Usage: node scripts/dbq.js [--json] "<SQL>"')
  process.exit(1)
}

const dbPath = path.resolve(process.cwd(), '.claude/project.db')

initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(dbPath))
  const result = db.exec(sql)
  db.close()

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (!result.length) {
    console.log('(empty)')
    return
  }

  for (const { columns, values } of result) {
    console.log(columns.join('|'))
    for (const row of values) {
      console.log(row.map((v) => (v === null ? 'NULL' : String(v))).join('|'))
    }
  }
})
