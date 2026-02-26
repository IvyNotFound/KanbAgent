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
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: vi.fn(async () => dbBuffer),
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
  readFile: vi.fn(async () => dbBuffer),
  writeFile: vi.fn(async (_path: string, data: Buffer) => {
    dbBuffer = data
    dbMtime += 1
  }),
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

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

// ── Schema builder ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildSchema(): Promise<any> {
  const sqlJs = await getSqlJs()
  const db = new sqlJs.Database()

  db.run(`CREATE TABLE agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT,
    perimetre TEXT,
    system_prompt TEXT,
    system_prompt_suffix TEXT,
    thinking_mode TEXT,
    allowed_tools TEXT,
    auto_launch INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT,
    description TEXT,
    statut TEXT DEFAULT 'todo',
    agent_createur_id INTEGER,
    agent_assigne_id INTEGER,
    agent_valideur_id INTEGER,
    parent_task_id INTEGER,
    session_id INTEGER,
    perimetre TEXT,
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
    statut TEXT,
    summary TEXT,
    claude_conv_id TEXT
  )`)

  db.run(`CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    agent_id INTEGER,
    contenu TEXT,
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
    fichier TEXT,
    agent_id INTEGER,
    session_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    released_at TEXT
  )`)

  db.run(`CREATE TABLE agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    agent_id INTEGER,
    niveau TEXT,
    action TEXT,
    detail TEXT,
    fichiers TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )`)

  db.run(`CREATE TABLE perimetres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    dossier TEXT,
    techno TEXT,
    description TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
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

  return db
}

const TEST_DB_PATH = '/test/ipc-agents-test.db'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

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

async function insertTask(titre: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO tasks (titre) VALUES (?)', [titre])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM tasks WHERE titre = ?', [titre]) as Array<{ id: number }>
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
    'SELECT agent_assigne_id FROM tasks WHERE id = ?',
    [taskId]
  ) as Array<{ agent_assigne_id: number | null }>
  return rows[0]?.agent_assigne_id ?? null
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

  it('role=primary → tasks.agent_assigne_id = primary agent_id', async () => {
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

  it('no primary → tasks.agent_assigne_id = first assignee', async () => {
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

  it('empty list → task_agents empty + agent_assigne_id = NULL', async () => {
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
