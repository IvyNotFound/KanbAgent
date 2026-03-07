/**
 * Behavioural tests for task:setAssignees / task:getAssignees IPC handlers (T418)
 *
 * Strategy: real sql.js Database in memory, fs/promises mocked to read/write
 * from a Buffer variable so writeDb operates on the actual in-memory schema.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
// Each test suite resets dbBuffer to a freshly built schema snapshot.
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000

// ── Mock fs/promises ─────────────────────────────────────────────────────────
// writeDb: readFile → dbBuffer, writeFile → update dbBuffer, stat → {mtimeMs}
// jsonlMockContent: used by tests to inject JSONL content for .jsonl reads
let jsonlMockContent: string | Error | null = null

// readFileMockImpl uses vi.hoisted so it is available when vi.mock is hoisted
const { readFileMockImpl } = vi.hoisted(() => ({
  readFileMockImpl: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: readFileMockImpl,
    writeFile: vi.fn(async (_path: string, data: Buffer) => {
      dbBuffer = data
      dbMtime += 1
    }),
    rename: vi.fn(async (src: string) => {
      // tmp file was already written to dbBuffer by writeFile above
      // rename just removes the .tmp suffix — no extra work needed
      void src
    }),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
  readFile: readFileMockImpl,
  writeFile: vi.fn(async (_path: string, data: Buffer) => {
    dbBuffer = data
    dbMtime += 1
  }),
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock readline — emits lines from jsonlMockContent ─────────────────────────
// createReadStream (from 'fs') is NOT mocked — the real stream is created but
// immediately silenced and destroyed so file-not-found errors don't propagate.
vi.mock('readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readline')>()
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    // Silence and destroy the real stream to prevent unhandled errors in test env
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()

    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => {
      if (jsonlMockContent instanceof Error) {
        rl.emit('error', jsonlMockContent)
        return
      }
      if (jsonlMockContent === null) {
        rl.emit('error', new Error('ENOENT: no such file'))
        return
      }
      for (const line of jsonlMockContent.split('\n')) {
        rl.emit('line', line)
      }
      rl.emit('close')
    })
    return rl
  })
  return {
    ...actual,
    createInterface,
    default: { ...actual, createInterface },
  }
})

// ── Mock electron ────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: { getVersion: vi.fn(() => '0.5.0') },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
}))

// ── Mock migration ────────────────────────────────────────────────────────────
vi.mock('./migration', () => ({
  runTaskStatusMigration: vi.fn(() => 0),
  runAddPriorityMigration: vi.fn(() => false),
  runTaskStatutI18nMigration: vi.fn(() => 0),
  runAddConvIdToSessionsMigration: vi.fn(() => false),
  runAddTokensToSessionsMigration: vi.fn(() => 0),
  runRemoveThinkingModeBudgetTokensMigration: vi.fn(() => false),
  runDropCommentaireColumnMigration: vi.fn(() => 0),
  runSessionStatutI18nMigration: vi.fn(() => 0),
  runMakeAgentAssigneNotNullMigration: vi.fn(() => false),
  runMakeCommentAgentNotNullMigration: vi.fn(() => false),
}))

// ── Mock claude-md ────────────────────────────────────────────────────────────
vi.mock('./claude-md', () => ({
  insertAgentIntoClaudeMd: vi.fn((content: string) => content),
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { getSqlJs, registerDbPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'

// readFileMock: alias for readFileMockImpl used in T581 session token tests
const readFileMock = readFileMockImpl

// ── Schema builder ────────────────────────────────────────────────────────────
async function buildSchema(): Promise<any> {
  const sqlJs = await getSqlJs()
  const db = new sqlJs.Database()

  db.run(`CREATE TABLE agents (
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
    max_sessions INTEGER NOT NULL DEFAULT 3,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE tasks (
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

  db.run(`CREATE TABLE sessions (
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

  db.run(`CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    agent_id INTEGER,
    content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE task_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_task INTEGER,
    to_task INTEGER,
    type TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file TEXT,
    agent_id INTEGER,
    session_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    released_at TEXT
  )`)

  db.run(`CREATE TABLE agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    agent_id INTEGER,
    level TEXT,
    action TEXT,
    detail TEXT,
    files TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )`)

  db.run(`CREATE TABLE scopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    folder TEXT,
    techno TEXT,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE task_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    role TEXT CHECK(role IN ('primary', 'support', 'reviewer')),
    assigned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(task_id, agent_id)
  )`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_task_agents_task_id ON task_agents(task_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_task_agents_agent_id ON task_agents(agent_id)`)

  db.run(`CREATE TABLE agent_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    parent_id  INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE agent_group_members (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL REFERENCES agent_groups(id),
    agent_id   INTEGER NOT NULL REFERENCES agents(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(agent_id)
  )`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_agm_group ON agent_group_members(group_id)`)

  return db
}

const TEST_DB_PATH = '/test/ipc-agents-test.db'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  jsonlMockContent = null
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  // Restore readFileMockImpl implementation after clearAllMocks resets it
  readFileMockImpl.mockImplementation(async (path: string) => {
    if (typeof path === 'string' && path.endsWith('.jsonl')) {
      if (jsonlMockContent instanceof Error) throw jsonlMockContent
      if (jsonlMockContent !== null) return jsonlMockContent
      throw new Error('ENOENT: no such file')
    }
    return dbBuffer
  })

  // Build fresh DB and export to shared buffer
  const db = await buildSchema()
  dbBuffer = Buffer.from(db.export())
  db.close()

  // Register the path as allowed
  registerDbPath(TEST_DB_PATH)

  // Ensure handlers are registered
  registerAgentHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── Helper: insert agent & task ───────────────────────────────────────────────
async function insertAgent(name: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO agents (name, type) VALUES (?, ?)', [name, 'dev'])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE name = ?', [name]) as Array<{ id: number }>
  return rows[0].id
}

async function insertTask(title: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO tasks (title) VALUES (?)', [title])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM tasks WHERE title = ?', [title]) as Array<{ id: number }>
  return rows[0].id
}

async function getTaskAgents(taskId: number): Promise<Array<{ agent_id: number; role: string | null }>> {
  return queryLive(
    TEST_DB_PATH,
    'SELECT agent_id, role FROM task_agents WHERE task_id = ? ORDER BY assigned_at ASC',
    [taskId]
  ) as Promise<Array<{ agent_id: number; role: string | null }>>
}

async function getTaskAssigneId(taskId: number): Promise<number | null> {
  const rows = await queryLive(
    TEST_DB_PATH,
    'SELECT agent_assigned_id FROM tasks WHERE id = ?',
    [taskId]
  ) as Array<{ agent_assigned_id: number | null }>
  return rows[0]?.agent_assigned_id ?? null
}

// ── Tests: task:setAssignees behavioural ─────────────────────────────────────

describe('task:setAssignees — behavioural (T418)', () => {
  it('assigning 2 agents → task_agents has 2 rows', async () => {
    const agentA = await insertAgent('agent-alpha')
    const agentB = await insertAgent('agent-beta')
    const taskId = await insertTask('task-two-agents')

    const result = await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentA, role: null }, { agentId: agentB, role: null }]
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await getTaskAgents(taskId)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.agent_id)).toEqual(expect.arrayContaining([agentA, agentB]))
  })

  it('role=primary → tasks.agent_assigned_id = primary agent_id', async () => {
    const agentA = await insertAgent('agent-primary')
    const agentB = await insertAgent('agent-support')
    const taskId = await insertTask('task-with-primary')

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentB, role: 'support' }, { agentId: agentA, role: 'primary' }]
    )

    const assigneId = await getTaskAssigneId(taskId)
    expect(assigneId).toBe(agentA)
  })

  it('no primary → tasks.agent_assigned_id = first assignee', async () => {
    const agentA = await insertAgent('agent-first')
    const agentB = await insertAgent('agent-second')
    const taskId = await insertTask('task-no-primary')

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentA, role: 'support' }, { agentId: agentB, role: 'reviewer' }]
    )

    const assigneId = await getTaskAssigneId(taskId)
    expect(assigneId).toBe(agentA)
  })

  it('empty list → task_agents empty + agent_assigned_id = NULL', async () => {
    const agentA = await insertAgent('agent-to-remove')
    const taskId = await insertTask('task-to-clear')

    // First assign someone
    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentA, role: 'primary' }]
    )

    // Then clear
    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      []
    )

    const rows = await getTaskAgents(taskId)
    expect(rows).toHaveLength(0)

    const assigneId = await getTaskAssigneId(taskId)
    expect(assigneId).toBeNull()
  })

  it('atomic replacement: set([A,B]) then set([C]) → only C in task_agents', async () => {
    const agentA = await insertAgent('agent-old-a')
    const agentB = await insertAgent('agent-old-b')
    const agentC = await insertAgent('agent-new-c')
    const taskId = await insertTask('task-atomic-replace')

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentA, role: null }, { agentId: agentB, role: null }]
    )

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentC, role: 'primary' }]
    )

    const rows = await getTaskAgents(taskId)
    expect(rows).toHaveLength(1)
    expect(rows[0].agent_id).toBe(agentC)

    const assigneId = await getTaskAssigneId(taskId)
    expect(assigneId).toBe(agentC)
  })

  it('idempotence: set([A]) + set([A]) → 1 row in task_agents', async () => {
    const agentA = await insertAgent('agent-idempotent')
    const taskId = await insertTask('task-idempotent')

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentA, role: 'primary' }]
    )

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: agentA, role: 'primary' }]
    )

    const rows = await getTaskAgents(taskId)
    expect(rows).toHaveLength(1)
    expect(rows[0].agent_id).toBe(agentA)
  })
})

// ── Tests: task:getAssignees behavioural ─────────────────────────────────────

describe('task:getAssignees — behavioural (T418)', () => {
  it('task without assignees → assignees = []', async () => {
    const taskId = await insertTask('task-no-assignees')

    const result = await handlers['task:getAssignees'](
      null,
      TEST_DB_PATH,
      taskId
    ) as { success: boolean; assignees: unknown[] }

    expect(result.success).toBe(true)
    expect(result.assignees).toHaveLength(0)
  })

  it('returns assignees sorted by assigned_at ASC', async () => {
    const agentA = await insertAgent('agent-sorted-first')
    const agentB = await insertAgent('agent-sorted-second')
    const taskId = await insertTask('task-sorted-assignees')

    // Insert manually with controlled timestamps
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        "INSERT INTO task_agents (task_id, agent_id, role, assigned_at) VALUES (?, ?, ?, ?)",
        [taskId, agentA, null, '2026-01-01 10:00:00']
      )
      db.run(
        "INSERT INTO task_agents (task_id, agent_id, role, assigned_at) VALUES (?, ?, ?, ?)",
        [taskId, agentB, 'primary', '2026-01-01 11:00:00']
      )
    })

    const result = await handlers['task:getAssignees'](
      null,
      TEST_DB_PATH,
      taskId
    ) as { success: boolean; assignees: Array<{ agent_id: number; agent_name: string; role: string | null; assigned_at: string }> }

    expect(result.success).toBe(true)
    expect(result.assignees).toHaveLength(2)
    // First by assigned_at ASC
    expect(result.assignees[0].agent_id).toBe(agentA)
    expect(result.assignees[1].agent_id).toBe(agentB)
    expect(result.assignees[1].role).toBe('primary')
  })

  it('returns agent_name via JOIN on agents', async () => {
    const agentId = await insertAgent('named-agent-xyz')
    const taskId = await insertTask('task-named-agent')

    await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId, role: 'support' }]
    )

    const result = await handlers['task:getAssignees'](
      null,
      TEST_DB_PATH,
      taskId
    ) as { success: boolean; assignees: Array<{ agent_name: string; role: string }> }

    expect(result.success).toBe(true)
    expect(result.assignees[0].agent_name).toBe('named-agent-xyz')
    expect(result.assignees[0].role).toBe('support')
  })
})

// ── Tests: validation guards ──────────────────────────────────────────────────

describe('task:setAssignees — validation guards', () => {
  it('invalid taskId (float) → {success:false, error}', async () => {
    const result = await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      1.5,
      []
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid taskId')
  })

  it('invalid agentId → {success:false, error}', async () => {
    const taskId = await insertTask('task-invalid-agent')

    const result = await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId: 1.5, role: null }]
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid role → {success:false, error}', async () => {
    const agentId = await insertAgent('agent-bad-role')
    const taskId = await insertTask('task-bad-role')

    const result = await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      [{ agentId, role: 'owner' as 'primary' }]
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid role: 'owner'")
  })

  it('assignees not an array → {success:false, error}', async () => {
    const taskId = await insertTask('task-not-array')

    const result = await handlers['task:setAssignees'](
      null,
      TEST_DB_PATH,
      taskId,
      'not-an-array' as unknown as []
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('assignees must be an array')
  })
})

// ── Tests: update-agent maxSessions ──────────────────────────────────────────

describe('update-agent — maxSessions (T468)', () => {
  it('valid maxSessions=5 → persisted in DB', async () => {
    const agentId = await insertAgent('agent-max-sessions-valid')

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { maxSessions: 5 }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT max_sessions FROM agents WHERE id = ?', [agentId]) as Array<{ max_sessions: number }>
    expect(rows[0].max_sessions).toBe(5)
  })

  it('maxSessions=0 → {success:false, error}', async () => {
    const agentId = await insertAgent('agent-max-sessions-zero')

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { maxSessions: 0 }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('maxSessions')
  })

  it('maxSessions=-1 (unlimited) → {success:true} + persisted in DB', async () => {
    const agentId = await insertAgent('agent-max-sessions-neg')

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { maxSessions: -1 }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT max_sessions FROM agents WHERE id = ?', [agentId]) as Array<{ max_sessions: number }>
    expect(rows[0].max_sessions).toBe(-1)
  })

  it('maxSessions=1.5 (float) → {success:false, error}', async () => {
    const agentId = await insertAgent('agent-max-sessions-float')

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { maxSessions: 1.5 }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('maxSessions')
  })

  it('default max_sessions=3 on fresh agent', async () => {
    const agentId = await insertAgent('agent-default-max-sessions')

    const rows = await queryLive(TEST_DB_PATH, 'SELECT max_sessions FROM agents WHERE id = ?', [agentId]) as Array<{ max_sessions: number }>
    expect(rows[0].max_sessions).toBe(3)
  })
})

describe('task:getAssignees — validation guards', () => {
  it('invalid taskId (string) → {success:false, error}', async () => {
    const result = await handlers['task:getAssignees'](
      null,
      TEST_DB_PATH,
      'not-a-number' as unknown as number
    ) as { success: boolean; assignees: unknown[]; error: string }

    expect(result.success).toBe(false)
    expect(result.assignees).toHaveLength(0)
    expect(result.error).toContain('Invalid taskId')
  })

  it('invalid taskId (float) → {success:false, error}', async () => {
    const result = await handlers['task:getAssignees'](
      null,
      TEST_DB_PATH,
      3.14
    ) as { success: boolean; assignees: unknown[]; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid taskId')
  })
})

// ── Tests: delete-agent (T437) ────────────────────────────────────────────────

describe('delete-agent — T437', () => {
  it('agent without history → deleted from DB', async () => {
    const agentId = await insertAgent('agent-no-history')

    const result = await handlers['delete-agent'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; hasHistory: boolean }

    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(false)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE id = ?', [agentId]) as Array<{ id: number }>
    expect(rows).toHaveLength(0)
  })

  it('agent with sessions → hasHistory=true, not deleted', async () => {
    const agentId = await insertAgent('agent-has-session')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO sessions (agent_id, status) VALUES (?, ?)', [agentId, 'completed'])
    })

    const result = await handlers['delete-agent'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; hasHistory: boolean }

    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE id = ?', [agentId]) as Array<{ id: number }>
    expect(rows).toHaveLength(1)
  })

  it('agent with assigned tasks → hasHistory=true, not deleted', async () => {
    const agentId = await insertAgent('agent-has-tasks')
    const taskId = await insertTask('task-assigned')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('UPDATE tasks SET agent_assigned_id = ? WHERE id = ?', [agentId, taskId])
    })

    const result = await handlers['delete-agent'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; hasHistory: boolean }

    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(true)
  })

  it('agent with task_comments → hasHistory=true, not deleted', async () => {
    const agentId = await insertAgent('agent-has-comments')
    const taskId = await insertTask('task-commented')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO task_comments (task_id, agent_id, content) VALUES (?, ?, ?)', [taskId, agentId, 'comment'])
    })

    const result = await handlers['delete-agent'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; hasHistory: boolean }

    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(true)
  })

  it('invalid agentId (float) → {success:false, error}', async () => {
    const result = await handlers['delete-agent'](
      null,
      TEST_DB_PATH,
      1.5
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('delete releases active locks for the agent', async () => {
    const agentId = await insertAgent('agent-with-locks')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO locks (file, agent_id) VALUES (?, ?)', ['some/file.ts', agentId])
    })

    const result = await handlers['delete-agent'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; hasHistory: boolean }

    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(false)

    const locks = await queryLive(
      TEST_DB_PATH,
      'SELECT released_at FROM locks WHERE agent_id = ?',
      [agentId]
    ) as Array<{ released_at: string | null }>
    expect(locks[0]?.released_at).not.toBeNull()
  })
})

// ── Tests: add-perimetre (T438) ───────────────────────────────────────────────

describe('add-perimetre — T438', () => {
  it('valid name → inserted and returns id', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      'front-vuejs'
    ) as { success: boolean; id: number }

    expect(result.success).toBe(true)
    expect(typeof result.id).toBe('number')
    expect(result.id).toBeGreaterThan(0)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT name FROM scopes WHERE id = ?',
      [result.id]
    ) as Array<{ name: string }>
    expect(rows[0]?.name).toBe('front-vuejs')
  })

  it('trims whitespace from name', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      '  back-electron  '
    ) as { success: boolean; id: number }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT name FROM scopes WHERE id = ?',
      [result.id]
    ) as Array<{ name: string }>
    expect(rows[0]?.name).toBe('back-electron')
  })

  it('duplicate name → {success:false, error}', async () => {
    await handlers['add-perimetre'](null, TEST_DB_PATH, 'unique-scope')

    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      'unique-scope'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('unique-scope')
  })

  it('empty name → {success:false, error}', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      '   '
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid perimeter name')
  })

  it('missing name → {success:false, error}', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      ''
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid perimeter name')
  })
})

// ── Tests: update-agent permissionMode (T436) ─────────────────────────────────

describe('update-agent — permissionMode (T436)', () => {
  it('set permissionMode=auto → DB reflects auto', async () => {
    const agentId = await insertAgent('agent-perm-auto')

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { permissionMode: 'auto' }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT permission_mode FROM agents WHERE id = ?',
      [agentId]
    ) as Array<{ permission_mode: string | null }>

    expect(rows[0].permission_mode).toBe('auto')
  })

  it('set permissionMode=default → DB reflects default', async () => {
    const agentId = await insertAgent('agent-perm-default')

    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { permissionMode: 'auto' })

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { permissionMode: 'default' }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT permission_mode FROM agents WHERE id = ?',
      [agentId]
    ) as Array<{ permission_mode: string | null }>

    expect(rows[0].permission_mode).toBe('default')
  })

  it('permissionMode not provided → existing value unchanged', async () => {
    const agentId = await insertAgent('agent-perm-unchanged')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('UPDATE agents SET permission_mode = ? WHERE id = ?', ['auto', agentId])
    })

    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { name: 'agent-perm-unchanged' })

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT permission_mode FROM agents WHERE id = ?',
      [agentId]
    ) as Array<{ permission_mode: string | null }>

    expect(rows[0].permission_mode).toBe('auto')
  })
})

// ── Tests: get-agent-system-prompt returns permissionMode (T436) ──────────────

describe('get-agent-system-prompt — permissionMode (T436)', () => {
  it('returns permissionMode=auto when set', async () => {
    const agentId = await insertAgent('agent-gsp-auto')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('UPDATE agents SET permission_mode = ? WHERE id = ?', ['auto', agentId])
    })

    const result = await handlers['get-agent-system-prompt'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; permissionMode: string | null }

    expect(result.success).toBe(true)
    expect(result.permissionMode).toBe('auto')
  })

  it('returns permissionMode=default when not set to auto', async () => {
    const agentId = await insertAgent('agent-gsp-default')

    const result = await handlers['get-agent-system-prompt'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; permissionMode: string | null }

    expect(result.success).toBe(true)
    expect(['default', null]).toContain(result.permissionMode)
  })

  it('returns permissionMode=null for agent not found', async () => {
    const result = await handlers['get-agent-system-prompt'](
      null,
      TEST_DB_PATH,
      99999
    ) as { success: boolean; permissionMode: string | null }

    expect(result.success).toBe(false)
    expect(result.permissionMode).toBeNull()
  })
})

// ── T475: agent:duplicate ─────────────────────────────────────────────────────
// Uses a real in-memory DB (via dbBuffer) — writeDb succeeds on valid schema.

describe('agent:duplicate handler', () => {
  it('returns { success: false, error: Invalid agentId } for non-integer agentId', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 'abc') as {
      success: boolean; error?: string
    }
    expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
  })

  it('returns { success: false, error: Invalid agentId } for float agentId', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 1.5) as {
      success: boolean; error?: string
    }
    expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
  })

  it('returns { success: false, error } when agentId does not exist', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 99999) as {
      success: boolean; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Agent not found')
  })

  it('returns { success: true, agentId, name: "<name>-copy" } for valid agent', async () => {
    const agentId = await insertAgent('myagent')
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; agentId?: number; name?: string
    }
    expect(result.success).toBe(true)
    expect(result.name).toBe('myagent-copy')
    expect(typeof result.agentId).toBe('number')
  })

  it('generates unique name "<name>-copy-2" when "<name>-copy" already exists', async () => {
    const agentId = await insertAgent('dupe-agent')
    // First duplicate → dupe-agent-copy
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)
    // Second duplicate → dupe-agent-copy-2
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; name?: string
    }
    expect(result.success).toBe(true)
    expect(result.name).toBe('dupe-agent-copy-2')
  })

  it('generates "<name>-copy-3" on third duplication', async () => {
    const agentId = await insertAgent('triple-agent')
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; name?: string
    }
    expect(result.success).toBe(true)
    expect(result.name).toBe('triple-agent-copy-3')
  })

  it('copies all fields: name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools', async () => {
    // Insert agent with all fields populated
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        'INSERT INTO agents (name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['full-agent', 'dev', 'back-electron', 'auto', 'You are dev', 'Always respond in english', '["Bash","Read"]']
      )
    })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE name = ?', ['full-agent']) as Array<{ id: number }>
    const agentId = rows[0].id

    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; agentId?: number; name?: string
    }
    expect(result.success).toBe(true)

    // Verify copied fields in DB
    const copied = await queryLive(TEST_DB_PATH, 'SELECT * FROM agents WHERE id = ?', [result.agentId]) as Array<Record<string, unknown>>
    expect(copied[0].type).toBe('dev')
    expect(copied[0].scope).toBe('back-electron')
    expect(copied[0].thinking_mode).toBe('auto')
    expect(copied[0].system_prompt).toBe('You are dev')
    expect(copied[0].system_prompt_suffix).toBe('Always respond in english')
    expect(copied[0].allowed_tools).toBe('["Bash","Read"]')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent:duplicate'](null, '/unregistered/evil.db', 1) as {
      success: boolean; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('duplicate creates a new row in agents table', async () => {
    const agentId = await insertAgent('count-agent')
    const beforeRows = await queryLive(TEST_DB_PATH, 'SELECT COUNT(*) as n FROM agents', []) as Array<{ n: number }>
    const before = Number(beforeRows[0].n)

    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)

    const afterRows = await queryLive(TEST_DB_PATH, 'SELECT COUNT(*) as n FROM agents', []) as Array<{ n: number }>
    expect(Number(afterRows[0].n)).toBe(before + 1)
  })
})

// ── Tests: agent-groups handlers (T580) ──────────────────────────────────────

async function insertGroup(name: string): Promise<number> {
  const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, name) as { success: boolean; group?: { id: number } }
  if (!result.success || !result.group) throw new Error(`Failed to create group '${name}'`)
  return result.group.id
}

describe('agent-groups:list', () => {
  it('returns { success: true, groups: [] } for empty DB', async () => {
    const result = await handlers['agent-groups:list'](null, TEST_DB_PATH) as { success: boolean; groups: unknown[] }
    expect(result.success).toBe(true)
    expect(result.groups).toEqual([])
  })

  it('returns groups with members after create + setMember', async () => {
    const agentId = await insertAgent('member-agent')
    const groupId = await insertGroup('Team Alpha')
    await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 0)

    const result = await handlers['agent-groups:list'](null, TEST_DB_PATH) as {
      success: boolean; groups: Array<{ id: number; name: string; members: Array<{ agent_id: number }> }>
    }
    expect(result.success).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].name).toBe('Team Alpha')
    expect(result.groups[0].members).toHaveLength(1)
    expect(result.groups[0].members[0].agent_id).toBe(agentId)
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:list'](null, '/evil/unregistered.db') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

describe('agent-groups:create', () => {
  it('creates a group and returns { success: true, group: { id, name, sort_order, created_at } }', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, 'My Group') as {
      success: boolean; group?: { id: number; name: string; sort_order: number; created_at: string }
    }
    expect(result.success).toBe(true)
    expect(result.group).toBeDefined()
    expect(result.group!.name).toBe('My Group')
    expect(typeof result.group!.id).toBe('number')
    expect(typeof result.group!.sort_order).toBe('number')
    expect(typeof result.group!.created_at).toBe('string')
  })

  it('returns { success: false, error: "Invalid group name" } for empty name', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: "Invalid group name" } for whitespace-only name', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, '   ') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: "Invalid group name" } for non-string name', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, 42 as unknown as string) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:create'](null, '/evil/db.db', 'G') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('allows duplicate names (no UNIQUE constraint on agent_groups.name)', async () => {
    await handlers['agent-groups:create'](null, TEST_DB_PATH, 'DupeGroup')
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, 'DupeGroup') as { success: boolean; group?: { id: number } }
    // Schema has no UNIQUE on name — duplicates are allowed, two distinct rows inserted
    expect(result.success).toBe(true)
    expect(result.group).toBeDefined()

    const rows = await queryLive(TEST_DB_PATH, "SELECT id FROM agent_groups WHERE name = 'DupeGroup'", []) as unknown[]
    expect(rows).toHaveLength(2)
  })
})

describe('agent-groups:rename', () => {
  it('renames a group successfully → { success: true }', async () => {
    const groupId = await insertGroup('OldName')
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, groupId, 'NewName') as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT name FROM agent_groups WHERE id = ?', [groupId]) as Array<{ name: string }>
    expect(rows[0].name).toBe('NewName')
  })

  it('returns { success: false, error: "Invalid groupId" } for float groupId', async () => {
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, 1.5, 'X') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: "Invalid groupId" } for string groupId', async () => {
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, 'abc' as unknown as number, 'X') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: "Invalid group name" } for empty name', async () => {
    const groupId = await insertGroup('ValidGroup')
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, groupId, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:rename'](null, '/evil/db.db', 1, 'X') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

describe('agent-groups:delete', () => {
  it('deletes a group successfully → { success: true }', async () => {
    const groupId = await insertGroup('ToDelete')
    const result = await handlers['agent-groups:delete'](null, TEST_DB_PATH, groupId) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agent_groups WHERE id = ?', [groupId]) as unknown[]
    expect(rows).toHaveLength(0)
  })

  it('also deletes members when group is deleted', async () => {
    const agentId = await insertAgent('member-to-remove')
    const groupId = await insertGroup('GroupWithMember')
    await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 0)

    await handlers['agent-groups:delete'](null, TEST_DB_PATH, groupId)

    const members = await queryLive(TEST_DB_PATH, 'SELECT id FROM agent_group_members WHERE group_id = ?', [groupId]) as unknown[]
    expect(members).toHaveLength(0)
  })

  it('returns { success: false, error: "Invalid groupId" } for float groupId', async () => {
    const result = await handlers['agent-groups:delete'](null, TEST_DB_PATH, 2.7) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: "Invalid groupId" } for string groupId', async () => {
    const result = await handlers['agent-groups:delete'](null, TEST_DB_PATH, 'bad' as unknown as number) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:delete'](null, '/evil/db.db', 1) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

describe('agent-groups:setMember', () => {
  it('assigns agent to group → { success: true } and row exists in agent_group_members', async () => {
    const agentId = await insertAgent('set-member-agent')
    const groupId = await insertGroup('SetMemberGroup')

    const result = await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 0) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT group_id FROM agent_group_members WHERE agent_id = ?', [agentId]) as Array<{ group_id: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0].group_id).toBe(groupId)
  })

  it('setMember twice same agent/group → only 1 row (idempotent)', async () => {
    const agentId = await insertAgent('idempotent-agent')
    const groupId = await insertGroup('IdempotentGroup')

    await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 0)
    await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 1)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agent_group_members WHERE agent_id = ?', [agentId]) as unknown[]
    expect(rows).toHaveLength(1)
  })

  it('groupId = null removes agent from all groups', async () => {
    const agentId = await insertAgent('remove-from-group-agent')
    const groupId = await insertGroup('RemoveGroup')
    await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 0)

    const result = await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, null) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agent_group_members WHERE agent_id = ?', [agentId]) as unknown[]
    expect(rows).toHaveLength(0)
  })

  it('returns { success: false, error: "Invalid agentId" } for float agentId', async () => {
    const result = await handlers['agent-groups:setMember'](null, TEST_DB_PATH, 1.5, null) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid agentId')
  })

  it('returns { success: false, error: "Invalid groupId" } for non-null non-integer groupId', async () => {
    const agentId = await insertAgent('bad-group-agent')
    const result = await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, 'bad' as unknown as number) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:setMember'](null, '/evil/db.db', 1, null) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

describe('agent-groups:reorder', () => {
  it('reorders groups → sort_order updated in DB', async () => {
    const g1 = await insertGroup('Reorder-A')
    const g2 = await insertGroup('Reorder-B')
    const g3 = await insertGroup('Reorder-C')

    // Reverse order: [g3, g1, g2]
    const result = await handlers['agent-groups:reorder'](null, TEST_DB_PATH, [g3, g1, g2]) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id, sort_order FROM agent_groups ORDER BY sort_order', []) as Array<{ id: number; sort_order: number }>
    expect(rows[0].id).toBe(g3)
    expect(rows[1].id).toBe(g1)
    expect(rows[2].id).toBe(g2)
  })

  it('empty array → { success: true } (nothing to do)', async () => {
    const result = await handlers['agent-groups:reorder'](null, TEST_DB_PATH, []) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('returns { success: false, error } for non-array input', async () => {
    const result = await handlers['agent-groups:reorder'](null, TEST_DB_PATH, 'not-array' as unknown as number[]) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('groupIds must be an array of integers')
  })

  it('returns { success: false, error } for array with non-integer values', async () => {
    const result = await handlers['agent-groups:reorder'](null, TEST_DB_PATH, [1, 2.5, 3]) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('groupIds must be an array of integers')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:reorder'](null, '/evil/db.db', [1]) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: session token handlers (T581) ─────────────────────────────────────

const VALID_CONV_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

// Helper JSONL with 2 finalized assistant messages
const VALID_JSONL = [
  JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } }),
  JSON.stringify({ type: 'assistant', message: { stop_reason: null, usage: { input_tokens: 99, output_tokens: 1 } } }), // streaming start — should be skipped
  JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 20 } } }),
  'not-valid-json-line', // malformed — should be skipped
].join('\n')

async function insertSession(agentId: number, convId?: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO sessions (agent_id, status, claude_conv_id) VALUES (?, ?, ?)', [agentId, 'completed', convId ?? null])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [agentId]) as Array<{ id: number }>
  return rows[0].id
}

describe('session:parseTokens (T581)', () => {
  it('returns DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    const result = await handlers['session:parseTokens'](null, '/evil/db.db', VALID_CONV_ID) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: false } for empty convId', async () => {
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns { success: false, error: "Invalid convId format" } for non-UUID convId', async () => {
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, 'not-a-uuid') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid convId format')
  })

  it('parses valid JSONL and returns summed token counts', async () => {
    const agentId = await insertAgent('parse-tokens-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = VALID_JSONL

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_CONV_ID, '/mnt/c/project') as {
      success: boolean; tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number
    }
    expect(result.success).toBe(true)
    // streaming start (stop_reason=null) skipped → only 2 finalized messages counted
    expect(result.tokensIn).toBe(300)   // 100 + 200
    expect(result.tokensOut).toBe(130)  // 50 + 80
    expect(result.cacheRead).toBe(10)   // 10 + 0
    expect(result.cacheWrite).toBe(25)  // 5 + 20
  })

  it('returns { success: false } when JSONL file not found', async () => {
    jsonlMockContent = null // readline mock will emit ENOENT
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_CONV_ID, '/mnt/c/project') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })

  it('ignores malformed JSON lines without crashing', async () => {
    const jsonlWithGarbage = 'garbage-line\n' + JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } })
    const agentId = await insertAgent('malformed-jsonl-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = jsonlWithGarbage

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_CONV_ID, '/mnt/c/project') as { success: boolean; tokensIn?: number }
    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(10)
  })
})

describe('session:syncAllTokens (T581)', () => {
  it('returns DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    const result = await handlers['session:syncAllTokens'](null, '/evil/db.db') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: true, updated: 0 } when no sessions have convId', async () => {
    const agentId = await insertAgent('sync-no-conv-agent')
    await insertSession(agentId) // no convId

    const result = await handlers['session:syncAllTokens'](null, TEST_DB_PATH, '/mnt/c/project') as { success: boolean; updated: number }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
  })

  it('updates sessions with convId and nonzero tokens, returns updated count', async () => {
    const agentId = await insertAgent('sync-tokens-agent')
    const sessionId = await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = VALID_JSONL

    const result = await handlers['session:syncAllTokens'](null, TEST_DB_PATH, '/mnt/c/project') as { success: boolean; updated: number; errors: string[] }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)
    expect(result.errors).toHaveLength(0)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT tokens_in FROM sessions WHERE id = ?', [sessionId]) as Array<{ tokens_in: number }>
    expect(rows[0].tokens_in).toBe(300)
  })

  it('skips sessions where JSONL file is missing (error captured, not thrown)', async () => {
    const agentId = await insertAgent('sync-missing-jsonl-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = null // readline mock will emit ENOENT

    const result = await handlers['session:syncAllTokens'](null, TEST_DB_PATH, '/mnt/c/project') as { success: boolean; updated: number; errors: string[] }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('ENOENT')
  })
})

describe('session:collectTokens (T581)', () => {
  it('returns DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    const result = await handlers['session:collectTokens'](null, '/evil/db.db', 'myagent') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: false } for empty agentName', async () => {
    const result = await handlers['session:collectTokens'](null, TEST_DB_PATH, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns { success: true, tokens: null } when agent has no sessions with convId', async () => {
    await insertAgent('collect-no-session-agent')
    const result = await handlers['session:collectTokens'](null, TEST_DB_PATH, 'collect-no-session-agent') as { success: boolean; tokens: unknown }
    expect(result.success).toBe(true)
    expect(result.tokens).toBeNull()
  })

  it('returns aggregated tokens for agent with convId session', async () => {
    const agentId = await insertAgent('collect-tokens-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = VALID_JSONL

    const result = await handlers['session:collectTokens'](null, TEST_DB_PATH, 'collect-tokens-agent') as {
      success: boolean; tokens: { tokensIn: number; tokensOut: number } | null
    }
    expect(result.success).toBe(true)
    expect(result.tokens).not.toBeNull()
    expect(result.tokens!.tokensIn).toBe(300)
    expect(result.tokens!.tokensOut).toBe(130)
  })
})

// ── task:getLinks (T673) ──────────────────────────────────────────────────────

describe('task:getLinks (T673)', () => {
  it('returns Invalid taskId for float taskId', async () => {
    const result = await handlers['task:getLinks'](null, TEST_DB_PATH, 1.5) as {
      success: boolean; links: unknown[]; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.links).toEqual([])
    expect(result.error).toBe('Invalid taskId')
  })

  it('returns Invalid taskId for string taskId', async () => {
    const result = await handlers['task:getLinks'](null, TEST_DB_PATH, 'abc') as {
      success: boolean; links: unknown[]; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.links).toEqual([])
    expect(result.error).toBe('Invalid taskId')
  })

  it('throws DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    await expect(handlers['task:getLinks'](null, '/evil/db.db', 1)).rejects.toThrow('DB_PATH_NOT_ALLOWED')
  })

  it('returns empty links array for task with no links', async () => {
    const taskId = await insertTask('isolated-task')
    const result = await handlers['task:getLinks'](null, TEST_DB_PATH, taskId) as {
      success: boolean; links: unknown[]
    }
    expect(result.success).toBe(true)
    expect(result.links).toEqual([])
  })

  it('returns link with from_title/from_status/to_title/to_status when task is from_task', async () => {
    const fromId = await insertTask('task-from')
    const toId = await insertTask('task-to')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        "INSERT INTO task_links (from_task, to_task, type) VALUES (?, ?, 'blocks')",
        [fromId, toId]
      )
    })

    const result = await handlers['task:getLinks'](null, TEST_DB_PATH, fromId) as {
      success: boolean; links: Array<{
        from_task: number; to_task: number; type: string;
        from_title: string; from_status: string;
        to_title: string; to_status: string
      }>
    }
    expect(result.success).toBe(true)
    expect(result.links).toHaveLength(1)
    const link = result.links[0]
    expect(link.from_task).toBe(fromId)
    expect(link.to_task).toBe(toId)
    expect(link.type).toBe('blocks')
    expect(link.from_title).toBe('task-from')
    expect(link.to_title).toBe('task-to')
    expect(link.from_status).toBe('todo')
    expect(link.to_status).toBe('todo')
  })

  it('returns symmetric link when task is to_task', async () => {
    const fromId = await insertTask('task-source')
    const toId = await insertTask('task-target')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        "INSERT INTO task_links (from_task, to_task, type) VALUES (?, ?, 'depends_on')",
        [fromId, toId]
      )
    })

    const result = await handlers['task:getLinks'](null, TEST_DB_PATH, toId) as {
      success: boolean; links: Array<{ from_task: number; to_task: number; type: string }>
    }
    expect(result.success).toBe(true)
    expect(result.links).toHaveLength(1)
    expect(result.links[0].from_task).toBe(fromId)
    expect(result.links[0].to_task).toBe(toId)
  })

  it('returns all links when task has multiple links', async () => {
    const mainId = await insertTask('task-main')
    const dep1 = await insertTask('dep-1')
    const dep2 = await insertTask('dep-2')
    const dep3 = await insertTask('dep-3')

    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO task_links (from_task, to_task, type) VALUES (?, ?, 'blocks')", [mainId, dep1])
      db.run("INSERT INTO task_links (from_task, to_task, type) VALUES (?, ?, 'blocks')", [mainId, dep2])
      db.run("INSERT INTO task_links (from_task, to_task, type) VALUES (?, ?, 'related_to')", [dep3, mainId])
    })

    const result = await handlers['task:getLinks'](null, TEST_DB_PATH, mainId) as {
      success: boolean; links: unknown[]
    }
    expect(result.success).toBe(true)
    expect(result.links).toHaveLength(3)
  })
})
