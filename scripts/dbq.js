#!/usr/bin/env node
/**
 * dbq.js — SQLite read wrapper (bypasses Windows file locks via fs.readFile)
 *
 * Usage:
 *   node scripts/dbq.js "SELECT id, titre, statut FROM tasks LIMIT 10"
 *   node scripts/dbq.js --json "SELECT ..."   # JSON output (programmatic)
 *   echo "SELECT ..." | node scripts/dbq.js   # stdin (safe for complex queries)
 *   echo "SELECT ..." | node scripts/dbq.js --json
 *
 * Default output: compact pipe-separated table (minimal tokens)
 *   id|titre|statut
 *   1|Setup|archivé
 *
 * Uses sql.js + fs.readFile (ReadFile() on Windows) to bypass byte-range locks.
 * Stdin mode avoids shell interpretation of backticks, $(), quotes and newlines.
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const sqlArg = args.find((a) => !a.startsWith('--'))

const dbPath = path.resolve(process.cwd(), '.claude/project.db')

/**
 * Runs the query and prints results.
 * @param {string} sql
 */
function run(sql) {
  // Normalize typographic quotes to ASCII equivalents.
  // Note: regex may replace curly quotes inside string literals — acceptable trade-off.
  sql = sql.replace(/[\u201C\u201D]/g, '"') // curly double quotes -> straight
  sql = sql.replace(/[\u2018\u2019]/g, "'") // curly single quotes -> straight
  sql = sql.replace(/\\"/g, '"') // backslash-escaped double quote -> straight
  sql = sql.replace(/\\'/g, "'") // backslash-escaped single quote -> straight
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
}

if (sqlArg) {
  // Positional argument — backward-compatible mode
  run(sqlArg)
} else if (!process.stdin.isTTY) {
  // Stdin mode — safe for multi-line SQL with backticks, quotes, $vars, newlines
  let chunks = []
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
  console.error('Usage: node scripts/dbq.js [--json] "<SQL>"')
  console.error('       echo "<SQL>" | node scripts/dbq.js [--json]')
  process.exit(1)
}
