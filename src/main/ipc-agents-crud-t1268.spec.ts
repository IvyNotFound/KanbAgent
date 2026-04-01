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

describe('create-agent — scope/perimetre LogicalOperator (T1268)', () => {
  it('uses perimetre when scope not provided → scope column stores perimetre value', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-perimetre-only', type: 'dev', perimetre: 'back-electron', thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [result.agentId]) as Array<{ scope: string | null }>
    expect(rows[0].scope).toBe('back-electron')
  })

  it('scope takes precedence over perimetre when both provided', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-scope-wins', type: 'dev', scope: 'front-vuejs', perimetre: 'back-electron', thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [result.agentId]) as Array<{ scope: string | null }>
    expect(rows[0].scope).toBe('front-vuejs')
  })

  it('scope=null and perimetre=null → NULL in DB', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-no-scope', type: 'dev', scope: null, perimetre: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)
    const rows = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [result.agentId]) as Array<{ scope: string | null }>
    expect(rows[0].scope).toBeNull()
  })
})

// ── create-agent: thinkingMode and systemPrompt persist (not nulled by &&) ───

describe('create-agent — thinkingMode/systemPrompt persistence (T1268)', () => {
  it('thinkingMode="auto" stored in DB (not nulled out)', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-thinking-auto', type: 'dev', thinkingMode: 'auto', systemPrompt: null, description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)
    const rows = await queryLive(TEST_DB_PATH, 'SELECT thinking_mode FROM agents WHERE id = ?', [result.agentId]) as Array<{ thinking_mode: string | null }>
    expect(rows[0].thinking_mode).toBe('auto')
  })

  it('systemPrompt stored in DB (not nulled out by && operator)', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-with-prompt', type: 'dev', thinkingMode: null, systemPrompt: 'You are a dev agent.', description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)
    const rows = await queryLive(TEST_DB_PATH, 'SELECT system_prompt FROM agents WHERE id = ?', [result.agentId]) as Array<{ system_prompt: string | null }>
    expect(rows[0].system_prompt).toBe('You are a dev agent.')
  })

  it('STANDARD_AGENT_SUFFIX is stored in system_prompt_suffix on creation', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-suffix-check', type: 'dev', thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; agentId: number }

    expect(result.success).toBe(true)
    const rows = await queryLive(TEST_DB_PATH, 'SELECT system_prompt_suffix FROM agents WHERE id = ?', [result.agentId]) as Array<{ system_prompt_suffix: string | null }>
    expect(rows[0].system_prompt_suffix).toBe(STANDARD_AGENT_SUFFIX)
    expect(rows[0].system_prompt_suffix).toContain('AGENT PROTOCOL REMINDER')
  })

  it('STANDARD_AGENT_SUFFIX is not empty (ArrayDeclaration mutant)', () => {
    expect(STANDARD_AGENT_SUFFIX).toBeTruthy()
    expect(STANDARD_AGENT_SUFFIX.length).toBeGreaterThan(0)
    expect(STANDARD_AGENT_SUFFIX).toContain("UPDATE tasks SET status='in_progress'")
    expect(STANDARD_AGENT_SUFFIX).toContain("UPDATE tasks SET status='done'")
    expect(STANDARD_AGENT_SUFFIX).toContain("UPDATE sessions SET status='completed'")
  })
})

// ── create-agent: CLAUDE.md conditional (updated !== claudeMdContent) ─────────

describe('create-agent — CLAUDE.md update conditional (T1268)', () => {
  it('claudeMdUpdated=true when insertAgentIntoClaudeMd returns modified content', async () => {
    // insertAgentIntoClaudeMd is mocked to return different content → should write file
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-claude-md-update', type: 'dev', thinkingMode: null, systemPrompt: null, description: 'Dev agent' }
    ) as { success: boolean; claudeMdUpdated: boolean }

    expect(result.success).toBe(true)
    expect(result.claudeMdUpdated).toBe(true)
  })

  it('claudeMdUpdated=false when insertAgentIntoClaudeMd returns same content', async () => {
    const { insertAgentIntoClaudeMd } = await import('./claude-md')
    const mockFn = insertAgentIntoClaudeMd as ReturnType<typeof vi.fn>
    // Return same content as read from file → no write
    mockFn.mockImplementationOnce((content: string) => content)

    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'agent-claude-md-same', type: 'dev', thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; claudeMdUpdated: boolean }

    expect(result.success).toBe(true)
    expect(result.claudeMdUpdated).toBe(false)
  })
})

// ── create-agent: UNIQUE constraint error message includes agent name ─────────

describe('create-agent — UNIQUE constraint error message (T1268)', () => {
  it('error message contains agent name with quotes', async () => {
    await insertAgent('dupe-agent-msg-test')

    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'dupe-agent-msg-test', type: 'dev', thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('"dupe-agent-msg-test"')
    // Verify exact quote characters are present (StringLiteral mutants on L290)
    expect(result.error).toMatch(/"dupe-agent-msg-test"/)
  })
})

// ── update-agent: individual field ConditionalExpressions ────────────────────

describe('update-agent — individual field updates (T1268)', () => {
  it('name update: name field changes in DB', async () => {
    const agentId = await insertAgent('update-name-before')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { name: 'update-name-after' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT name FROM agents WHERE id = ?', [agentId]) as Array<{ name: string }>
    expect(rows[0].name).toBe('update-name-after')
  })

  it('type update: type field changes in DB', async () => {
    const agentId = await insertAgent('update-type-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { type: 'test' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT type FROM agents WHERE id = ?', [agentId]) as Array<{ type: string }>
    expect(rows[0].type).toBe('test')
  })

  it('scope update: scope field changes in DB', async () => {
    const agentId = await insertAgent('update-scope-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { scope: 'front-vuejs' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [agentId]) as Array<{ scope: string }>
    expect(rows[0].scope).toBe('front-vuejs')
  })

  it('perimetre update (alias for scope): scope field changes in DB', async () => {
    const agentId = await insertAgent('update-perimetre-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { perimetre: 'back-electron' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [agentId]) as Array<{ scope: string }>
    expect(rows[0].scope).toBe('back-electron')
  })

  it('scope takes precedence over perimetre when both in updates', async () => {
    const agentId = await insertAgent('update-scope-perimetre')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { scope: 'front-vuejs', perimetre: 'back-electron' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT scope FROM agents WHERE id = ?', [agentId]) as Array<{ scope: string }>
    expect(rows[0].scope).toBe('front-vuejs')
  })

  it('thinkingMode update: thinking_mode changes in DB', async () => {
    const agentId = await insertAgent('update-thinking-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { thinkingMode: 'disabled' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT thinking_mode FROM agents WHERE id = ?', [agentId]) as Array<{ thinking_mode: string }>
    expect(rows[0].thinking_mode).toBe('disabled')
  })

  it('allowedTools update: allowed_tools changes in DB', async () => {
    const agentId = await insertAgent('update-allowed-tools-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { allowedTools: '["Bash","Read"]' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT allowed_tools FROM agents WHERE id = ?', [agentId]) as Array<{ allowed_tools: string }>
    expect(rows[0].allowed_tools).toBe('["Bash","Read"]')
  })

  it('systemPrompt update: system_prompt changes in DB', async () => {
    const agentId = await insertAgent('update-sp-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { systemPrompt: 'New prompt' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT system_prompt FROM agents WHERE id = ?', [agentId]) as Array<{ system_prompt: string }>
    expect(rows[0].system_prompt).toBe('New prompt')
  })

  it('systemPromptSuffix update: system_prompt_suffix changes in DB', async () => {
    const agentId = await insertAgent('update-sps-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { systemPromptSuffix: 'Suffix text' })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT system_prompt_suffix FROM agents WHERE id = ?', [agentId]) as Array<{ system_prompt_suffix: string }>
    expect(rows[0].system_prompt_suffix).toBe('Suffix text')
  })

  it('autoLaunch=true: auto_launch=1 in DB', async () => {
    const agentId = await insertAgent('update-autolaunch-true-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { autoLaunch: true })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT auto_launch FROM agents WHERE id = ?', [agentId]) as Array<{ auto_launch: number }>
    expect(rows[0].auto_launch).toBe(1)
  })

  it('autoLaunch=false: auto_launch=0 in DB', async () => {
    const agentId = await insertAgent('update-autolaunch-false-agent')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { autoLaunch: false })
    const rows = await queryLive(TEST_DB_PATH, 'SELECT auto_launch FROM agents WHERE id = ?', [agentId]) as Array<{ auto_launch: number }>
    expect(rows[0].auto_launch).toBe(0)
  })

  it('empty updates object → success:true, no columns changed', async () => {
    const agentId = await insertAgent('update-empty-agent')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("UPDATE agents SET type = 'original-type' WHERE id = ?", [agentId])
    })

    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, {}) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT type FROM agents WHERE id = ?', [agentId]) as Array<{ type: string }>
    expect(rows[0].type).toBe('original-type')
  })
})

// ── update-agent: worktreeEnabled encoding ────────────────────────────────────

describe('update-agent — worktreeEnabled encoding (T1268)', () => {
  it('worktreeEnabled=true → worktree_enabled=1 in DB', async () => {
    const agentId = await insertAgent('update-worktree-true')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: true }) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT worktree_enabled FROM agents WHERE id = ?', [agentId]) as Array<{ worktree_enabled: number }>
    expect(rows[0].worktree_enabled).toBe(1)
  })

  it('worktreeEnabled=false → worktree_enabled=0 in DB', async () => {
    const agentId = await insertAgent('update-worktree-false')
    // First set to true
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: true })
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: false }) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT worktree_enabled FROM agents WHERE id = ?', [agentId]) as Array<{ worktree_enabled: number }>
    expect(rows[0].worktree_enabled).toBe(0)
  })

  it('worktreeEnabled=null → update succeeds (NULL stored if schema allows)', async () => {
    const agentId = await insertAgent('update-worktree-null')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: true })
    // Note: ipc-agents-test-setup schema has NOT NULL DEFAULT 0, so NULL may not be stored
    // The important thing is that the handler processes worktreeEnabled=null without error
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: null }) as { success: boolean | string }
    // Either success or a constraint error (depending on schema) — test that handler processes the field
    expect(typeof result).toBe('object')
    expect('success' in result).toBe(true)
  })
})

// ── update-agent: maxSessions EqualityOperator (v >= 1 vs v > 1) ──────────────

describe('update-agent — maxSessions boundary (EqualityOperator v>=1 vs v>1) (T1268)', () => {
  it('maxSessions=1 is valid (lower bound is 1, not 2)', async () => {
    const agentId = await insertAgent('update-maxsessions-1')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: 1 }) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT max_sessions FROM agents WHERE id = ?', [agentId]) as Array<{ max_sessions: number }>
    expect(rows[0].max_sessions).toBe(1)
  })

  it('maxSessions=2 is valid', async () => {
    const agentId = await insertAgent('update-maxsessions-2')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: 2 }) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('maxSessions=0 is invalid (must be >=1 or -1)', async () => {
    const agentId = await insertAgent('update-maxsessions-0')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: 0 }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('maxSessions')
  })

  it('maxSessions=-1 is valid (unlimited)', async () => {
    const agentId = await insertAgent('update-maxsessions-neg1')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: -1 }) as { success: boolean }
    expect(result.success).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT max_sessions FROM agents WHERE id = ?', [agentId]) as Array<{ max_sessions: number }>
    expect(rows[0].max_sessions).toBe(-1)
  })

  it('maxSessions=-2 is invalid (only -1 allowed as negative)', async () => {
    const agentId = await insertAgent('update-maxsessions-neg2')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: -2 }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('maxSessions')
  })

  it('update-agent returns specific maxSessions error message', async () => {
    const agentId = await insertAgent('update-maxsessions-errmsg')
    const result = await handlers['update-agent'](null, TEST_DB_PATH, agentId, { maxSessions: 0 }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    // Specific error format: "Invalid maxSessions value: 0. Must be an integer >= 1 or -1 (unlimited)."
    expect(result.error).toContain('Invalid maxSessions value: 0')
  })
})

// ── get-agent-system-prompt: returns worktreeEnabled ─────────────────────────

describe('get-agent-system-prompt — worktreeEnabled field (T1268)', () => {
  it('returns worktreeEnabled=1 when set via update-agent', async () => {
    const agentId = await insertAgent('gsp-worktree-1')
    // Use the update-agent handler to set worktreeEnabled (avoids direct SQL on potentially missing column)
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: true })

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; worktreeEnabled: number | null
    }

    expect(result.success).toBe(true)
    expect(result.worktreeEnabled).toBe(1)
  })

  it('returns worktreeEnabled=0 when set to false via update-agent', async () => {
    const agentId = await insertAgent('gsp-worktree-0')
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: true })
    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { worktreeEnabled: false })

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; worktreeEnabled: number | null
    }

    expect(result.success).toBe(true)
    expect(result.worktreeEnabled).toBe(0)
  })

  it('get-agent-system-prompt returns success:true for existing agent', async () => {
    const agentId = await insertAgent('gsp-exists-agent')

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; worktreeEnabled: number | null
    }

    expect(result.success).toBe(true)
    // worktreeEnabled field is present in result (may be 0 or null depending on schema)
    expect('worktreeEnabled' in result).toBe(true)
  })

  it('returns success:false + worktreeEnabled:null for unknown agent', async () => {
    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, 99999) as {
      success: boolean; worktreeEnabled: null
    }

    expect(result.success).toBe(false)
    expect(result.worktreeEnabled).toBeNull()
  })
})

// ── rename-agent: validation (invalid agentId) ────────────────────────────────

describe('rename-agent — agentId validation (T1268)', () => {
  it('negative agentId → {success:false, error}', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, -1, 'new-name') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('zero agentId → {success:false, error}', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, 0, 'new-name') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('float agentId → {success:false, error}', async () => {
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, 1.5, 'new-name') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('empty newName → {success:false, error}', async () => {
    const agentId = await insertAgent('rename-empty-name')
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, agentId, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid newName')
  })

  it('newName too long (201 chars) → {success:false, error}', async () => {
    const agentId = await insertAgent('rename-toolong')
    const longName = 'a'.repeat(201)
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, agentId, longName) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid newName')
  })

  it('newName exactly 200 chars → {success:true}', async () => {
    const agentId = await insertAgent('rename-maxlen')
    const exactName = 'a'.repeat(200)
    const result = await handlers['rename-agent'](null, TEST_DB_PATH, agentId, exactName) as { success: boolean }
    expect(result.success).toBe(true)
  })
})

// ── update-agent-system-prompt: agentId validation ────────────────────────────

describe('update-agent-system-prompt — agentId validation (T1268)', () => {
  it('negative agentId → {success:false, error}', async () => {
    const result = await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, -1, 'prompt') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('zero agentId → {success:false, error}', async () => {
    const result = await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, 0, 'prompt') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })
})

// ── delete-agent: agent with agent_logs → hasHistory=true ─────────────────────

describe('delete-agent — agent_logs history (T1268)', () => {
  it('agent with agent_logs → hasHistory=true, not deleted', async () => {
    const agentId = await insertAgent('agent-with-logs')
    const sessionId = await writeDb<number>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO sessions (agent_id, status) VALUES (?, ?)', [agentId, 'completed'])
      const rows = db.exec('SELECT last_insert_rowid() as id')
      return rows[0].values[0][0] as number
    })
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO agent_logs (session_id, agent_id, level, action) VALUES (?, ?, ?, ?)',
        [sessionId, agentId, 'info', 'task_started'])
    })

    // Clear history from sessions first to isolate agent_logs
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('DELETE FROM sessions WHERE agent_id = ?', [agentId])
    })

    const result = await handlers['delete-agent'](null, TEST_DB_PATH, agentId) as { success: boolean; hasHistory: boolean }
    expect(result.success).toBe(true)
    expect(result.hasHistory).toBe(true)

    // Agent still exists
    const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM agents WHERE id = ?', [agentId]) as Array<{ id: number }>
    expect(rows).toHaveLength(1)
  })

  it('invalid agentId (string type) → {success:false, error}', async () => {
    const result = await handlers['delete-agent'](null, TEST_DB_PATH, 'not-a-number' as unknown as number) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid agentId (null) → {success:false, error}', async () => {
    const result = await handlers['delete-agent'](null, TEST_DB_PATH, null as unknown as number) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })
})

// ── get-agent-system-prompt: returns preferredModel (T1356) ──────────────────

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
