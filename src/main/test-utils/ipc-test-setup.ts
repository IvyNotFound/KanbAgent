/**
 * Shared test utilities for IPC integration tests — T985
 *
 * Provides:
 * - Shared in-memory DB (better-sqlite3 :memory:)
 * - buildSchema(): better-sqlite3 Database with full schema
 * - insertAgent(), insertSession(), insertTask() helpers
 * - TEST_DB_PATH, TEST_PROJECT_PATH constants
 *
 * Usage: import from this module AFTER all vi.mock() calls in each spec file.
 */

import { queryLive, writeDb } from '../db'

export const TEST_DB_PATH = '/test/ipc-integration-test.db'
export const TEST_PROJECT_PATH = '/test/project'

// ── Shared in-memory buffer (exported for mock closures) ──────────────────────
export let dbBuffer: Buffer = Buffer.alloc(0)
export let dbMtime = 1000

export function setDbBuffer(buf: Buffer): void {
  dbBuffer = buf
}

export function setDbMtime(t: number): void {
  dbMtime = t
}

export function incrementDbMtime(): void {
  dbMtime += 1
}

export function getDbBuffer(): Buffer {
  return dbBuffer
}

export function getDbMtime(): number {
  return dbMtime
}

// ── Schema builder ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildSchema(): Promise<any> {
  // Use writeDb to create schema within the mocked DB infrastructure
  await writeDb(TEST_DB_PATH, (db) => {
    db.run(`CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT,
      scope TEXT,
      system_prompt TEXT,
      system_prompt_suffix TEXT,
      thinking_mode TEXT,
      allowed_tools TEXT,
      auto_launch INTEGER NOT NULL DEFAULT 1,
      permission_mode TEXT DEFAULT 'default',
      worktree_enabled INTEGER NOT NULL DEFAULT 0,
      max_sessions INTEGER NOT NULL DEFAULT 3,
      preferred_model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      status TEXT DEFAULT 'todo',
      agent_creator_id INTEGER,
      agent_assigned_id INTEGER,
      agent_validator_id INTEGER,
      parent_task_id INTEGER,
      session_id INTEGER,
      scope TEXT,
      effort INTEGER,
      priority TEXT DEFAULT 'normal',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      validated_at TEXT
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'started',
      summary TEXT,
      claude_conv_id TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      num_turns INTEGER,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      tokens_cache_write INTEGER DEFAULT 0
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      agent_id INTEGER,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS task_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_task INTEGER,
      to_task INTEGER,
      type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS locks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT,
      agent_id INTEGER,
      session_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      released_at TEXT
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      agent_id INTEGER,
      level TEXT,
      action TEXT,
      detail TEXT,
      files TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS scopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      folder TEXT,
      techno TEXT,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS task_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      role TEXT CHECK(role IN ('primary', 'support', 'reviewer')),
      assigned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(task_id, agent_id)
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS agent_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS agent_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES agent_groups(id),
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(agent_id)
    )`)
  })
}

// ── Data helpers ──────────────────────────────────────────────────────────────

export async function insertAgent(
  name: string,
  extra?: { type?: string; scope?: string; perimetre?: string }
): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO agents (name, type, scope) VALUES (?, ?, ?)', [
      name,
      extra?.type ?? 'test',
      extra?.scope ?? extra?.perimetre ?? null,
    ])
  })
  const rows = (await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE name = ?', [
    name,
  ])) as Array<{ id: number }>
  return rows[0].id
}

export async function insertSession(
  agentId: number,
  opts?: {
    statut?: string
    status?: string
    convId?: string
    costUsd?: number
    startedAt?: string
  }
): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run(
      'INSERT INTO sessions (agent_id, status, claude_conv_id, cost_usd, started_at) VALUES (?, ?, ?, ?, ?)',
      [
        agentId,
        opts?.status ?? opts?.statut ?? 'started',
        opts?.convId ?? null,
        opts?.costUsd ?? null,
        opts?.startedAt ?? "datetime('now')",
      ]
    )
  })
  const rows = (await queryLive(
    TEST_DB_PATH,
    'SELECT id FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
    [agentId]
  )) as Array<{ id: number }>
  return rows[0].id
}

export async function insertTask(
  title: string,
  opts?: {
    statut?: string
    status?: string
    agentId?: number | null
    scope?: string | null
    perimetre?: string | null
    description?: string
  }
): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run(
      'INSERT INTO tasks (title, status, agent_assigned_id, scope, description) VALUES (?, ?, ?, ?, ?)',
      [
        title,
        opts?.status ?? opts?.statut ?? 'todo',
        opts?.agentId ?? null,
        opts?.scope ?? opts?.perimetre ?? null,
        opts?.description ?? null,
      ]
    )
  })
  const rows = (await queryLive(
    TEST_DB_PATH,
    'SELECT id FROM tasks WHERE title = ? ORDER BY id DESC LIMIT 1',
    [title]
  )) as Array<{ id: number }>
  return rows[0].id
}
