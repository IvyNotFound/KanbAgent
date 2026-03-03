#!/usr/bin/env node
/**
 * capture-tokens-hook.js — Claude Code Stop hook for automatic token capture (T627)
 *
 * Called by Claude Code at the end of every session in this project.
 * Receives a JSON payload via stdin:
 *   { hook_event_name, session_id, transcript_path, cwd }
 *
 * Reads the JSONL transcript, sums token usage from finalized assistant messages,
 * and persists the counts to sessions.tokens_* WHERE claude_conv_id = session_id.
 *
 * Fallback: if no session found by conv_id, updates the most recent completed/started
 * session with tokens_in = 0.
 *
 * Always exits with code 0 — hook must never block Claude Code shutdown.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const DB_PATH = path.resolve(__dirname, '../.claude/project.db')
const PROJECT_PATH = path.resolve(__dirname, '..')

/**
 * Parse token usage from a JSONL transcript.
 * Only counts finalized assistant messages (stop_reason != null).
 * @param {string} jsonlPath
 * @returns {{ tokensIn: number, tokensOut: number, cacheRead: number, cacheWrite: number }}
 */
function parseTokensFromJSONL(jsonlPath) {
  let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0
  let content
  try {
    content = fs.readFileSync(jsonlPath, 'utf-8')
  } catch (err) {
    process.stderr.write(`[capture-tokens] Cannot read JSONL: ${err.message}\n`)
    return { tokensIn, tokensOut, cacheRead, cacheWrite }
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant') continue
      if (!obj.message?.usage || obj.message.stop_reason == null) continue
      const u = obj.message.usage
      tokensIn  += (u.input_tokens                ?? 0)
      tokensOut += (u.output_tokens               ?? 0)
      cacheRead += (u.cache_read_input_tokens      ?? 0)
      cacheWrite += (u.cache_creation_input_tokens ?? 0)
    } catch { /* malformed line — skip */ }
  }
  return { tokensIn, tokensOut, cacheRead, cacheWrite }
}

async function main() {
  // 1. Read stdin JSON payload
  const chunks = []
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const raw = chunks.join('').trim()

  if (!raw) process.exit(0)

  let payload
  try {
    payload = JSON.parse(raw)
  } catch (err) {
    process.stderr.write(`[capture-tokens] Invalid JSON payload: ${err.message}\n`)
    process.exit(0)
  }

  const { session_id: convId, transcript_path: transcriptPath, cwd } = payload

  // 2. Verify this hook applies to our project
  if (cwd && !cwd.startsWith(PROJECT_PATH)) process.exit(0)

  if (!convId || !transcriptPath) {
    process.stderr.write('[capture-tokens] Missing session_id or transcript_path\n')
    process.exit(0)
  }

  // 3. Check DB exists
  if (!fs.existsSync(DB_PATH)) {
    process.stderr.write(`[capture-tokens] DB not found at ${DB_PATH}\n`)
    process.exit(0)
  }

  // 4. Parse the JSONL
  const tokens = parseTokensFromJSONL(transcriptPath)
  if (tokens.tokensIn === 0 && tokens.tokensOut === 0) process.exit(0)

  // 5. Load sql.js with wasm binary (avoids async init issues)
  const initSqlJs = require('sql.js')
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const wasmBuf = fs.readFileSync(wasmPath)
  const SQL = await initSqlJs({ wasmBinary: wasmBuf })

  // 6. Find the target session by conv_id, fallback to most recent with no tokens
  let sessionId = null
  {
    const buf = fs.readFileSync(DB_PATH)
    const db = new SQL.Database(buf)

    const byConvId = db.prepare('SELECT id FROM sessions WHERE claude_conv_id = ?')
    byConvId.bind([convId])
    if (byConvId.step()) sessionId = byConvId.getAsObject().id
    byConvId.free()

    if (sessionId === null) {
      const fallback = db.prepare(
        "SELECT id FROM sessions WHERE (tokens_in = 0 OR tokens_in IS NULL) AND statut IN ('started','completed') ORDER BY id DESC LIMIT 1"
      )
      if (fallback.step()) {
        sessionId = fallback.getAsObject().id
        process.stderr.write(`[capture-tokens] Fallback: using session ${sessionId} (conv_id ${convId} not found)\n`)
      }
      fallback.free()
    }
    db.close()
  }

  if (sessionId === null) {
    process.stderr.write(`[capture-tokens] No session found for conv_id=${convId}\n`)
    process.exit(0)
  }

  // 7. Write token counts — use advisory lock to prevent concurrent write races
  const { acquireLock, releaseLock, cleanupOrphanTmp } = require('./dblock')
  cleanupOrphanTmp(DB_PATH)
  const lockPath = acquireLock(DB_PATH)
  try {
    const buf = fs.readFileSync(DB_PATH)
    const db = new SQL.Database(buf)
    const stmt = db.prepare(
      'UPDATE sessions SET tokens_in = ?, tokens_out = ?, tokens_cache_read = ?, tokens_cache_write = ? WHERE id = ?'
    )
    stmt.run([tokens.tokensIn, tokens.tokensOut, tokens.cacheRead, tokens.cacheWrite, sessionId])
    stmt.free()
    const tmpPath = `${DB_PATH}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmpPath, Buffer.from(db.export()))
    fs.renameSync(tmpPath, DB_PATH)
    db.close()
    process.stderr.write(`[capture-tokens] session ${sessionId}: in=${tokens.tokensIn} out=${tokens.tokensOut} cacheR=${tokens.cacheRead} cacheW=${tokens.cacheWrite}\n`)
  } finally {
    releaseLock(lockPath)
  }
}

main().catch((err) => {
  process.stderr.write(`[capture-tokens] Fatal: ${err.message}\n`)
  process.exit(0) // Always exit 0 — must not block Claude Code shutdown
})
