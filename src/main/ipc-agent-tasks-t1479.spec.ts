/**
 * Integration tests — ipc-agent-tasks.ts handlers — T1479
 *
 * Directly exercises registerAgentTaskHandlers() for:
 * - close-agent-sessions: valid agentName, invalid agentName (empty), empty string
 * - task:setAssignees: valid assignment, invalid taskId, invalid agentName
 * - update-perimetre: valid payloads, cascade rename, constraint violations
 * - add-perimetre: valid creation, duplicate name error
 * - build-agent-prompt: fallback when no dbPath/agentId, session creation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000

// ── Mock fs/promises ──────────────────────────────────────────────────────────
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: vi.fn(async () => dbBuffer),
    writeFile: vi.fn(async (_path: string, data: Buffer) => { dbBuffer = data; dbMtime += 1 }),
    rename: vi.fn(async () => undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
  readFile: vi.fn(async () => dbBuffer),
  writeFile: vi.fn(async (_path: string, data: Buffer) => { dbBuffer = data; dbMtime += 1 }),
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock fs (sync) ────────────────────────────────────────────────────────────
vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  const readdirSync = vi.fn(() => [] as string[])
  const createReadStream = vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() }))
  return {
    default: { watch, existsSync, readdirSync, createReadStream },
    watch, existsSync, readdirSync, createReadStream,
  }
})

// ── Mock readline ─────────────────────────────────────────────────────────────
vi.mock('readline', async () => {
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()
    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => { rl.emit('error', new Error('ENOENT: no such file')) })
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
  app: { getVersion: vi.fn(() => '0.5.0'), isPackaged: false, getAppPath: vi.fn(() => '/app') },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined), showItemInFolder: vi.fn() },
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

vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { registerDbPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentTaskHandlers } from './ipc-agent-tasks'
import { buildSchema, insertAgent, insertTask, TEST_DB_PATH } from './test-utils/ipc-test-setup'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000
  dbBuffer = Buffer.alloc(0)

  await buildSchema()
  registerDbPath(TEST_DB_PATH)
  registerAgentTaskHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── close-agent-sessions ──────────────────────────────────────────────────────

describe('close-agent-sessions (T1479)', () => {
  it('valid agentName → started sessions set to completed', async () => {
    const agentId = await insertAgent('sessions-to-close')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentId])
    })

    const result = await handlers['close-agent-sessions'](null, TEST_DB_PATH, 'sessions-to-close') as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ?', [agentId]) as Array<{ status: string }>
    expect(rows[0].status).toBe('completed')
  })

  it('only closes sessions for the named agent', async () => {
    const agentA = await insertAgent('close-sessions-a')
    const agentB = await insertAgent('close-sessions-b')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentA])
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentB])
    })

    await handlers['close-agent-sessions'](null, TEST_DB_PATH, 'close-sessions-a')

    const rowsA = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ?', [agentA]) as Array<{ status: string }>
    const rowsB = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ?', [agentB]) as Array<{ status: string }>
    expect(rowsA[0].status).toBe('completed')
    expect(rowsB[0].status).toBe('started')
  })

  it('invalid agentName: empty string → success: false', async () => {
    const result = await handlers['close-agent-sessions'](null, TEST_DB_PATH, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentName')
  })

  it('unauthorized dbPath → success: false', async () => {
    const result = await handlers['close-agent-sessions'](null, '/evil/db.db', 'agent') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── task:setAssignees ─────────────────────────────────────────────────────────

describe('task:setAssignees (T1479)', () => {
  it('valid assignment with role → persisted in task_agents', async () => {
    const agentId = await insertAgent('assignee-agent')
    const taskId = await insertTask('assignee-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: 'primary' }]
    ) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT agent_id, role FROM task_agents WHERE task_id = ?', [taskId]) as Array<{ agent_id: number; role: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].agent_id).toBe(agentId)
    expect(rows[0].role).toBe('primary')
  })

  it('invalid taskId (float) → success: false', async () => {
    const result = await handlers['task:setAssignees'](null, TEST_DB_PATH, 1.5, []) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid taskId')
  })

  it('invalid taskId (string) → success: false', async () => {
    const result = await handlers['task:setAssignees'](null, TEST_DB_PATH, 'abc' as unknown as number, []) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid taskId')
  })

  it('invalid role → success: false', async () => {
    const agentId = await insertAgent('bad-role-agent')
    const taskId = await insertTask('bad-role-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: 'owner' as 'primary' }]
    ) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid role')
  })

  it('primary agent wins over first for agent_assigned_id', async () => {
    const first = await insertAgent('first-agent')
    const primary = await insertAgent('primary-agent')
    const taskId = await insertTask('primary-wins-task')

    await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId,
      [{ agentId: first, role: 'support' }, { agentId: primary, role: 'primary' }]
    )

    const rows = await queryLive(TEST_DB_PATH, 'SELECT agent_assigned_id FROM tasks WHERE id = ?', [taskId]) as Array<{ agent_assigned_id: number }>
    expect(rows[0].agent_assigned_id).toBe(primary)
  })

  it('empty assignees → agent_assigned_id set to NULL', async () => {
    const agentId = await insertAgent('clear-agent')
    const taskId = await insertTask('clear-task')

    await handlers['task:setAssignees'](null, TEST_DB_PATH, taskId, [{ agentId, role: 'primary' }])
    await handlers['task:setAssignees'](null, TEST_DB_PATH, taskId, [])

    const rows = await queryLive(TEST_DB_PATH, 'SELECT agent_assigned_id FROM tasks WHERE id = ?', [taskId]) as Array<{ agent_assigned_id: number | null }>
    expect(rows[0].agent_assigned_id).toBeNull()
  })
})

// ── add-perimetre ─────────────────────────────────────────────────────────────

describe('add-perimetre (T1479)', () => {
  it('valid name → success: true, id returned', async () => {
    const result = await handlers['add-perimetre'](null, TEST_DB_PATH, 'my-scope') as { success: boolean; id: number }
    expect(result.success).toBe(true)
    expect(typeof result.id).toBe('number')
  })

  it('duplicate name → success: false, error contains name', async () => {
    await handlers['add-perimetre'](null, TEST_DB_PATH, 'dup-scope')
    const result = await handlers['add-perimetre'](null, TEST_DB_PATH, 'dup-scope') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('dup-scope')
  })

  it('invalid name (empty) → success: false', async () => {
    const result = await handlers['add-perimetre'](null, TEST_DB_PATH, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })
})

// ── update-perimetre ──────────────────────────────────────────────────────────

describe('update-perimetre (T1479)', () => {
  it('valid rename → scope table updated, tasks cascade renamed', async () => {
    const { id: scopeId } = await handlers['add-perimetre'](null, TEST_DB_PATH, 'old-scope') as { id: number }
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO tasks (title, scope) VALUES ('task-in-scope', 'old-scope')")
    })

    await handlers['update-perimetre'](null, TEST_DB_PATH, scopeId, 'old-scope', 'new-scope', 'desc')

    const tasks = await queryLive(TEST_DB_PATH, "SELECT scope FROM tasks WHERE title = 'task-in-scope'", []) as Array<{ scope: string }>
    expect(tasks[0].scope).toBe('new-scope')
  })

  it('same name → no cascade, description updated', async () => {
    const { id: scopeId } = await handlers['add-perimetre'](null, TEST_DB_PATH, 'stable-scope') as { id: number }
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO tasks (title, scope) VALUES ('stable-task', 'stable-scope')")
    })

    await handlers['update-perimetre'](null, TEST_DB_PATH, scopeId, 'stable-scope', 'stable-scope', 'new desc')

    const tasks = await queryLive(TEST_DB_PATH, "SELECT scope FROM tasks WHERE title = 'stable-task'", []) as Array<{ scope: string }>
    expect(tasks[0].scope).toBe('stable-scope')
  })

  it('invalid id (float) → success: false', async () => {
    const result = await handlers['update-perimetre'](null, TEST_DB_PATH, 1.5, 'old', 'new', '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid id')
  })

  it('invalid newName (empty) → success: false', async () => {
    const result = await handlers['update-perimetre'](null, TEST_DB_PATH, 1, 'old', '', '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid newName')
  })

  it('unauthorized dbPath → success: false', async () => {
    const result = await handlers['update-perimetre'](null, '/evil/db.db', 1, 'old', 'new', '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── build-agent-prompt ────────────────────────────────────────────────────────

describe('build-agent-prompt (T1479)', () => {
  it('returns userPrompt as-is when dbPath is not provided', async () => {
    const result = await handlers['build-agent-prompt'](null, 'agent', 'T123') as string
    expect(result).toBe('T123')
  })

  it('returns userPrompt as-is when agentId is not provided', async () => {
    const result = await handlers['build-agent-prompt'](null, 'agent', 'T456', TEST_DB_PATH, undefined) as string
    expect(result).toBe('T456')
  })

  it('creates context block with required sections for valid agent', async () => {
    const agentId = await insertAgent('prompt-build-agent', { type: 'dev', scope: 'back' })

    const result = await handlers['build-agent-prompt'](null, 'prompt-build-agent', 'T1', TEST_DB_PATH, agentId) as string
    expect(result).toContain('=== IDENTIFIANTS ===')
    expect(result).toContain('=== SESSION PRÉCÉDENTE ===')
    expect(result).toContain('=== TÂCHES ASSIGNÉES ===')
  })

  it('creates a new session row in DB', async () => {
    const agentId = await insertAgent('session-create-agent')
    const before = await queryLive(TEST_DB_PATH, 'SELECT COUNT(*) as cnt FROM sessions', []) as Array<{ cnt: number }>

    await handlers['build-agent-prompt'](null, 'session-create-agent', '', TEST_DB_PATH, agentId)

    const after = await queryLive(TEST_DB_PATH, 'SELECT COUNT(*) as cnt FROM sessions', []) as Array<{ cnt: number }>
    expect(after[0].cnt).toBe(before[0].cnt + 1)
  })

  it('prefixes context block with --- separator when userPrompt is non-empty', async () => {
    const agentId = await insertAgent('separator-agent')
    const result = await handlers['build-agent-prompt'](null, 'separator-agent', 'T99', TEST_DB_PATH, agentId) as string
    expect(result).toContain('---')
    expect(result.indexOf('=== IDENTIFIANTS ===')).toBeLessThan(result.indexOf('T99'))
  })

  it('returns base prompt when agent not found (contextBlock is null)', async () => {
    const result = await handlers['build-agent-prompt'](null, 'x', 'fallback', TEST_DB_PATH, 99999) as string
    expect(result).toBe('fallback')
  })
})
