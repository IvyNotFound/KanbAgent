/**
 * Mutation-killing tests for ipc-agent-tasks.ts — T1268
 *
 * Targets survived mutants:
 * - close-agent-sessions: status='completed' (StringLiteral), status='started' filter (StringLiteral)
 * - build-agent-prompt: userPrompt.trim(), !dbPath || !agentId (LogicalOperator),
 *   contextBlock null check, agent type/scope format strings '-'
 * - task:setAssignees: role validation set, primary/first agent_assigned_id logic
 * - update-perimetre: oldName !== newName condition, cascade rename tasks + agents
 * - add-perimetre: UNIQUE constraint error message with quotes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000

// ── Mock fs/promises ─────────────────────────────────────────────────────────
const { readFileMockImpl } = vi.hoisted(() => ({ readFileMockImpl: vi.fn() }))

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: readFileMockImpl,
    writeFile: vi.fn(async (_path: string, data: Buffer) => {
      dbBuffer = data
      dbMtime += 1
    }),
    rename: vi.fn(async () => undefined),
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

vi.mock('./claude-md', () => ({ insertAgentIntoClaudeMd: vi.fn((c: string) => c) }))

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
import { registerDbPath, registerProjectPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'
import {
  buildSchema,
  insertAgent,
  insertTask,
  TEST_DB_PATH,
} from './ipc-agents-test-setup'

const TEST_PROJECT_PATH = '/test/project'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  readFileMockImpl.mockImplementation(async (path: string) => {
    if (typeof path === 'string' && path.endsWith('.jsonl')) throw new Error('ENOENT')
    if (typeof path === 'string' && path.endsWith('.md')) return '# CLAUDE.md\n'
    return dbBuffer
  })

  await buildSchema()
  registerDbPath(TEST_DB_PATH)
  registerProjectPath(TEST_PROJECT_PATH)
  registerAgentHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── close-agent-sessions: status string values ────────────────────────────────

describe('update-perimetre — cascade rename condition (T1268)', () => {
  it('cascade rename: tasks with oldName scope get new scope (newName !== oldName)', async () => {
    // Create a scope
    const scopeResult = await handlers['add-perimetre'](null, TEST_DB_PATH, 'scope-to-rename') as { success: boolean; id: number }
    expect(scopeResult.success).toBe(true)
    const scopeId = scopeResult.id

    // Create tasks with that scope
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO tasks (title, scope) VALUES ('task-in-scope', 'scope-to-rename')")
    })

    // Rename the scope
    await handlers['update-perimetre'](null, TEST_DB_PATH, scopeId, 'scope-to-rename', 'scope-renamed', null as unknown as string)

    const tasks = await queryLive(TEST_DB_PATH, "SELECT scope FROM tasks WHERE title = 'task-in-scope'", []) as Array<{ scope: string }>
    expect(tasks[0].scope).toBe('scope-renamed')
  })

  it('cascade rename: agents with oldName scope get new scope', async () => {
    const scopeResult = await handlers['add-perimetre'](null, TEST_DB_PATH, 'agent-scope-rename') as { success: boolean; id: number }
    const scopeId = scopeResult.id

    const agentId = await insertAgent('agent-in-scope')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("UPDATE agents SET scope = 'agent-scope-rename' WHERE id = ?", [agentId])
    })

    await handlers['update-perimetre'](null, TEST_DB_PATH, scopeId, 'agent-scope-rename', 'agent-scope-renamed', null as unknown as string)

    const agents = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [agentId]) as Array<{ scope: string }>
    expect(agents[0].scope).toBe('agent-scope-renamed')
  })

  it('NO cascade when newName === oldName (condition: newName !== oldName)', async () => {
    const scopeResult = await handlers['add-perimetre'](null, TEST_DB_PATH, 'same-name-scope') as { success: boolean; id: number }
    const scopeId = scopeResult.id

    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO tasks (title, scope) VALUES ('task-same-scope', 'same-name-scope')")
    })

    // Update with same name → description changes but no cascade
    await handlers['update-perimetre'](null, TEST_DB_PATH, scopeId, 'same-name-scope', 'same-name-scope', 'New description')

    // Scope name should still be 'same-name-scope' (not changed)
    const tasks = await queryLive(TEST_DB_PATH, "SELECT scope FROM tasks WHERE title = 'task-same-scope'", []) as Array<{ scope: string }>
    expect(tasks[0].scope).toBe('same-name-scope')
  })

  it('description stored as NULL when empty string passed', async () => {
    const scopeResult = await handlers['add-perimetre'](null, TEST_DB_PATH, 'scope-empty-desc') as { success: boolean; id: number }
    const scopeId = scopeResult.id

    await handlers['update-perimetre'](null, TEST_DB_PATH, scopeId, 'scope-empty-desc', 'scope-empty-desc', '')

    const rows = await queryLive(TEST_DB_PATH, 'SELECT description FROM scopes WHERE id = ?', [scopeId]) as Array<{ description: string | null }>
    expect(rows[0].description).toBeNull()
  })

  it('invalid id (float) → {success:false, error}', async () => {
    const result = await handlers['update-perimetre'](null, TEST_DB_PATH, 1.5, 'old', 'new', '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid id')
  })

  it('invalid newName (empty) → {success:false, error}', async () => {
    const result = await handlers['update-perimetre'](null, TEST_DB_PATH, 1, 'old', '', '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid newName')
  })
})

// ── add-perimetre: UNIQUE constraint error includes perimeter name in quotes ──

describe('add-perimetre — UNIQUE constraint error message (T1268)', () => {
  it('duplicate name error message contains scope name with quotes', async () => {
    await handlers['add-perimetre'](null, TEST_DB_PATH, 'scope-dupe-msg-test')

    const result = await handlers['add-perimetre'](
      null, TEST_DB_PATH, 'scope-dupe-msg-test'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    // Error should contain quoted name: "scope-dupe-msg-test"
    expect(result.error).toContain('"scope-dupe-msg-test"')
  })
})

// ── task:setAssignees: valid roles and role=null ───────────────────────────────

describe('task:setAssignees — role validation (T1268)', () => {
  it('role=null is valid', async () => {
    const agentId = await insertAgent('role-null-agent')
    const taskId = await insertTask('role-null-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: null }]
    ) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('role=undefined is valid', async () => {
    const agentId = await insertAgent('role-undefined-agent')
    const taskId = await insertTask('role-undefined-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: undefined }]
    ) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('role="primary" is valid', async () => {
    const agentId = await insertAgent('role-primary-agent')
    const taskId = await insertTask('role-primary-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: 'primary' }]
    ) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('role="support" is valid', async () => {
    const agentId = await insertAgent('role-support-agent')
    const taskId = await insertTask('role-support-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: 'support' }]
    ) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('role="reviewer" is valid', async () => {
    const agentId = await insertAgent('role-reviewer-agent')
    const taskId = await insertTask('role-reviewer-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: 'reviewer' }]
    ) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('role="owner" is invalid (not in valid set)', async () => {
    const agentId = await insertAgent('role-owner-agent')
    const taskId = await insertTask('role-owner-task')

    const result = await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId, [{ agentId, role: 'owner' as 'primary' }]
    ) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid role')
    // Error message should include the invalid role value
    expect(result.error).toContain('owner')
    // And list accepted roles
    expect(result.error).toContain('primary')
  })

  it('primary agent wins over first assignee for agent_assigned_id', async () => {
    const agentFirst = await insertAgent('first-not-primary-agent')
    const agentPrimary = await insertAgent('actual-primary-agent')
    const taskId = await insertTask('primary-takes-precedence-task')

    await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId,
      [{ agentId: agentFirst, role: 'support' }, { agentId: agentPrimary, role: 'primary' }]
    )

    const rows = await queryLive(TEST_DB_PATH, 'SELECT agent_assigned_id FROM tasks WHERE id = ?', [taskId]) as Array<{ agent_assigned_id: number }>
    expect(rows[0].agent_assigned_id).toBe(agentPrimary)
  })

  it('no primary role → first assignee becomes agent_assigned_id', async () => {
    const agentFirst = await insertAgent('first-assignee-agent')
    const agentSecond = await insertAgent('second-assignee-agent')
    const taskId = await insertTask('first-wins-task')

    await handlers['task:setAssignees'](
      null, TEST_DB_PATH, taskId,
      [{ agentId: agentFirst, role: 'support' }, { agentId: agentSecond, role: 'reviewer' }]
    )

    const rows = await queryLive(TEST_DB_PATH, 'SELECT agent_assigned_id FROM tasks WHERE id = ?', [taskId]) as Array<{ agent_assigned_id: number }>
    expect(rows[0].agent_assigned_id).toBe(agentFirst)
  })

  it('empty assignees list → agent_assigned_id=NULL', async () => {
    const agentId = await insertAgent('clear-assignees-agent')
    const taskId = await insertTask('clear-assignees-task')

    await handlers['task:setAssignees'](null, TEST_DB_PATH, taskId, [{ agentId, role: 'primary' }])
    await handlers['task:setAssignees'](null, TEST_DB_PATH, taskId, [])

    const rows = await queryLive(TEST_DB_PATH, 'SELECT agent_assigned_id FROM tasks WHERE id = ?', [taskId]) as Array<{ agent_assigned_id: number | null }>
    expect(rows[0].agent_assigned_id).toBeNull()
  })
})
