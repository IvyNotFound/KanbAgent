/**
 * Unit tests for createMigrationAdapter — sql.js-compatible wrapper (T1157).
 * Covers: run, exec, prepare (bind/step/getAsObject/free/run), getRowsModified, close.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createMigrationAdapter } from './migration-db-adapter'
import type { MigrationDb } from './migration-db-adapter'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:')
  db.pragma('journal_mode = WAL')
  return db
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createMigrationAdapter', () => {
  let raw: BetterSqlite3.Database
  let adapter: MigrationDb

  beforeEach(() => {
    raw = makeDb()
    adapter = createMigrationAdapter(raw)
    raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')
    raw.exec("INSERT INTO items (name) VALUES ('alpha'), ('beta'), ('gamma')")
  })

  // ── run ────────────────────────────────────────────────────────────────────

  it('run — executes DML with params and tracks changes', () => {
    adapter.run('INSERT INTO items (name) VALUES (?)', ['delta'])
    expect(adapter.getRowsModified()).toBe(1)
    const row = raw.prepare('SELECT count(*) as n FROM items').get() as { n: number }
    expect(row.n).toBe(4)
  })

  it('run — executes multi-statement DDL without params', () => {
    adapter.run('CREATE TABLE t1 (x INT); CREATE TABLE t2 (y INT)')
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.map(r => r.name)).toContain('t1')
    expect(tables.map(r => r.name)).toContain('t2')
  })

  // ── exec ───────────────────────────────────────────────────────────────────

  it('exec — returns sql.js-format { columns, values }', () => {
    const result = adapter.exec('SELECT id, name FROM items ORDER BY id')
    expect(result).toHaveLength(1)
    expect(result[0].columns).toEqual(['id', 'name'])
    expect(result[0].values).toHaveLength(3)
    expect(result[0].values[0]).toEqual([1, 'alpha'])
  })

  it('exec — returns [] for empty result set', () => {
    const result = adapter.exec('SELECT * FROM items WHERE name = \'zzz\'')
    expect(result).toEqual([])
  })

  it('exec — returns [] for non-SELECT statement', () => {
    const result = adapter.exec('INSERT INTO items (name) VALUES (\'x\')')
    expect(result).toEqual([])
  })

  // ── prepare — single row (backward compat) ─────────────────────────────────

  it('prepare.step — single-row query: step returns true once, then false', () => {
    const stmt = adapter.prepare('SELECT name FROM items WHERE id = ?')
    stmt.bind([1])
    expect(stmt.step()).toBe(true)
    expect(stmt.getAsObject()).toEqual({ name: 'alpha' })
    expect(stmt.step()).toBe(false)
    stmt.free()
  })

  it('prepare.step — no-match query returns false immediately', () => {
    const stmt = adapter.prepare('SELECT name FROM items WHERE id = ?')
    stmt.bind([999])
    expect(stmt.step()).toBe(false)
    expect(stmt.getAsObject()).toEqual({})
    stmt.free()
  })

  // ── prepare — multi-row (regression fix for T1157 review) ─────────────────

  it('prepare.step — iterates ALL rows (multi-row regression fix)', () => {
    const stmt = adapter.prepare('SELECT name FROM items ORDER BY id')
    stmt.bind([])
    const names: string[] = []
    while (stmt.step()) {
      names.push(stmt.getAsObject()['name'] as string)
    }
    stmt.free()
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('prepare — agent duplicate name uniqueness loop (copy-N scenario)', () => {
    // Insert 3 agents named dev-copy, dev-copy-2, dev-copy-3
    raw.exec("INSERT INTO items (name) VALUES ('dev-copy'), ('dev-copy-2'), ('dev-copy-3')")

    const baseName = 'dev-copy'
    const likeStmt = adapter.prepare('SELECT name FROM items WHERE name LIKE ?')
    likeStmt.bind([baseName + '%'])
    const existingNames: string[] = []
    while (likeStmt.step()) {
      existingNames.push(likeStmt.getAsObject()['name'] as string)
    }
    likeStmt.free()

    const existing = new Set(existingNames)
    let newName = baseName
    let n = 2
    while (existing.has(newName)) { newName = `${baseName}-${n++}` }

    // Should skip dev-copy, dev-copy-2, dev-copy-3 → pick dev-copy-4
    expect(newName).toBe('dev-copy-4')
  })

  // ── free — resets state so same statement can be reused ───────────────────

  it('prepare.free — resets iteration state, next bind/step works', () => {
    const stmt = adapter.prepare('SELECT name FROM items WHERE id = ?')
    stmt.bind([1])
    expect(stmt.step()).toBe(true)
    stmt.free()
    // After free, a new bind+step should work correctly
    stmt.bind([2])
    expect(stmt.step()).toBe(true)
    expect(stmt.getAsObject()).toEqual({ name: 'beta' })
    stmt.free()
  })

  // ── prepare.run ────────────────────────────────────────────────────────────

  it('prepare.run — executes write statement with bound params', () => {
    const stmt = adapter.prepare('INSERT INTO items (name) VALUES (?)')
    stmt.run(['delta'])
    expect(adapter.getRowsModified()).toBe(1)
    const count = (raw.prepare('SELECT count(*) as n FROM items').get() as { n: number }).n
    expect(count).toBe(4)
  })

  // ── getRowsModified ────────────────────────────────────────────────────────

  it('getRowsModified — returns 0 when no writes have been made', () => {
    const a = createMigrationAdapter(raw)
    expect(a.getRowsModified()).toBe(0)
  })

  it('getRowsModified — returns affected rows after UPDATE', () => {
    adapter.run('UPDATE items SET name = ? WHERE id IN (1, 2)', ['z'])
    // better-sqlite3 reports changes per run (last operation)
    expect(adapter.getRowsModified()).toBe(2)
  })

  // ── close ──────────────────────────────────────────────────────────────────

  it('close — no-op, does not throw', () => {
    expect(() => adapter.close()).not.toThrow()
  })
})
