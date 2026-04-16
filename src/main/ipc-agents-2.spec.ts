/**
 * IPC agent handler tests — File 2 of 6
 * Covers: task:setAssignees validation guards, update-agent maxSessions (T468),
 *         task:getAssignees validation guards, delete-agent (T437)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000
let jsonlMockContent: string | Error | null = null

const { readFileMockImpl } = vi.hoisted(() => ({ readFileMockImpl: vi.fn() }))

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

import { registerDbPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'
import { buildSchema, TEST_DB_PATH, insertAgent, insertTask } from './ipc-agents-test-setup'

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

// ── Tests: task:setAssignees validation guards ────────────────────────────────

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

// ── Tests: update-agent maxSessions (T468) ────────────────────────────────────

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

// ── Tests: task:getAssignees validation guards ────────────────────────────────

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

})
