#!/usr/bin/env node
/**
 * dbw.js — SQLite write wrapper (bypasses Windows file locks via fs.readFile/writeFile)
 *
 * Usage:
 *   node scripts/dbw.js "UPDATE tasks SET statut='en_cours' WHERE id=250"
 *   echo "UPDATE ..." | node scripts/dbw.js   # stdin (safe for complex queries)
 *
 * Load → modify in memory → export. fs.writeFile holds lock only during the
 * brief write (milliseconds). Not safe for concurrent writes — use DB locks
 * (INSERT OR REPLACE INTO locks) before calling this script.
 *
 * Stdin mode avoids shell interpretation of backticks, $(), quotes and newlines.
 * Useful for long UPDATE/INSERT with system_prompt content or multi-line SQL.
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const sqlArg = process.argv[2]

const dbPath = path.resolve(process.cwd(), '.claude/project.db')

/**
 * Executes a write SQL statement and persists the result.
 * @param {string} sql
 */
function run(sql) {
  initSqlJs().then((SQL) => {
    const buf = fs.readFileSync(dbPath)
    const db = new SQL.Database(buf)
    db.run(sql)
    fs.writeFileSync(dbPath, Buffer.from(db.export()))
    db.close()
  })
}

if (sqlArg) {
  // Positional argument — backward-compatible mode
  run(sqlArg)
} else if (!process.stdin.isTTY) {
  // Stdin mode — safe for multi-line SQL with backticks, quotes, $vars, newlines
  const chunks = []
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => chunks.push(chunk))
  process.stdin.on('end', () => {
    const sql = chunks.join('').trim()
    if (!sql) {
      console.error('Error: no SQL provided via stdin')
      process.exit(1)
    }
    run(sql)
  })
} else {
  console.error('Usage: node scripts/dbw.js "<SQL>"')
  console.error('       echo "<SQL>" | node scripts/dbw.js')
  process.exit(1)
}
