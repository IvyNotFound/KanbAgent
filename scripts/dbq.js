#!/usr/bin/env node
/**
 * dbq.js — SQLite read wrapper
 *
 * Primary path : HTTP request to db-server.js daemon (no process spawn, low RAM).
 * Fallback path: sqlite3 CLI binary (original behavior, when daemon is unavailable).
 * The daemon is started externally (Electron at boot, or `npm run db-server`).
 *
 * Usage:
 *   node scripts/dbq.js "SELECT id, title, status FROM tasks LIMIT 10"
 *   node scripts/dbq.js --json "SELECT ..."   # JSON output (programmatic)
 *   echo "SELECT ..." | node scripts/dbq.js   # stdin (safe for complex queries)
 *   echo "SELECT ..." | node scripts/dbq.js --json
 *
 * Default output: compact pipe-separated table (minimal tokens)
 *   id|title|status
 *   1|Setup|archived
 *
 * Stdin mode avoids shell interpretation of backticks, $(), quotes and newlines.
 */

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const { getDbPath, getPort, queryDaemon } = require('./db-client')

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const sqlArg = args.find((a) => !a.startsWith('--'))

const cwd = process.cwd()
const dbPath = getDbPath(cwd)
const port = getPort(dbPath)

// Resolve binary from main repo — worktrees don't have their own resources/bin
const normalizedCwd = cwd.replace(/\\/g, '/')
const worktreeMarker = '.claude/worktrees'
const mainRepoPath = normalizedCwd.includes(worktreeMarker)
  ? cwd.slice(0, normalizedCwd.indexOf(worktreeMarker)).replace(/[\\/]+$/, '')
  : path.resolve(__dirname, '..')
const binaryName = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3'
const sqliteBin = path.resolve(mainRepoPath, 'resources', 'bin', binaryName)

function ensureBin() {
  if (!fs.existsSync(sqliteBin)) {
    console.error(`ERREUR dbq: sqlite3 binary not found at ${sqliteBin}`)
    console.error('Run: npm run download-sqlite3')
    process.exit(1)
  }
}

function normalizeSql(sql) {
  sql = sql.replace(/[\u201C\u201D]/g, '"')
  sql = sql.replace(/[\u2018\u2019]/g, "'")
  sql = sql.replace(/\\"/g, '"')
  sql = sql.replace(/\\'/g, "'")
  return sql
}

/**
 * Runs the query via daemon (primary) or CLI binary (fallback).
 * @param {string} sql
 */
async function run(sql) {
  sql = normalizeSql(sql)

  // ── Primary: daemon ───────────────────────────────────────────────────────
  const result = await queryDaemon(port, '/query', { sql, json: jsonMode })

  if (result !== null) {
    if (jsonMode) {
      console.log(JSON.stringify(result.rows, null, 2))
    } else {
      const text = result.text
      if (!text || text === '(empty)') {
        console.log('(empty)')
      } else {
        process.stdout.write(text + '\n')
      }
    }
    return
  }

  // ── Fallback: CLI binary ──────────────────────────────────────────────────
  ensureBin()

  // .timeout is a dot-command (no output), unlike PRAGMA busy_timeout which echoes the value
  const script = `.timeout 5000\n${sql}`

  try {
    if (jsonMode) {
      const output = execFileSync(sqliteBin, ['-json', dbPath], {
        input: script,
        encoding: 'utf8',
      })
      const rows = JSON.parse(output.trim() || '[]')
      console.log(JSON.stringify(rows, null, 2))
    } else {
      const output = execFileSync(sqliteBin, ['-header', '-separator', '|', '-nullvalue', 'NULL', dbPath], {
        input: script,
        encoding: 'utf8',
      })
      if (!output.trim()) {
        console.log('(empty)')
        return
      }
      process.stdout.write(output)
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message
    console.error('ERREUR dbq:', stderr)
    process.exit(1)
  }
}

async function main() {
  if (sqlArg) {
    await run(sqlArg)
  } else if (!process.stdin.isTTY) {
    let chunks = []
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    await new Promise((resolve, reject) => {
      process.stdin.on('end', resolve)
      process.stdin.on('error', reject)
    })
    const sql = chunks.join('').trim()
    if (!sql) {
      console.error('Error: no SQL provided via stdin')
      process.exit(1)
    }
    await run(sql)
  } else {
    console.error('Usage: node scripts/dbq.js [--json] "<SQL>"')
    console.error('       echo "<SQL>" | node scripts/dbq.js [--json]')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('ERREUR dbq:', err.message)
  process.exit(1)
})
