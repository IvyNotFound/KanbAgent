/**
 * Tests for schema-init.ts — isArchiveAllowedInCheck and recreateTasksTableWithArchive.
 * Uses better-sqlite3 in-memory DB via createMigrationAdapter for realistic coverage.
 * Target: kill surviving mutants at score 13% (T1331).
 *
 * colMapping requirements: every source table must expose at minimum:
 *   id, description, created_at, updated_at
 *   + one of: title / titre
 *   + one of: scope / perimetre
 *   + one of: status (English) / statut (French, triggers CASE expression)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createMigrationAdapter } from '../migration-db-adapter'
import type { MigrationDb } from '../migration-db-adapter'
import { isArchiveAllowedInCheck, recreateTasksTableWithArchive } from './schema-init'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRaw(): BetterSqlite3.Database {
  const raw = new BetterSqlite3(':memory:')
  // Create dependency tables so REFERENCES in the new tasks schema resolves.
  // SQLite resolves FK table references at CREATE TABLE time even with FK enforcement OFF.
  raw.exec('CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY)')
  raw.exec('CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY)')
  return raw
}

function makeAdapter(raw: BetterSqlite3.Database): MigrationDb {
  return createMigrationAdapter(raw)
}

/** Full modern English schema */
function createModernTasksTable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      scope TEXT,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','in_progress','done','archived')),
      priority TEXT NOT NULL DEFAULT 'normal'
        CHECK(priority IN ('low','normal','high','critical')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * French schema without 'archivé'/'archived' in CHECK.
 * Includes all columns required by colMapping fallback paths:
 * titre, perimetre, description, statut, created_at, updated_at.
 */
function createLegacyNoArchive(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL DEFAULT '',
      description TEXT,
      perimetre TEXT,
      statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * French schema WITH 'archivé' in CHECK.
 */
function createLegacyWithArchive(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL DEFAULT '',
      description TEXT,
      perimetre TEXT,
      statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé','archivé')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * Bare French schema with no CHECK constraint (allows inserting any statut value).
 */
function createBareTable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL DEFAULT '',
      description TEXT,
      perimetre TEXT,
      statut TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

// ── isArchiveAllowedInCheck ───────────────────────────────────────────────────

describe('isArchiveAllowedInCheck', () => {
  it('returns true when tasks table does not exist (empty DB)', () => {
    const raw = makeRaw()
    expect(isArchiveAllowedInCheck(makeAdapter(raw))).toBe(true)
  })

  it('returns true when tasks table has "archived" in CHECK (line 19)', () => {
    const raw = makeRaw()
    createModernTasksTable(raw)
    expect(isArchiveAllowedInCheck(makeAdapter(raw))).toBe(true)
  })

  it('returns true when tasks table has French "archivé" in CHECK (line 18)', () => {
    const raw = makeRaw()
    createLegacyWithArchive(raw)
    expect(isArchiveAllowedInCheck(makeAdapter(raw))).toBe(true)
  })

  it("returns true when tasks table schema contains \"'done'\" (line 20)", () => {
    const raw = makeRaw()
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        description TEXT,
        status TEXT CHECK(status IN ('todo','in_progress','done')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    expect(isArchiveAllowedInCheck(makeAdapter(raw))).toBe(true)
  })

  it('returns false when tasks table has old French CHECK without archive values', () => {
    const raw = makeRaw()
    createLegacyNoArchive(raw)
    expect(isArchiveAllowedInCheck(makeAdapter(raw))).toBe(false)
  })

  it('returns false — schema has only a_faire/en_cours/terminé/validé', () => {
    const raw = makeRaw()
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        description TEXT,
        statut TEXT CHECK(statut IN ('a_faire','en_cours','terminé','validé')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    expect(isArchiveAllowedInCheck(makeAdapter(raw))).toBe(false)
  })

  // Cover line 11 branch: result[0].values is empty
  it('returns true when exec returns result with empty values array', () => {
    const db: MigrationDb = {
      run: () => {},
      exec: (sql: string) => {
        if (sql.includes('sqlite_master')) {
          return [{ columns: ['sql'], values: [] }]
        }
        return []
      },
      prepare: () => { throw new Error('not used') },
      getRowsModified: () => 0,
      close: () => {},
    }
    expect(isArchiveAllowedInCheck(db)).toBe(true)
  })
})

// ── recreateTasksTableWithArchive ─────────────────────────────────────────────
