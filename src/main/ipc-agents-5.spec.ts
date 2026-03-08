/**
 * IPC agent handler tests — File 5 of 6
 * Covers: agent-groups:delete, agent-groups:setMember, agent-groups:reorder
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
import { registerDbPath, clearDbCacheEntry, queryLive } from './db'
import { registerAgentHandlers } from './ipc-agents'
import {
  buildSchema,
  TEST_DB_PATH,
  insertAgent,
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

// ── Helper: insert group via handler ─────────────────────────────────────────
async function insertGroup(name: string): Promise<number> {
  const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, name) as { success: boolean; group?: { id: number } }
  if (!result.success || !result.group) throw new Error(`Failed to create group '${name}'`)
  return result.group.id
}

// ── Tests: agent-groups:delete ────────────────────────────────────────────────

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

// ── Tests: agent-groups:setMember ─────────────────────────────────────────────

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

// ── Tests: agent-groups:reorder ───────────────────────────────────────────────

describe('agent-groups:reorder', () => {
  it('reorders groups → sort_order updated in DB', async () => {
    const g1 = await insertGroup('Reorder-A')
    const g2 = await insertGroup('Reorder-B')
    const g3 = await insertGroup('Reorder-C')

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
