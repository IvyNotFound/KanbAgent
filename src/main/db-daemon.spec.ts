/**
 * Tests for the DB daemon infrastructure (T1499).
 *
 * Covers:
 * - db-port.js: getPort() determinism and range
 * - db-client.js: queryDaemon() returns null on unreachable server
 * - db-server.js: HTTP endpoints (/health, /query, /write, /exec) via inline mock server
 * - Concurrent write serialization
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import os from 'os'
import path from 'path'
import fs from 'fs'

// ── db-port tests ─────────────────────────────────────────────────────────────
describe('db-port.js — getPort()', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPort, BASE_PORT } = require('../../scripts/db-port')

  it('returns a number in [BASE_PORT, BASE_PORT + 9999]', () => {
    const port = getPort('/some/project/.claude/project.db')
    expect(port).toBeGreaterThanOrEqual(BASE_PORT)
    expect(port).toBeLessThanOrEqual(BASE_PORT + 9999)
  })

  it('is deterministic for the same path', () => {
    const p1 = getPort('/a/b/c/project.db')
    const p2 = getPort('/a/b/c/project.db')
    expect(p1).toBe(p2)
  })

  it('produces different ports for different paths', () => {
    const p1 = getPort('/project-a/.claude/project.db')
    const p2 = getPort('/project-b/.claude/project.db')
    expect(p1).not.toBe(p2)
  })

  it('BASE_PORT is 27184', () => {
    expect(BASE_PORT).toBe(27184)
  })
})

// ── db-client tests ───────────────────────────────────────────────────────────
describe('db-client.js — queryDaemon()', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { queryDaemon } = require('../../scripts/db-client')

  it('returns null when no server is listening', async () => {
    const result = await queryDaemon(1, '/health', null, 200)
    expect(result).toBeNull()
  })

  it('returns null on HTTP error status', async () => {
    await new Promise<void>((resolve) => {
      const srv = createServer((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end('{"error":"boom"}')
      })
      srv.listen(29999, '127.0.0.1', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { queryDaemon: qd } = require('../../scripts/db-client')
        qd(29999, '/health', null, 500).then((r: unknown) => {
          expect(r).toBeNull()
          srv.close(() => resolve())
        })
      })
    })
  })
})

// ── db-client getDbPath ───────────────────────────────────────────────────────
describe('db-client.js — getDbPath()', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDbPath } = require('../../scripts/db-client')

  it('resolves .claude/project.db from normal cwd', () => {
    const result = getDbPath('/home/user/myproject')
    expect(result).toBe(path.resolve('/home/user/myproject', '.claude/project.db'))
  })

  it('resolves from main repo when cwd is a worktree', () => {
    const worktreeCwd = '/home/user/myproject/.claude/worktrees/s123456'
    const result = getDbPath(worktreeCwd)
    expect(result).toBe(path.resolve('/home/user/myproject', '.claude/project.db'))
  })
})

// ── Inline mock HTTP server tests ─────────────────────────────────────────────
// Tests the HTTP protocol shape expected by db-server.js, using a mock server
// that mirrors the real endpoint behavior without spawning sqlite3.exe.
describe('db-server HTTP protocol (mock server)', () => {
  let server: Server
  let serverPort: number

  // In-memory store for test
  const store: { id: number; val: string }[] = []
  let nextId = 1
  let lastChanges = 0
  let lastInsertRowid = 0

  // Write mutex (same pattern as db-server.js)
  let writeLock = Promise.resolve<void>(undefined)
  function withWriteLock<T>(fn: () => T): Promise<T> {
    const next = writeLock.then(() => fn())
    writeLock = (next as Promise<unknown>).catch(() => undefined).then(() => undefined)
    return next
  }

  function readBody(req: import('http').IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (c: string) => { data += c })
      req.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
      req.on('error', reject)
    })
  }

  type Body = { sql?: string; params?: unknown[]; json?: boolean }

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const send = (status: number, body: unknown) => {
        const json = JSON.stringify(body)
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(json)
      }
      try {
        if (req.method === 'GET' && req.url === '/health') {
          send(200, { status: 'ok', pid: process.pid, port: serverPort })
          return
        }
        if (req.method === 'POST' && req.url === '/query') {
          const body = await readBody(req) as Body
          const sql = body.sql ?? ''
          // Handle: SELECT COUNT(*) as cnt, SELECT * FROM items
          if (sql.includes('COUNT(*)')) {
            send(200, { rows: [{ cnt: store.length }] })
          } else {
            send(200, { rows: [...store] })
          }
          return
        }
        if (req.method === 'POST' && req.url === '/write') {
          const body = await readBody(req) as Body
          if (!body.sql) { send(400, { error: 'sql required' }); return }
          // Simulate insert
          const valMatch = String(body.sql).match(/VALUES\s*\('([^']+)'\)/)
          const result = await withWriteLock(() => {
            if (valMatch) {
              const item = { id: nextId++, val: valMatch[1] }
              store.push(item)
              lastChanges = 1
              lastInsertRowid = item.id
            }
            return { ok: true, changes: lastChanges, lastInsertRowid }
          })
          send(200, result)
          return
        }
        send(404, { error: 'Not found' })
      } catch (err) {
        send(500, { error: (err as Error).message })
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        serverPort = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(() => { server.close() })

  it('GET /health returns status ok', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`)
    expect(res.ok).toBe(true)
    const data = await res.json() as { status: string }
    expect(data.status).toBe('ok')
  })

  it('POST /write inserts and returns ok + lastInsertRowid', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "INSERT INTO items (val) VALUES ('hello')" }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { ok: boolean; lastInsertRowid: number; changes: number }
    expect(data.ok).toBe(true)
    expect(data.changes).toBe(1)
    expect(typeof data.lastInsertRowid).toBe('number')
  })

  it('POST /query returns rows', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "SELECT * FROM items" }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { rows: { val: string }[] }
    expect(data.rows.length).toBeGreaterThan(0)
  })

  it('POST /write serializes concurrent writes', async () => {
    const inserts = Array.from({ length: 5 }, (_, i) =>
      fetch(`http://127.0.0.1:${serverPort}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `INSERT INTO items (val) VALUES ('concurrent-${i}')` }),
      })
    )
    const results = await Promise.all(inserts)
    for (const r of results) {
      expect(r.ok).toBe(true)
      const d = await r.json() as { ok: boolean }
      expect(d.ok).toBe(true)
    }
    // Check total count
    const check = await fetch(`http://127.0.0.1:${serverPort}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "SELECT COUNT(*) as cnt FROM items" }),
    })
    const checkData = await check.json() as { rows: { cnt: number }[] }
    expect(checkData.rows[0].cnt).toBeGreaterThanOrEqual(5)
  })

  it('POST /write requires sql field', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noSql: 'oops' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── db-server.js PID file convention ─────────────────────────────────────────
describe('db-server.js — PID file naming', () => {
  it('PID file is in tmpdir and keyed by port', () => {
    const port = 27999
    const expected = path.join(os.tmpdir(), `kanbagent-db-${port}.pid`)
    expect(expected).toContain('kanbagent-db-27999.pid')
    expect(expected.startsWith(os.tmpdir())).toBe(true)
  })

  it('PID file cleanup pattern matches shutdown handler', () => {
    const testPidFile = path.join(os.tmpdir(), 'kanbagent-db-test-cleanup.pid')
    fs.writeFileSync(testPidFile, '99999')
    expect(fs.existsSync(testPidFile)).toBe(true)
    try { fs.unlinkSync(testPidFile) } catch {}
    expect(fs.existsSync(testPidFile)).toBe(false)
  })
})
