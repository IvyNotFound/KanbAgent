#!/usr/bin/env node
/**
 * db-server.js — Persistent HTTP DB daemon for KanbAgent agents.
 *
 * Eliminates the node.exe startup cost (100-200ms, 30-50 MB RAM) that
 * occurs on every dbq/dbw/dbstart call. Agent scripts (dbq, dbw, dbstart)
 * send HTTP requests to this daemon instead of spawning a new node process.
 *
 * Each HTTP request still spawns sqlite3.exe for the actual DB access —
 * WAL-locked database compatibility requires the native CLI binary.
 * This trades 2 spawns (node.exe + sqlite3.exe) for 1 spawn (sqlite3.exe).
 * With 4-6 active agents: saves 10-20 node.exe × 30-50 MB = 300-1 GB RAM.
 *
 * Usage:
 *   node scripts/db-server.js [--db <path>] [--port <n>]
 *   DB_SERVER_PATH=<path> node scripts/db-server.js
 *   npm run db-server
 *
 * Endpoints:
 *   GET  /health  → { status: "ok", pid, port, dbPath }
 *   POST /query   → { sql, json? } → rows as JSON array or pipe-delimited text
 *   POST /write   → { sql, params? } → { ok, changes, lastInsertRowid }
 *   POST /exec    → { sql }  → multi-stmt (writes + optional final SELECT)
 *
 * PID file: os.tmpdir()/kanbagent-db-<port>.pid
 */

const http = require('http')
const { execFileSync } = require('child_process')
const os = require('os')
const path = require('path')
const fs = require('fs')
const { getPort } = require('./db-port')

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : null
}

const cwd = process.cwd()
const normalizedCwd = cwd.replace(/\\/g, '/')
const worktreeMarker = '.claude/worktrees'
const isInWorktree = normalizedCwd.includes(worktreeMarker)
const mainRepoPath = isInWorktree
  ? cwd.slice(0, normalizedCwd.indexOf(worktreeMarker)).replace(/[\\/]+$/, '')
  : cwd

const dbPath = path.resolve(
  getArg('--db') || process.env['DB_SERVER_PATH'] || path.join(mainRepoPath, '.claude/project.db')
)

const portArg = getArg('--port')
const port = portArg ? parseInt(portArg, 10) : (
  parseInt(process.env['DB_SERVER_PORT'] || '0', 10) || getPort(dbPath)
)

const pidFile = path.join(os.tmpdir(), `kanbagent-db-${port}.pid`)

// ── sqlite3 CLI binary ────────────────────────────────────────────────────────
const binaryName = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3'
// Use mainRepoPath for resources/bin — worktrees don't have their own resources/ dir
const sqliteBin = path.resolve(mainRepoPath, 'resources', 'bin', binaryName)

if (!fs.existsSync(sqliteBin)) {
  console.error(`[db-server] sqlite3 binary not found at ${sqliteBin}`)
  console.error('[db-server] Run: npm run download-sqlite3')
  process.exit(1)
}

// ── SQL normalization ─────────────────────────────────────────────────────────
function normalizeSql(sql) {
  sql = sql.replace(/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')
  sql = sql.replace(/[\u201C\u201D]/g, '"')
  sql = sql.replace(/[\u2018\u2019]/g, "'")
  sql = sql.replace(/\\"/g, '"')
  sql = sql.replace(/\\'/g, "'")
  return sql
}

/**
 * Substitutes ? placeholders with properly SQL-escaped values.
 * @param {string} sql
 * @param {any[]} params
 * @returns {string}
 */
function substParams(sql, params) {
  let i = 0
  return sql.replace(/\?/g, () => {
    const val = params[i++]
    if (val === null || val === undefined) return 'NULL'
    if (typeof val === 'number') return String(val)
    if (typeof val === 'boolean') return val ? '1' : '0'
    return "'" + String(val).replace(/'/g, "''") + "'"
  })
}

// ── Write serialization ───────────────────────────────────────────────────────
// Async mutex — serializes all write requests so concurrent calls are safe.
let writeLock = Promise.resolve()

function withWriteLock(fn) {
  const next = writeLock.then(() => fn())
  writeLock = next.catch(() => {})
  return next
}

// ── Core SQL execution ────────────────────────────────────────────────────────
/**
 * Parses multiple JSON arrays from sqlite3 -json output.
 * sqlite3 emits one JSON array per SELECT statement (e.g. "[{...}]\n[{...}]").
 * @param {string} output - Raw sqlite3 stdout
 * @returns {object[][]} Array of row arrays, one per SELECT result
 */
function parseMultiJson(output) {
  const trimmed = output.trim()
  if (!trimmed) return []
  // Split on ]\n[ boundaries (each SELECT produces a JSON array on its own line)
  const parts = trimmed.split(/\]\s*\n\s*\[/)
  return parts.map((part, i) => {
    let chunk = part
    if (i > 0) chunk = '[' + chunk
    if (i < parts.length - 1) chunk = chunk + ']'
    try { return JSON.parse(chunk) } catch { return [] }
  })
}

/**
 * Executes a SQL script via the sqlite3 CLI binary and returns parsed output.
 * @param {string} sql - SQL script (may be multi-statement)
 * @param {boolean} jsonMode - If true, use -json flag for structured output
 * @returns {{ rows: object[]|null, text: string|null }}
 */
function runSql(sql, jsonMode = false) {
  const script = `.timeout 5000\n${sql}`

  if (jsonMode) {
    try {
      const output = execFileSync(sqliteBin, ['-json', dbPath], {
        input: script,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024, // 64 MB
      })
      // For /query, we expect a single SELECT → take the first result set
      const resultSets = parseMultiJson(output)
      const rows = resultSets.length > 0 ? resultSets[0] : []
      return { rows, text: null }
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().trim() : err.message
      throw new Error(stderr)
    }
  }

  try {
    const output = execFileSync(sqliteBin, ['-header', '-separator', '|', '-nullvalue', 'NULL', dbPath], {
      input: script,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return { rows: null, text: output.trim() || null }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message
    throw new Error(stderr)
  }
}

/**
 * Executes a write statement and returns change count + last insert rowid.
 * We retrieve changes() and last_insert_rowid() in the same sqlite3 session.
 * @param {string} sql - Write SQL (single statement, params already substituted)
 * @returns {{ ok: boolean, changes: number, lastInsertRowid: number }}
 */
function runWrite(sql) {
  const script = `.timeout 5000\n${sql};\nSELECT changes() AS changes, last_insert_rowid() AS last_insert_rowid;`
  try {
    const output = execFileSync(sqliteBin, ['-json', dbPath], {
      input: script,
      encoding: 'utf8',
    })
    // Output may contain multiple JSON arrays: one per SELECT
    // The LAST array is always our metadata SELECT (changes + last_insert_rowid)
    const resultSets = parseMultiJson(output)
    const meta = resultSets.length > 0 ? (resultSets[resultSets.length - 1][0] ?? {}) : {}
    return {
      ok: true,
      changes: typeof meta.changes === 'number' ? meta.changes : 0,
      lastInsertRowid: typeof meta.last_insert_rowid === 'number' ? meta.last_insert_rowid : 0,
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message
    throw new Error(stderr)
  }
}

/**
 * Executes a multi-statement script that may include writes and a trailing SELECT.
 * Returns rows from the final SELECT (if any), plus change metadata.
 * @param {string} sql
 * @returns {{ rows: object[]|null, ok: boolean, changes: number, lastInsertRowid: number }}
 */
function runExec(sql) {
  // Append metadata SELECT to capture changes()/last_insert_rowid() after writes
  const metaSuffix = '\nSELECT changes() AS __changes, last_insert_rowid() AS __last_rowid;'

  // Detect the last SELECT in the script (before metadata)
  const selectMatch = sql.match(/(?:^|[;\n\r])\s*(SELECT\b[\s\S]*)$/i)

  let script
  let hasUserSelect = false

  if (selectMatch) {
    const lastSelect = selectMatch[1].trim()
    // Remove the user's SELECT and append meta; we'll run user's SELECT separately after
    const selectIndex = sql.lastIndexOf(lastSelect)
    const prefix = sql.substring(0, selectIndex).trim()
    script = `.timeout 5000\n${prefix ? prefix + '\n' : ''}${lastSelect}${metaSuffix}`
    hasUserSelect = true
  } else {
    script = `.timeout 5000\n${sql}${metaSuffix}`
  }

  try {
    const output = execFileSync(sqliteBin, ['-json', dbPath], {
      input: script,
      encoding: 'utf8',
    })
    // sqlite3 emits one JSON array per SELECT → parse all result sets
    const resultSets = parseMultiJson(output)

    // The LAST result set is always our metadata (changes + last_rowid)
    // The result sets BEFORE it (if any) are the user's SELECT results
    const metaSet = resultSets[resultSets.length - 1] ?? []
    const metaRow = metaSet[0] ?? {}
    const userSets = hasUserSelect && resultSets.length > 1 ? resultSets.slice(0, -1) : null

    // Flatten user result sets (usually just one SELECT)
    const userRows = userSets ? userSets.flat() : null

    const changes = typeof metaRow.__changes === 'number' ? metaRow.__changes : 0
    const lastInsertRowid = typeof metaRow.__last_rowid === 'number' ? metaRow.__last_rowid : 0

    return { rows: userRows && userRows.length > 0 ? userRows : null, ok: true, changes, lastInsertRowid }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message
    throw new Error(stderr)
  }
}

// ── JSON body parser ──────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('Invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    const json = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
    res.end(json)
  }

  try {
    // GET /health
    if (req.method === 'GET' && req.url === '/health') {
      send(200, { status: 'ok', pid: process.pid, port, dbPath })
      return
    }

    // POST /query — read-only SELECT
    if (req.method === 'POST' && req.url === '/query') {
      const body = await readBody(req)
      if (typeof body.sql !== 'string') { send(400, { error: 'sql required' }); return }
      const sql = normalizeSql(body.sql)
      const jsonMode = body.json !== false

      if (jsonMode) {
        const result = runSql(sql, true)
        send(200, { rows: result.rows })
      } else {
        const result = runSql(sql, false)
        const text = result.text
        if (!text) {
          send(200, { text: '(empty)' })
        } else {
          send(200, { text })
        }
      }
      return
    }

    // POST /write — single write statement (serialized)
    if (req.method === 'POST' && req.url === '/write') {
      const body = await readBody(req)
      if (typeof body.sql !== 'string') { send(400, { error: 'sql required' }); return }
      let sql = normalizeSql(body.sql)
      const params = Array.isArray(body.params) ? body.params : []
      if (params.length > 0) sql = substParams(sql, params)

      const result = await withWriteLock(() => runWrite(sql))
      send(200, result)
      return
    }

    // POST /exec — multi-statement script (writes + optional trailing SELECT)
    if (req.method === 'POST' && req.url === '/exec') {
      const body = await readBody(req)
      if (typeof body.sql !== 'string') { send(400, { error: 'sql required' }); return }
      const sql = normalizeSql(body.sql)

      const result = await withWriteLock(() => runExec(sql))

      if (result.rows !== null) {
        send(200, { rows: result.rows, changes: result.changes, lastInsertRowid: result.lastInsertRowid })
      } else {
        send(200, { ok: true, changes: result.changes, lastInsertRowid: result.lastInsertRowid })
      }
      return
    }

    send(404, { error: 'Not found' })
  } catch (err) {
    send(500, { error: err.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  try { fs.writeFileSync(pidFile, String(process.pid)) } catch {}
  console.log(`[db-server] listening on 127.0.0.1:${port} | db: ${dbPath} | pid: ${process.pid}`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[db-server] Port ${port} already in use. Set DB_SERVER_PORT env var to override.`)
    process.exit(2)
  }
  console.error('[db-server] Server error:', err.message)
  process.exit(1)
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[db-server] ${signal} received — shutting down`)
  server.close(() => {
    try { fs.unlinkSync(pidFile) } catch {}
    process.exit(0)
  })
  setTimeout(() => {
    try { fs.unlinkSync(pidFile) } catch {}
    process.exit(0)
  }, 3000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
