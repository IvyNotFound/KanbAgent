/**
 * Behavioural tests for task:setAssignees / task:getAssignees IPC handlers (T418)
 *
 * Strategy: real sql.js Database in memory, fs/promises mocked to read/write
 * from a Buffer variable so writeDb operates on the actual in-memory schema.
 *
 * Framework: Vitest (node environment)
 * File 1 of 6: task:setAssignees behavioural + task:getAssignees behavioural
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000

// ── Mock fs/promises ─────────────────────────────────────────────────────────
let jsonlMockContent: string | Error | null = null

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
    rename: vi.fn(async (src: string) => { void src }),
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

// ── Mock readline ─────────────────────────────────────────────────────────────
vi.mock('readline', async () => {
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()
    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => {
      if (jsonlMockContent instanceof Error) { rl.emit('error', jsonlMockContent); return }
      if (jsonlMockContent === null) { rl.emit('error', new Error('ENOENT: no such file')); return }
      for (const line of jsonlMockContent.split('\n')) { rl.emit('line', line) }
      rl.emit('close')
    })
    return rl
  })
  return { createInterface, default: { createInterface } }
})

// ── Mock electron ─────────────────────────────────────────────────────────────
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

vi.mock('./claude-md', () => ({
  insertAgentIntoClaudeMd: vi.fn((content: string) => content),
}))

vi.mock('./db-lock', () => ({
  acquireWriteLock: vi.fn().mockResolvedValue('/mock.wlock'),
  releaseWriteLock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('better-sqlite3', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    default: function MockDatabase() { return new (mod as any).default(':memory:') },
  }
})

// ── Import after mocks ────────────────────────────────────────────────────────
import { registerDbPath, clearDbCacheEntry, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'
import {
  buildSchema,
  TEST_DB_PATH,
  insertAgent,
  insertTask,
  getTaskAgents,
  getTaskAssigneId,
} from './ipc-agents-test-setup'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  jsonlMockContent = null
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  readFileMockImpl.mockImplementation(async (path: string) => {
    if (typeof path === 'string' && path.endsWith('.jsonl')) {
      if (jsonlMockContent instanceof Error) throw jsonlMockContent
      if (jsonlMockContent !== null) return jsonlMockContent
      throw new Error('ENOENT: no such file')
    }
    return dbBuffer
  })

  registerDbPath(TEST_DB_PATH)
  await buildSchema()
  registerAgentHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

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
