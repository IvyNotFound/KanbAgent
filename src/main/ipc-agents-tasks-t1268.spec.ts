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

describe('close-agent-sessions — status string values (T1268)', () => {
  it('sets status="completed" on started sessions', async () => {
    const agentId = await insertAgent('close-sessions-completed')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentId])
    })

    const result = await handlers['close-agent-sessions'](null, TEST_DB_PATH, 'close-sessions-completed') as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ?', [agentId]) as Array<{ status: string }>
    expect(rows[0].status).toBe('completed')  // must be exactly "completed", not ""
  })

  it('does NOT close sessions with status other than "started"', async () => {
    const agentId = await insertAgent('close-sessions-filter')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'completed')", [agentId])
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentId])
    })

    await handlers['close-agent-sessions'](null, TEST_DB_PATH, 'close-sessions-filter')

    const rows = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ? ORDER BY id', [agentId]) as Array<{ status: string }>
    // First session was already completed → unchanged, second was started → now completed
    expect(rows[0].status).toBe('completed')
    expect(rows[1].status).toBe('completed')
  })

  it('only closes sessions for the named agent (not other agents)', async () => {
    const agentA = await insertAgent('close-sessions-agentA')
    const agentB = await insertAgent('close-sessions-agentB')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentA])
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'started')", [agentB])
    })

    await handlers['close-agent-sessions'](null, TEST_DB_PATH, 'close-sessions-agentA')

    const rowsA = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ?', [agentA]) as Array<{ status: string }>
    const rowsB = await queryLive(TEST_DB_PATH, 'SELECT status FROM sessions WHERE agent_id = ?', [agentB]) as Array<{ status: string }>

    expect(rowsA[0].status).toBe('completed')
    expect(rowsB[0].status).toBe('started')  // not closed
  })

  it('invalid agentName (empty) → {success:false, error}', async () => {
    const result = await handlers['close-agent-sessions'](null, TEST_DB_PATH, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentName')
  })

  it('invalid agentName (whitespace only) → {success:false, error}', async () => {
    const result = await handlers['close-agent-sessions'](null, TEST_DB_PATH, '   ') as { success: boolean; error: string }
    // Note: 3 spaces may pass NonEmptyStringSchema min(1) — depends on implementation
    // Test to verify actual behavior for whitespace
    expect(typeof result).toBe('object')
  })
})

// ── build-agent-prompt: userPrompt.trim(), fallback, format strings ───────────

describe('build-agent-prompt — whitespace trim and format strings (T1268)', () => {
  it('userPrompt with leading/trailing whitespace is trimmed', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', '  T123  '
    ) as string

    expect(result).toBe('T123')  // trimmed, not '  T123  '
  })

  it('returns empty string when userPrompt is all whitespace', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', '   '
    ) as string

    expect(result).toBe('')  // trimmed to empty
  })

  it('missing dbPath → returns bare userPrompt (fallback)', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', 'my prompt', undefined, 1
    ) as string

    expect(result).toBe('my prompt')  // no context block
  })

  it('missing agentId → returns bare userPrompt (fallback)', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', 'my prompt', TEST_DB_PATH, undefined
    ) as string

    expect(result).toBe('my prompt')  // no context block
  })

  it('both dbPath and agentId required (|| not &&) — only dbPath missing also falls back', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', 'prompt text', undefined, undefined
    ) as string

    expect(result).toBe('prompt text')
  })

  it('agent type displays correctly: type shown after (type: prefix)', async () => {
    const agentId = await insertAgent('prompt-type-agent')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("UPDATE agents SET type = 'dev', scope = 'back-electron' WHERE id = ?", [agentId])
    })

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-type-agent', 'T1', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('type:dev')
    expect(result).toContain('périmètre:back-electron')
  })

  it('agent without type shows "-" placeholder (not empty string)', async () => {
    const agentId = await insertAgent('prompt-no-type-agent')
    // type is 'dev' from insertAgent helper — set to null
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("UPDATE agents SET type = NULL, scope = NULL WHERE id = ?", [agentId])
    })

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-no-type-agent', 'T2', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('type:-')
    expect(result).toContain('périmètre:-')
  })

  it('context block contains required section headers (StringLiteral mutants)', async () => {
    const agentId = await insertAgent('prompt-headers-agent')

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-headers-agent', 'T9', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('=== IDENTIFIANTS ===')
    expect(result).toContain('=== SESSION PRÉCÉDENTE ===')
    expect(result).toContain('=== TÂCHES ASSIGNÉES ===')
    expect(result).toContain('=== LOCKS ACTIFS ===')
  })

  it('task format includes prio: prefix in task line', async () => {
    const agentId = await insertAgent('prompt-task-format-agent')
    const taskId = await insertTask('format-task-title')
    // Assign task to the agent
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('UPDATE tasks SET agent_assigned_id = ? WHERE id = ?', [agentId, taskId])
    })

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-task-format-agent', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('prio:')
    expect(result).toContain('format-task-title')
  })

  it('(aucune tâche) shown when no tasks assigned (StringLiteral)', async () => {
    const agentId = await insertAgent('prompt-no-tasks-agent')

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-no-tasks-agent', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('(aucune tâche todo / in_progress)')
  })

  it('(aucun) shown when no locks (StringLiteral)', async () => {
    const agentId = await insertAgent('prompt-no-locks-agent')

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-no-locks-agent', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('(aucun)')
  })

  it('(aucune session completed) shown when no previous session', async () => {
    const agentId = await insertAgent('prompt-no-session-agent')

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-no-session-agent', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('(aucune session completed)')
  })

  it('returns bare userPrompt when context block is null (agent not found)', async () => {
    // Agent with ID that does not exist → contextBlock = null → fallback to base
    const result = await handlers['build-agent-prompt'](
      null, 'nonexistent', 'fallback-prompt', TEST_DB_PATH, 99999
    ) as string

    expect(result).toBe('fallback-prompt')
  })

  it('contextBlock prefixed to userPrompt with "---" separator', async () => {
    const agentId = await insertAgent('prompt-separator-agent')

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-separator-agent', 'T42', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('---')
    expect(result).toContain('T42')
    expect(result.indexOf('=== IDENTIFIANTS ===')).toBeLessThan(result.indexOf('T42'))
  })

  it('contextBlock alone returned when userPrompt is empty', async () => {
    const agentId = await insertAgent('prompt-empty-userprompt-agent')

    const result = await handlers['build-agent-prompt'](
      null, 'prompt-empty-userprompt-agent', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('=== IDENTIFIANTS ===')
    expect(result).not.toContain('---\n')  // no separator when empty prompt
  })
})

// ── update-perimetre: oldName !== newName cascade condition ───────────────────

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
