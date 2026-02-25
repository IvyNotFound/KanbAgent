#!/usr/bin/env node
/**
 * dbw.js — SQLite write wrapper (bypasses Windows file locks via fs.readFile/writeFile)
 *
 * Usage: node scripts/dbw.js "UPDATE tasks SET statut='en_cours' WHERE id=250"
 *
 * Load → modify in memory → export. fs.writeFile holds lock only during the
 * brief write (milliseconds). Not safe for concurrent writes — use DB locks
 * (INSERT OR REPLACE INTO locks) before calling this script.
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const sql = process.argv[2]
if (!sql) {
  console.error('Usage: node scripts/dbw.js "<SQL>"')
  process.exit(1)
}

const dbPath = path.resolve(process.cwd(), '.claude/project.db')

initSqlJs().then((SQL) => {
  const buf = fs.readFileSync(dbPath)
  const db = new SQL.Database(buf)
  db.run(sql)
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()
})
