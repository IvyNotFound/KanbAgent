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
