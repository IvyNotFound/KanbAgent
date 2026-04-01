/**
 * Shared test helpers for ipc-agents spec files.
 * Exports buildSchema, TEST_DB_PATH, and row-insertion helpers.
 * Each spec file imports these after setting up its own vi.mock blocks.
 */

import { queryLive, writeDb } from './db'

export const TEST_DB_PATH = '/test/ipc-agents-test.db'

// ── Schema builder ────────────────────────────────────────────────────────────
export async function buildSchema(): Promise<void> {
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
      permission_mode TEXT CHECK(permission_mode IN ('default', 'auto')) DEFAULT 'default',
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
      started_at TEXT,
      ended_at TEXT,
      updated_at TEXT,
      status TEXT,
      summary TEXT,
      claude_conv_id TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0
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

    db.run(`CREATE INDEX IF NOT EXISTS idx_task_agents_task_id ON task_agents(task_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_task_agents_agent_id ON task_agents(agent_id)`)

    db.run(`CREATE TABLE IF NOT EXISTS agent_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      parent_id  INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS agent_group_members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL REFERENCES agent_groups(id),
      agent_id   INTEGER NOT NULL REFERENCES agents(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(agent_id)
    )`)

    db.run(`CREATE INDEX IF NOT EXISTS idx_agm_group ON agent_group_members(group_id)`)
  })
}

// ── Row-insertion helpers ─────────────────────────────────────────────────────

export async function insertAgent(name: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO agents (name, type) VALUES (?, ?)', [name, 'dev'])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE name = ?', [name]) as Array<{ id: number }>
  return rows[0].id
}

export async function insertTask(title: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO tasks (title) VALUES (?)', [title])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM tasks WHERE title = ?', [title]) as Array<{ id: number }>
  return rows[0].id
}

export async function getTaskAgents(taskId: number): Promise<Array<{ agent_id: number; role: string | null }>> {
  return queryLive(
    TEST_DB_PATH,
    'SELECT agent_id, role FROM task_agents WHERE task_id = ? ORDER BY assigned_at ASC',
    [taskId]
  ) as Promise<Array<{ agent_id: number; role: string | null }>>
}

export async function getTaskAssigneId(taskId: number): Promise<number | null> {
  const rows = await queryLive(
    TEST_DB_PATH,
    'SELECT agent_assigned_id FROM tasks WHERE id = ?',
    [taskId]
  ) as Array<{ agent_assigned_id: number | null }>
  return rows[0]?.agent_assigned_id ?? null
}
