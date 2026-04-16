/**
 * Integration tests — ipc-agent-crud.ts handlers — T1479
 *
 * Directly exercises registerAgentCrudHandlers() for:
 * - STANDARD_AGENT_SUFFIX export content
 * - rename-agent: valid rename, invalid agentId (0, -1, string), invalid newName (empty, >200 chars)
 * - delete-agent: valid deletion, non-existent id, agent with history blocked
 * - create-agent: valid payload, missing required field, duplicate name
 * - update-agent: valid update, invalid field, invalid agentId
 * - get-agent-system-prompt / update-agent-system-prompt: round-trip read/write, unknown dbPath
 * - agent:duplicate: valid duplicate, unique name generation, invalid agentId
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
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
  readFile: vi.fn(async () => dbBuffer),
  writeFile: vi.fn(async (_path: string, data: Buffer) => { dbBuffer = data; dbMtime += 1 }),
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
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
import { registerAgentCrudHandlers, STANDARD_AGENT_SUFFIX } from './ipc-agent-crud'
import { buildSchema, insertAgent, TEST_DB_PATH, TEST_PROJECT_PATH } from './test-utils/ipc-test-setup'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000
  dbBuffer = Buffer.alloc(0)

  await buildSchema()
  registerDbPath(TEST_DB_PATH)
  registerProjectPath(TEST_PROJECT_PATH)
  registerAgentCrudHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── STANDARD_AGENT_SUFFIX ─────────────────────────────────────────────────────

describe('STANDARD_AGENT_SUFFIX (T1479)', () => {
  it('is a non-empty string', () => {
    expect(typeof STANDARD_AGENT_SUFFIX).toBe('string')
    expect(STANDARD_AGENT_SUFFIX.length).toBeGreaterThan(0)
  })

  it("contains required protocol lines: in_progress, done, completed", () => {
    expect(STANDARD_AGENT_SUFFIX).toContain("UPDATE tasks SET status='in_progress'")
    expect(STANDARD_AGENT_SUFFIX).toContain("UPDATE tasks SET status='done'")
    expect(STANDARD_AGENT_SUFFIX).toContain("UPDATE sessions SET status='completed'")
  })

  it('starts with --- separator', () => {
    expect(STANDARD_AGENT_SUFFIX.startsWith('---')).toBe(true)
  })
})

// ── rename-agent ──────────────────────────────────────────────────────────────

describe('rename-agent (T1479)', () => {
  it('valid rename → success: true + DB updated', async () => {
    const agentId = await insertAgent('agent-to-rename')

    const result = await handlers['rename-agent'](null, TEST_DB_PATH, agentId, 'renamed-agent') as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT name FROM agents WHERE id = ?', [agentId]) as Array<{ name: string }>
    expect(rows[0].name).toBe('renamed-agent')
  })

  it('invalid agentId: 0 → success: false', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, 0, 'new-name') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid agentId: -1 → success: false', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, -1, 'new-name') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid agentId: string → success: false', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, 'abc' as unknown as number, 'new-name') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid newName: empty string → success: false', async () => {
    const agentId = await insertAgent('agent-empty-name')
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, agentId, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid newName')
  })

  it('invalid newName: >200 chars → success: false', async () => {
    const agentId = await insertAgent('agent-long-name')
    const longName = 'a'.repeat(201)
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, agentId, longName) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid newName')
  })

  it('non-existent agentId → success: true (UPDATE no-op)', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, 99999, 'ghost') as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('unauthorized dbPath → success: false with DB_PATH_NOT_ALLOWED', async () => {
    const result = await handlers['rename-agent'](null, '/evil/db.db', 1, 'new') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── delete-agent ──────────────────────────────────────────────────────────────

describe('delete-agent (T1479)', () => {
  it('valid deletion — agent with no history → success: true, hasHistory: false', async () => {
    const agentId = await insertAgent('agent-deletable')

    const result = await handlers['delete-agent'](null, TEST_DB_PATH, agentId) as { success: boolean; hasHistory: boolean }
    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(false)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE id = ?', [agentId]) as unknown[]
    expect(rows).toHaveLength(0)
  })

  it('agent with sessions history → success: true, hasHistory: true (not deleted)', async () => {
    const agentId = await insertAgent('agent-with-session')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO sessions (agent_id, status) VALUES (?, 'completed')", [agentId])
    })

    const result = await handlers['delete-agent'](null, TEST_DB_PATH, agentId) as { success: boolean; hasHistory: boolean }
    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE id = ?', [agentId]) as unknown[]
    expect(rows).toHaveLength(1)
  })

  it('agent with task_comments history → blocked, hasHistory: true', async () => {
    const agentId = await insertAgent('agent-with-comments')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO task_comments (task_id, agent_id, content) VALUES (1, ?, ?)', [agentId, 'comment'])
    })

    const result = await handlers['delete-agent'](null, TEST_DB_PATH, agentId) as { success: boolean; hasHistory: boolean }
    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(true)
  })

  it('non-existent id → success: true, hasHistory: false', async () => {
    const result = await handlers['delete-agent'](null, TEST_DB_PATH, 99999) as { success: boolean; hasHistory: boolean }
    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(false)
  })

  it('invalid id (float) → success: false', async () => {
    const result = await handlers['delete-agent'](null, TEST_DB_PATH, 1.5) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid id (string) → success: false', async () => {
    const result = await handlers['delete-agent'](null, TEST_DB_PATH, 'bad' as unknown as number) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('unauthorized dbPath → success: false', async () => {
    const result = await handlers['delete-agent'](null, '/evil/db.db', 1) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── create-agent ──────────────────────────────────────────────────────────────

describe('create-agent (T1479)', () => {
  it('valid payload → success: true, agentId returned, stored in DB', async () => {
    const result = await handlers['create-agent'](
      null, TEST_DB_PATH, TEST_PROJECT_PATH,
      { name: 'new-crud-agent', type: 'dev', scope: 'back-electron', thinkingMode: null, systemPrompt: null, description: 'Test' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('number')

    const rows = await queryLive(TEST_DB_PATH, 'SELECT name, type FROM agents WHERE id = ?', [result.agentId]) as Array<{ name: string; type: string }>
    expect(rows[0].name).toBe('new-crud-agent')
    expect(rows[0].type).toBe('dev')
  })

  it('STANDARD_AGENT_SUFFIX stored in system_prompt_suffix on creation', async () => {
    const result = await handlers['create-agent'](
      null, TEST_DB_PATH, TEST_PROJECT_PATH,
      { name: 'suffix-check-agent', type: 'test', scope: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)
    const rows = await queryLive(TEST_DB_PATH, 'SELECT system_prompt_suffix FROM agents WHERE id = ?', [result.agentId]) as Array<{ system_prompt_suffix: string }>
    expect(rows[0].system_prompt_suffix).toBe(STANDARD_AGENT_SUFFIX)
  })

  it('missing required field (name empty) → success: false', async () => {
    const result = await handlers['create-agent'](
      null, TEST_DB_PATH, TEST_PROJECT_PATH,
      { name: '', type: 'test', scope: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('duplicate name → success: false, error contains agent name', async () => {
    await insertAgent('dupe-crud-agent')

    const result = await handlers['create-agent'](
      null, TEST_DB_PATH, TEST_PROJECT_PATH,
      { name: 'dupe-crud-agent', type: 'test', scope: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('dupe-crud-agent')
  })

  it('unauthorized dbPath → success: false', async () => {
    const result = await handlers['create-agent'](
      null, '/evil/db.db', TEST_PROJECT_PATH,
      { name: 'evil-agent', type: 'test', scope: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── update-agent ──────────────────────────────────────────────────────────────

describe('update-agent (T1479)', () => {
  it('valid name update → persisted in DB', async () => {
    const agentId = await insertAgent('agent-to-update')

    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { name: 'updated-name' }) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT name FROM agents WHERE id = ?', [agentId]) as Array<{ name: string }>
    expect(rows[0].name).toBe('updated-name')
  })

  it('valid autoLaunch update → 1/0 stored in DB', async () => {
    const agentId = await insertAgent('agent-autolaunched')

    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { autoLaunch: false })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT auto_launch FROM agents WHERE id = ?', [agentId]) as Array<{ auto_launch: number }>
    expect(rows[0].auto_launch).toBe(0)
  })

  it('invalid maxSessions (0) → success: false', async () => {
    const agentId = await insertAgent('agent-max-sessions')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: 0 }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('maxSessions')
  })

  it('maxSessions: -1 (unlimited) → success: true', async () => {
    const agentId = await insertAgent('agent-unlimited-sessions')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: -1 }) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('invalid agentId (0) → success: false', async () => {
    const result = await handlers['update-agent'](null, TEST_DB_PATH, 0, { name: 'x' }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('empty updates object → success: true (no-op)', async () => {
    const agentId = await insertAgent('agent-noop-update')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, {}) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('unauthorized dbPath → success: false', async () => {
    const result = await handlers['update-agent'](null, '/evil/db.db', 1, { name: 'x' }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── get-agent-system-prompt / update-agent-system-prompt (round-trip) ─────────
