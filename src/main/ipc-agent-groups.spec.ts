/**
 * Tests for ipc-agent-groups.ts — T1317
 *
 * Covers:
 * - setParent: float groupId → { success: false }
 * - setParent: parentId === groupId → cannot be its own parent
 * - setParent: cycle detection (A→B→A) → Cycle detected
 * - setParent: valid reparent → { success: true }
 * - createGroup: empty/null name → rejection
 * - reorder: non-integer groupId in array → rejection
 *
 * Framework: Vitest (Node environment — configured via environmentMatchGlobs)
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
import { registerDbPath, clearDbCacheEntry, writeDb, queryLive } from './db'
import { registerAgentGroupHandlers } from './ipc-agent-groups'
import { buildSchema, TEST_DB_PATH } from './test-utils/ipc-test-setup'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertGroup(name: string, parentId: number | null = null): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run(
      `INSERT INTO agent_groups (name, sort_order, parent_id) VALUES (?, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM agent_groups), ?)`,
      [name, parentId]
    )
  })
  const rows = await queryLive(
    TEST_DB_PATH,
    'SELECT id FROM agent_groups WHERE name = ? ORDER BY id DESC LIMIT 1',
    [name]
  ) as Array<{ id: number }>
  return rows[0].id
}

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  await buildSchema()

  registerDbPath(TEST_DB_PATH)
  registerAgentGroupHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── Tests: agent-groups:setParent ─────────────────────────────────────────────

describe('agent-groups:setParent (T1317)', () => {
  it('returns { success: false } when groupId is a float (non-integer)', async () => {
    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, 1.5, null
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid groupId')
  })

  it('returns { success: false } when parentId is a float (non-integer)', async () => {
    const groupId = await insertGroup('group-float-parent')

    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, groupId, 1.5 as unknown as number
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid parentId')
  })

  it('returns { success: false } when parentId === groupId (own parent)', async () => {
    const groupId = await insertGroup('group-self-parent')

    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, groupId, groupId
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot be its own parent')
  })

  it('detects cycle: A is ancestor of parentId → returns Cycle detected', async () => {
    // Create A → B (A is parent of B)
    const groupA = await insertGroup('group-cycle-A')
    const groupB = await insertGroup('group-cycle-B', groupA)

    // Now try to set A's parent to B → would create A→B→A cycle
    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, groupA, groupB
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cycle detected')
  })

  it('detects deeper cycle: A→B→C, setting C parent to A', async () => {
    const groupA = await insertGroup('group-deep-A')
    const groupB = await insertGroup('group-deep-B', groupA)
    const groupC = await insertGroup('group-deep-C', groupB)

    // Trying to make A a child of C would create A→B→C→A
    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, groupA, groupC
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cycle detected')
  })

  it('valid reparent returns { success: true } and updates parent_id in DB', async () => {
    const groupA = await insertGroup('group-valid-A')
    const groupB = await insertGroup('group-valid-B')

    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, groupB, groupA
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT parent_id FROM agent_groups WHERE id = ?', [groupB]
    ) as Array<{ parent_id: number }>
    expect(rows[0].parent_id).toBe(groupA)
  })

  it('setting parentId to null makes group a root group', async () => {
    const groupA = await insertGroup('group-root-A')
    const groupB = await insertGroup('group-root-B', groupA)

    const result = await handlers['agent-groups:setParent'](
      null, TEST_DB_PATH, groupB, null
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT parent_id FROM agent_groups WHERE id = ?', [groupB]
    ) as Array<{ parent_id: number | null }>
    expect(rows[0].parent_id).toBeNull()
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:setParent'](
      null, '/evil/db.db', 1, null
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: agent-groups:create ────────────────────────────────────────────────

describe('agent-groups:create (T1317)', () => {
  it('returns { success: false } for empty string name', async () => {
    const result = await handlers['agent-groups:create'](
      null, TEST_DB_PATH, ''
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid group name')
  })

  it('returns { success: false } for whitespace-only name', async () => {
    const result = await handlers['agent-groups:create'](
      null, TEST_DB_PATH, '   '
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid group name')
  })

  it('returns { success: false } for null name', async () => {
    const result = await handlers['agent-groups:create'](
      null, TEST_DB_PATH, null as unknown as string
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid group name')
  })

  it('returns { success: false } for non-integer parentId (float)', async () => {
    const result = await handlers['agent-groups:create'](
      null, TEST_DB_PATH, 'valid-name', 1.5
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid parentId')
  })

  it('creates group with valid name and returns { success: true, group }', async () => {
    const result = await handlers['agent-groups:create'](
      null, TEST_DB_PATH, 'my-group'
    ) as { success: boolean; group: { id: number; name: string; sort_order: number; parent_id: number | null } }

    expect(result.success).toBe(true)
    expect(result.group.name).toBe('my-group')
    expect(typeof result.group.id).toBe('number')
    expect(result.group.parent_id).toBeNull()
  })

  it('creates group with valid parentId', async () => {
    const parentId = await insertGroup('parent-group')

    const result = await handlers['agent-groups:create'](
      null, TEST_DB_PATH, 'child-group', parentId
    ) as { success: boolean; group: { id: number; parent_id: number } }

    expect(result.success).toBe(true)
    expect(result.group.parent_id).toBe(parentId)
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:create'](
      null, '/evil/db.db', 'evil-group'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: agent-groups:reorder ───────────────────────────────────────────────

describe('agent-groups:reorder (T1317)', () => {
  it('returns { success: false } when groupIds contains a float', async () => {
    const result = await handlers['agent-groups:reorder'](
      null, TEST_DB_PATH, [1, 2.5, 3]
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('array of integers')
  })

  it('returns { success: false } when groupIds is not an array', async () => {
    const result = await handlers['agent-groups:reorder'](
      null, TEST_DB_PATH, 'not-an-array' as unknown as number[]
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('array of integers')
  })

  it('returns { success: false } when groupIds contains a string', async () => {
    const result = await handlers['agent-groups:reorder'](
      null, TEST_DB_PATH, [1, 'two' as unknown as number, 3]
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('array of integers')
  })

  it('reorders groups and updates sort_order in DB', async () => {
    const groupA = await insertGroup('reorder-A')
    const groupB = await insertGroup('reorder-B')
    const groupC = await insertGroup('reorder-C')

    // Reorder: C first, then A, then B
    const result = await handlers['agent-groups:reorder'](
      null, TEST_DB_PATH, [groupC, groupA, groupB]
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT id, sort_order FROM agent_groups WHERE id IN (?, ?, ?) ORDER BY sort_order',
      [groupA, groupB, groupC]
    ) as Array<{ id: number; sort_order: number }>

    const byId = Object.fromEntries(rows.map(r => [r.id, r.sort_order]))
    expect(byId[groupC]).toBe(0)
    expect(byId[groupA]).toBe(1)
    expect(byId[groupB]).toBe(2)
  })

  it('accepts empty array without error', async () => {
    const result = await handlers['agent-groups:reorder'](
      null, TEST_DB_PATH, []
    ) as { success: boolean }

    expect(result.success).toBe(true)
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:reorder'](
      null, '/evil/db.db', [1, 2]
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})
