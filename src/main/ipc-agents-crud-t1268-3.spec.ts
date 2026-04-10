/**
 * Mutation-killing tests for ipc-agent-crud.ts — T1268
 *
 * Targets survived mutants:
 * - create-agent: LogicalOperator (scope??perimetre), STANDARD_AGENT_SUFFIX stored,
 *   CLAUDE.md conditional (updated !== claudeMdContent), UNIQUE error message format
 * - update-agent: All individual field ConditionalExpressions, maxSessions lower bound (v >= 1 vs v > 1),
 *   worktreeEnabled null/true/false encoding, scope??perimetre ??/&&
 * - get-agent-system-prompt: worktreeEnabled returned
 * - delete-agent: agent with agent_logs hasHistory, agentId validation (typeof check)
 * - rename-agent: invalid agentId (negative, zero, float)
 * - update-agent-system-prompt: invalid agentId (negative), empty systemPrompt → NULL
 * - agent:duplicate: name generation "-copy", "-copy-2"
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

// insertAgentIntoClaudeMd retourne un contenu MODIFIÉ → déclenche l'écriture
const claudeMdModifiedContent = '# CLAUDE.md\n## Agents\n- new-agent (dev)\n'
vi.mock('./claude-md', () => ({
  insertAgentIntoClaudeMd: vi.fn(() => claudeMdModifiedContent),
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
import { registerDbPath, registerProjectPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'
import { STANDARD_AGENT_SUFFIX } from './ipc-agent-crud'
import {
  buildSchema,
  insertAgent,
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
    if (typeof path === 'string' && path.endsWith('.md')) return '# CLAUDE.md\n## Agents\n'
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

// ── create-agent: scope via perimetre field (LogicalOperator ?? vs &&) ────────

describe('get-agent-system-prompt — preferredModel field (T1356)', () => {
  it('returns preferredModel:null when not set', async () => {
    const agentId = await insertAgent('gsp-pm-null')
    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; preferredModel: string | null
    }
    expect(result.success).toBe(true)
    expect(result.preferredModel).toBeNull()
  })

  it('returns preferredModel after update-agent sets it', async () => {
    const agentId = await insertAgent('gsp-pm-set')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: 'anthropic/claude-opus-4-5' })

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; preferredModel: string | null
    }
    expect(result.success).toBe(true)
    expect(result.preferredModel).toBe('anthropic/claude-opus-4-5')
  })

  it('returns preferredModel:null after clearing with empty string', async () => {
    const agentId = await insertAgent('gsp-pm-clear')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: 'some-model' })
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: '' })

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; preferredModel: string | null
    }
    expect(result.success).toBe(true)
    expect(result.preferredModel).toBeNull()
  })

  it('returns preferredModel:null in error response for unknown agent', async () => {
    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, 99999) as {
      success: boolean; preferredModel: null
    }
    expect(result.success).toBe(false)
    expect(result.preferredModel).toBeNull()
  })
})

// ── update-agent: preferredModel field (T1356) ───────────────────────────────

describe('update-agent — preferredModel field (T1356)', () => {
  it('persists preferredModel string via update-agent', async () => {
    const agentId = await insertAgent('ua-pm-persist')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: 'gemini-2.5-pro' }) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT preferred_model FROM agents WHERE id = ?', [agentId]) as Array<{ preferred_model: string | null }>
    expect(rows[0].preferred_model).toBe('gemini-2.5-pro')
  })

  it('stores NULL when preferredModel is null', async () => {
    const agentId = await insertAgent('ua-pm-null')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: 'some-model' })
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: null })

    const rows = await queryLive(TEST_DB_PATH, 'SELECT preferred_model FROM agents WHERE id = ?', [agentId]) as Array<{ preferred_model: string | null }>
    expect(rows[0].preferred_model).toBeNull()
  })

  it('rejects preferredModel exceeding 200 chars', async () => {
    const agentId = await insertAgent('ua-pm-toolong')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { preferredModel: 'x'.repeat(201) }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('preferredModel')
  })
})
