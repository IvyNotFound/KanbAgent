/**
 * IPC agent handler tests — File 4 of 6
 * Covers: agent:duplicate handler (T475), agent-groups:list,
 *         agent-groups:create, agent-groups:rename
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
import { registerDbPath, clearDbCacheEntry, queryLive, writeDb } from './db'
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

// ── T475: agent:duplicate ─────────────────────────────────────────────────────

describe('agent:duplicate handler', () => {
  it('returns { success: false, error: Invalid agentId } for non-integer agentId', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 'abc') as {
      success: boolean; error?: string
    }
    expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
  })

  it('returns { success: false, error: Invalid agentId } for float agentId', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 1.5) as {
      success: boolean; error?: string
    }
    expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
  })

  it('returns { success: false, error } when agentId does not exist', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 99999) as {
      success: boolean; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Agent not found')
  })

  it('returns { success: true, agentId, name: "<name>-copy" } for valid agent', async () => {
    const agentId = await insertAgent('myagent')
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; agentId?: number; name?: string
    }
    expect(result.success).toBe(true)
    expect(result.name).toBe('myagent-copy')
    expect(typeof result.agentId).toBe('number')
  })

  it('generates unique name "<name>-copy-2" when "<name>-copy" already exists', async () => {
    const agentId = await insertAgent('dupe-agent')
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; name?: string
    }
    expect(result.success).toBe(true)
    expect(result.name).toBe('dupe-agent-copy-2')
  })

  it('generates "<name>-copy-3" on third duplication', async () => {
    const agentId = await insertAgent('triple-agent')
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; name?: string
    }
    expect(result.success).toBe(true)
    expect(result.name).toBe('triple-agent-copy-3')
  })

  it('copies all fields: name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools', async () => {
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        'INSERT INTO agents (name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['full-agent', 'dev', 'back-electron', 'auto', 'You are dev', 'Always respond in english', '["Bash","Read"]']
      )
    })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE name = ?', ['full-agent']) as Array<{ id: number }>
    const agentId = rows[0].id

    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as {
      success: boolean; agentId?: number; name?: string
    }
    expect(result.success).toBe(true)

    const copied = await queryLive(TEST_DB_PATH, 'SELECT * FROM agents WHERE id = ?', [result.agentId]) as Array<Record<string, unknown>>
    expect(copied[0].type).toBe('dev')
    expect(copied[0].scope).toBe('back-electron')
    expect(copied[0].thinking_mode).toBe('auto')
    expect(copied[0].system_prompt).toBe('You are dev')
    expect(copied[0].system_prompt_suffix).toBe('Always respond in english')
    expect(copied[0].allowed_tools).toBe('["Bash","Read"]')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent:duplicate'](null, '/unregistered/evil.db', 1) as {
      success: boolean; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('duplicate creates a new row in agents table', async () => {
    const agentId = await insertAgent('count-agent')
    const beforeRows = await queryLive(TEST_DB_PATH, 'SELECT COUNT(*) as n FROM agents', []) as Array<{ n: number }>
    const before = Number(beforeRows[0].n)

    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId)

    const afterRows = await queryLive(TEST_DB_PATH, 'SELECT COUNT(*) as n FROM agents', []) as Array<{ n: number }>
    expect(Number(afterRows[0].n)).toBe(before + 1)
  })
})

// ── Tests: agent-groups:list ──────────────────────────────────────────────────

describe('agent-groups:list', () => {
  it('returns { success: true, groups: [] } for empty DB', async () => {
    const result = await handlers['agent-groups:list'](null, TEST_DB_PATH) as { success: boolean; groups: unknown[] }
    expect(result.success).toBe(true)
    expect(result.groups).toEqual([])
  })

  it('returns groups with members after create + setMember', async () => {
    const agentId = await insertAgent('member-agent')
    const groupId = await insertGroup('Team Alpha')
    await handlers['agent-groups:setMember'](null, TEST_DB_PATH, agentId, groupId, 0)

    const result = await handlers['agent-groups:list'](null, TEST_DB_PATH) as {
      success: boolean; groups: Array<{ id: number; name: string; members: Array<{ agent_id: number }> }>
    }
    expect(result.success).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].name).toBe('Team Alpha')
    expect(result.groups[0].members).toHaveLength(1)
    expect(result.groups[0].members[0].agent_id).toBe(agentId)
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:list'](null, '/evil/unregistered.db') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: agent-groups:create ────────────────────────────────────────────────

describe('agent-groups:create', () => {
  it('creates a group and returns { success: true, group: { id, name, sort_order, created_at } }', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, 'My Group') as {
      success: boolean; group?: { id: number; name: string; sort_order: number; created_at: string }
    }
    expect(result.success).toBe(true)
    expect(result.group).toEqual(expect.objectContaining({ name: 'My Group' }))
    expect(typeof result.group!.id).toBe('number')
    expect(typeof result.group!.sort_order).toBe('number')
    expect(typeof result.group!.created_at).toBe('string')
  })

  it('returns { success: false, error: "Invalid group name" } for empty name', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: "Invalid group name" } for whitespace-only name', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, '   ') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: "Invalid group name" } for non-string name', async () => {
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, 42 as unknown as string) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:create'](null, '/evil/db.db', 'G') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('allows duplicate names (no UNIQUE constraint on agent_groups.name)', async () => {
    await handlers['agent-groups:create'](null, TEST_DB_PATH, 'DupeGroup')
    const result = await handlers['agent-groups:create'](null, TEST_DB_PATH, 'DupeGroup') as { success: boolean; group?: { id: number } }
    expect(result.success).toBe(true)
    expect(result.group).toEqual(expect.objectContaining({ name: 'DupeGroup' }))

    const rows = await queryLive(TEST_DB_PATH, "SELECT id FROM agent_groups WHERE name = 'DupeGroup'", []) as unknown[]
    expect(rows).toHaveLength(2)
  })
})

// ── Tests: agent-groups:rename ────────────────────────────────────────────────

describe('agent-groups:rename', () => {
  it('renames a group successfully → { success: true }', async () => {
    const groupId = await insertGroup('OldName')
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, groupId, 'NewName') as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT name FROM agent_groups WHERE id = ?', [groupId]) as Array<{ name: string }>
    expect(rows[0].name).toBe('NewName')
  })

  it('returns { success: false, error: "Invalid groupId" } for float groupId', async () => {
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, 1.5, 'X') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: "Invalid groupId" } for string groupId', async () => {
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, 'abc' as unknown as number, 'X') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid groupId')
  })

  it('returns { success: false, error: "Invalid group name" } for empty name', async () => {
    const groupId = await insertGroup('ValidGroup')
    const result = await handlers['agent-groups:rename'](null, TEST_DB_PATH, groupId, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid group name')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['agent-groups:rename'](null, '/evil/db.db', 1, 'X') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})
