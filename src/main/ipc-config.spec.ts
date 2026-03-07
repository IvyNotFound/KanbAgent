/**
 * Tests for config/misc IPC handlers — get-config-value, set-config-value,
 * update-perimetre, build-agent-prompt, search-tasks, close-agent-sessions,
 * rename-agent, update-agent-system-prompt, get-agent-system-prompt,
 * update-agent-thinking-mode, update-agent, session:setConvId, create-agent.
 *
 * Migrated from ipc.spec.ts (T851).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Electron mock ──────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: {
    getVersion: vi.fn(() => '0.3.0'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/fake/app'),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
}))

// ── sql.js mock ────────────────────────────────────────────────────────────────
vi.mock('sql.js', () => ({
  default: vi.fn().mockResolvedValue({
    Database: vi.fn(() => ({
      prepare: vi.fn(() => ({ bind: vi.fn(), step: vi.fn(() => false), getAsObject: vi.fn(() => ({})), free: vi.fn() })),
      exec: vi.fn(() => []),
      run: vi.fn(),
      export: vi.fn(() => new Uint8Array([1, 2, 3])),
      close: vi.fn(),
      getRowsModified: vi.fn(() => 0),
    })),
  }),
}))

// ── fs mock ────────────────────────────────────────────────────────────────────
vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  const readdirSync = vi.fn(() => [] as string[])
  const stat = vi.fn((_path: string, cb?: (err: null, stat: { mtimeMs: number }) => void) => {
    if (cb) cb(null, { mtimeMs: 1000 })
    return Promise.resolve({ mtimeMs: 1000 })
  })
  return {
    default: { watch, existsSync, readdirSync, stat },
    watch,
    existsSync,
    readdirSync,
    stat,
  }
})

vi.mock('fs/promises', () => {
  const readFile = vi.fn().mockResolvedValue(Buffer.from('file content', 'utf-8'))
  const writeFile = vi.fn().mockResolvedValue(undefined)
  const mkdir = vi.fn().mockResolvedValue(undefined)
  const rename = vi.fn().mockResolvedValue(undefined)
  const stat = vi.fn().mockResolvedValue({ mtimeMs: 1000 })
  const access = vi.fn().mockResolvedValue(undefined)
  const readdir = vi.fn().mockResolvedValue([] as string[])
  const copyFile = vi.fn().mockResolvedValue(undefined)
  return {
    default: { readFile, writeFile, mkdir, rename, stat, access, readdir, copyFile },
    readFile,
    writeFile,
    mkdir,
    rename,
    stat,
    access,
    readdir,
    copyFile,
  }
})

// ── child_process mock ────────────────────────────────────────────────────────
vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

// ── T552: mock ./db to intercept queryLive ────────────────────────────────────
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    queryLive: vi.fn().mockRejectedValue(new Error('file is not a database')),
  }
})
import { queryLive as mockedQueryLive } from './db'

// ── Import ipc.ts AFTER mocks ─────────────────────────────────────────────────
import { registerIpcHandlers, registerDbPath, registerProjectPath } from './ipc'

// Helper to call a captured handler
async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}. Available: ${Object.keys(handlers).join(', ')}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IPC config/misc handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockedQueryLive).mockRejectedValue(new Error('file is not a database'))
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerDbPath('/fake/db')
    registerProjectPath('/fake/project')
    registerProjectPath('/home/user/project')
    registerProjectPath('/allowed')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── get-config-value ───────────────────────────────────────────────────────

  describe('get-config-value handler', () => {
    it('should return { success: false } when dbPath does not exist', async () => {
      const result = await callHandler('get-config-value', '/nonexistent/db.sqlite', 'some_key') as { success: boolean; value: unknown }
      expect(result.success).toBe(false)
    })

    it('should return { success, value } shape', async () => {
      const result = await callHandler('get-config-value', '/nonexistent/db.sqlite', 'claude_md_commit') as { success: boolean; value: unknown; error?: string }
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('value')
    })
  })

  // ── set-config-value ───────────────────────────────────────────────────────

  describe('set-config-value handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('set-config-value', '/fake/project.db', 'key', 'value') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('set-config-value', '/invalid/db', 'key', 'value')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── update-perimetre ───────────────────────────────────────────────────────

  describe('update-perimetre handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-perimetre', '/fake/project.db', 1, 'old-name', 'new-name', 'desc') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-perimetre', '/invalid/db', 1, 'old', 'new', 'desc')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── build-agent-prompt ────────────────────────────────────────────────────

  describe('build-agent-prompt handler', () => {
    it('should return the trimmed userPrompt when no dbPath provided', async () => {
      const result = await callHandler('build-agent-prompt', 'dev-front', 'Tu es dev') as string
      expect(typeof result).toBe('string')
      expect(result).toBe('Tu es dev')
    })

    it('should return empty string when userPrompt is empty and no dbPath provided', async () => {
      const result = await callHandler('build-agent-prompt', 'dev-front', '') as string
      expect(result).toBe('')
    })
  })

  // ── search-tasks ──────────────────────────────────────────────────────────

  describe('search-tasks handler', () => {
    it('should return { success: false } when dbPath is invalid (no such file)', async () => {
      const result = await callHandler('search-tasks', '/nonexistent/db.sqlite', '') as { success: boolean; results: unknown[] }
      expect(result).toMatchObject({ success: false, results: [] })
    })

    it('should return { success: false } with results array on DB error', async () => {
      const result = await callHandler('search-tasks', '/nonexistent/db.sqlite', 'my task') as { success: boolean; results: unknown[] }
      expect(result.success).toBe(false)
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── close-agent-sessions ──────────────────────────────────────────────────

  describe('close-agent-sessions handler', () => {
    it('should return { success, error } shape', async () => {
      const result = await callHandler('close-agent-sessions', '/fake/project.db', 'dev-front') as { success: boolean; error?: string }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('close-agent-sessions', '/invalid/db', 'dev-front')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── rename-agent ──────────────────────────────────────────────────────────

  describe('rename-agent handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('rename-agent', '/fake/project.db', 1, 'new-name') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('rename-agent', '/invalid/db', 1, 'new-name')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── update-agent-system-prompt ────────────────────────────────────────────

  describe('update-agent-system-prompt handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-agent-system-prompt', '/fake/project.db', 1, 'My prompt') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-agent-system-prompt', '/invalid/db', 1, 'prompt')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── get-agent-system-prompt ───────────────────────────────────────────────

  describe('get-agent-system-prompt handler', () => {
    it('should return { success: false, systemPrompt: null } shape on DB error', async () => {
      const result = await callHandler('get-agent-system-prompt', '/fake/project.db', 99) as {
        success: boolean; systemPrompt: unknown; systemPromptSuffix: unknown; thinkingMode: unknown
      }
      expect(result.success).toBe(false)
      expect(result.systemPrompt).toBeNull()
      expect(result.systemPromptSuffix).toBeNull()
      expect(result.thinkingMode).toBeNull()
    })

    it('should always return { success, systemPrompt, systemPromptSuffix, thinkingMode } shape', async () => {
      const result = await callHandler('get-agent-system-prompt', '/fake/project.db', 1) as Record<string, unknown>
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('systemPrompt')
      expect(result).toHaveProperty('systemPromptSuffix')
      expect(result).toHaveProperty('thinkingMode')
    })
  })

  // ── update-agent-thinking-mode ────────────────────────────────────────────

  describe('update-agent-thinking-mode handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/fake/project.db', 1, 'auto') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/invalid/db', 1, 'disabled')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })

    it('should reject budget_tokens as an invalid thinking mode', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/fake/project.db', 1, 'budget_tokens') as { success: boolean; error: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('budget_tokens') })
    })

    it('should accept null as a valid thinking mode (reset to default)', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/fake/project.db', 1, null) as { success: boolean }
      expect(result).toHaveProperty('success')
    })
  })

  // ── update-agent ──────────────────────────────────────────────────────────

  describe('update-agent handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-agent', '/fake/project.db', 1, { name: 'new-name' }) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-agent', '/invalid/db', 1, { name: 'new-name' })
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })

    it('should return { success: true } when updates is empty (T477 — cols.length guard)', async () => {
      const result = await callHandler('update-agent', '/fake/project.db', 1, {}) as { success: boolean }
      expect(result).toMatchObject({ success: true })
    })

    it('should return { success: false, error } for invalid maxSessions (T477)', async () => {
      const result = await callHandler('update-agent', '/fake/project.db', 1, { maxSessions: 0 }) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('maxSessions') })
    })
  })

  // ── session:setConvId ─────────────────────────────────────────────────────

  describe('session:setConvId handler', () => {
    const validConvId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

    it('should return { success: false, error: Invalid arguments } when convId is empty', async () => {
      const result = await callHandler('session:setConvId', '/fake/db', 1, '')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid arguments') })
    })

    it('should return { success: false, error: Invalid arguments } when agentId is not a number', async () => {
      const result = await callHandler('session:setConvId', '/fake/db', 'not-a-number', validConvId)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid arguments') })
    })

    it('should return { success: false, error: Invalid arguments } when dbPath is falsy', async () => {
      const result = await callHandler('session:setConvId', '', 1, validConvId)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid arguments') })
    })

    it('should return { success, error? } shape for valid args', async () => {
      const result = await callHandler('session:setConvId', '/fake/project.db', 1, validConvId) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('session:setConvId', '/invalid/db', 1, validConvId)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── create-agent ──────────────────────────────────────────────────────────

  describe('create-agent handler', () => {
    const dbPath = '/fake/project.db'
    const projectPath = '/fake/project'
    const agentData = {
      name: 'my-new-agent',
      type: 'dev',
      scope: 'back-electron',
      thinkingMode: 'auto',
      systemPrompt: 'Be helpful',
      description: 'Mon agent de test'
    }

    it('should return { success, error? } shape', async () => {
      const result = await callHandler('create-agent', dbPath, projectPath, agentData) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when readFile throws (ENOENT)', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
      const result = await callHandler('create-agent', dbPath, projectPath, agentData)
      expect(result).toMatchObject({ success: false })
    })
  })

  // ── agent:duplicate ───────────────────────────────────────────────────────

  describe('agent:duplicate handler', () => {
    it('should return { success: false, error: "Invalid agentId" } when agentId is a string (T473)', async () => {
      const result = await callHandler('agent:duplicate', '/fake/project.db', 'not-a-number') as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
    })

    it('should return { success: false, error: "Invalid agentId" } when agentId is a float (T473)', async () => {
      const result = await callHandler('agent:duplicate', '/fake/project.db', 1.5) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
    })

    it('should return { success: false, error } when dbPath is not registered (T473)', async () => {
      const result = await callHandler('agent:duplicate', '/invalid/db', 1)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── task:getAssignees ─────────────────────────────────────────────────────

  describe('task:getAssignees handler', () => {
    it('should return { success: false, assignees: [], error } when taskId is not an integer', async () => {
      const result = await callHandler('task:getAssignees', '/fake/project.db', 'abc') as {
        success: boolean; assignees: unknown[]; error?: string
      }
      expect(result).toMatchObject({ success: false, assignees: [], error: 'Invalid taskId' })
    })

    it('should return { success: false, assignees: [], error } when taskId is a float', async () => {
      const result = await callHandler('task:getAssignees', '/fake/project.db', 1.5) as {
        success: boolean; assignees: unknown[]; error?: string
      }
      expect(result).toMatchObject({ success: false, assignees: [], error: 'Invalid taskId' })
    })

    it('should return { success: false, assignees: [] } when dbPath does not exist (DB error)', async () => {
      const result = await callHandler('task:getAssignees', '/nonexistent/db.sqlite', 1) as {
        success: boolean; assignees: unknown[]
      }
      expect(result.success).toBe(false)
      expect(Array.isArray(result.assignees)).toBe(true)
      expect(result.assignees).toHaveLength(0)
    })

    it('should always return { success, assignees } shape', async () => {
      const result = await callHandler('task:getAssignees', '/nonexistent/db.sqlite', 99) as Record<string, unknown>
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('assignees')
    })
  })

  // ── task:setAssignees ─────────────────────────────────────────────────────

  describe('task:setAssignees handler', () => {
    it('should return { success: false, error: Invalid taskId } when taskId is not an integer', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 'xyz', []) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'Invalid taskId' })
    })

    it('should return { success: false, error: Invalid taskId } when taskId is a float', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 2.7, []) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'Invalid taskId' })
    })

    it('should return { success: false, error } when assignees is not an array', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, 'not-array') as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'assignees must be an array' })
    })

    it('should return { success: false, error } when assignees is null', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, null) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'assignees must be an array' })
    })

    it('should return { success: false, error: Invalid role } when role is not allowed', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
        { agentId: 1, role: 'admin' }
      ]) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid role') })
      expect(result.error).toContain('admin')
    })

    it('should return { success: false, error: Invalid agentId } when agentId is not an integer', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
        { agentId: 'foo', role: 'primary' }
      ]) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid agentId') })
    })

    it('should accept null role without validation error', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
        { agentId: 1, role: null }
      ]) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('task:setAssignees', '/invalid/db', 1, []) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })

    it('should return { success, error? } shape for valid args (registered dbPath)', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, []) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should accept valid roles: primary, support, reviewer', async () => {
      for (const role of ['primary', 'support', 'reviewer'] as const) {
        const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
          { agentId: 1, role }
        ]) as { success: boolean; error?: string }
        if (!result.success && result.error) {
          expect(result.error).not.toContain('Invalid role')
        }
      }
    })
  })

  // ── tasks:getArchived ─────────────────────────────────────────────────────

  describe('tasks:getArchived handler', () => {
    it('should throw DB_PATH_NOT_ALLOWED when dbPath is not registered', async () => {
      await expect(
        callHandler('tasks:getArchived', '/unregistered/evil.db', { page: 0, pageSize: 10 })
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should throw when dbPath is registered but DB buffer is invalid (queryLive)', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10 })
      ).rejects.toThrow()
    })

    it('should throw when agentId filter is provided', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, agentId: 42 })
      ).rejects.toThrow()
    })

    it('should throw when perimetre filter is provided', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, perimetre: 'back-electron' })
      ).rejects.toThrow()
    })
  })

  // ── tasks:updateStatus ────────────────────────────────────────────────────

  describe('tasks:updateStatus handler', () => {
    it('should throw DB_PATH_NOT_ALLOWED when dbPath is not registered', async () => {
      await expect(
        callHandler('tasks:updateStatus', '/unregistered/evil.db', 1, 'done')
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: false, error } for unknown status', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, 'invalid-status') as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid status: invalid-status') })
    })

    it('should return { success: false, error } for empty string status', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, '') as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid status:') })
    })

    it('should return { success: false } for null status (not in ALLOWED list)', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, null) as {
        success: boolean
      }
      expect(result.success).toBe(false)
    })

    it('should accept all four valid statuses without validation error', async () => {
      const validStatuses = ['todo', 'in_progress', 'done', 'archived'] as const
      for (const status of validStatuses) {
        const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, status) as {
          success: boolean; error?: string
        }
        if (!result.success && result.error) {
          expect(result.error).not.toContain('Invalid status')
        }
      }
    })

    it('T552: should return TASK_BLOCKED when unresolved blockers exist (type bloque)', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([
        { id: 42, title: 'Blocker task', status: 'in_progress' },
      ])
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 10, 'in_progress') as {
        success: boolean; error?: string; blockers?: Array<{ id: number; title: string; status: string }>
      }
      expect(result).toMatchObject({ success: false, error: 'TASK_BLOCKED' })
      expect(result.blockers).toHaveLength(1)
      expect(result.blockers?.[0]).toMatchObject({ id: 42, title: 'Blocker task', status: 'in_progress' })
    })

    it('T552: should allow in_progress when no blockers exist', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 10, 'in_progress') as {
        success: boolean; error?: string
      }
      if (!result.success && result.error) {
        expect(result.error).not.toBe('TASK_BLOCKED')
      }
    })

    it('T552: should return TASK_BLOCKED with multiple blockers', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([
        { id: 10, title: 'Dep A', status: 'todo' },
        { id: 11, title: 'Dep B', status: 'in_progress' },
      ])
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 20, 'in_progress') as {
        success: boolean; error?: string; blockers?: Array<{ id: number; title: string; status: string }>
      }
      expect(result).toMatchObject({ success: false, error: 'TASK_BLOCKED' })
      expect(result.blockers).toHaveLength(2)
    })

    it('T552: should not check blockers for status other than in_progress', async () => {
      const qSpy = vi.mocked(mockedQueryLive)
      await callHandler('tasks:updateStatus', '/fake/project.db', 10, 'done')
      expect(qSpy).not.toHaveBeenCalled()
    })
  })

  // ── sessions:statsCost ────────────────────────────────────────────────────

  describe('sessions:statsCost handler (T768)', () => {
    it('should throw DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
      await expect(
        callHandler('sessions:statsCost', '/unregistered/evil.db', { period: 'day' })
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: false, error: INVALID_PERIOD } for unknown period', async () => {
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'hour' }) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_PERIOD' })
    })

    it('should return { success: false, error: INVALID_PERIOD } when period is missing', async () => {
      const result = await callHandler('sessions:statsCost', '/fake/project.db', {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_PERIOD' })
    })

    it('should return { success: true, rows } when queryLive succeeds for day period', async () => {
      const mockRows = [
        { agent_name: 'dev-back-electron', agent_id: 3, period: '2026-03-04', session_count: 2, total_cost: 0.0025, avg_duration_s: 30.5, total_turns: 10, total_tokens: 5000, cache_read: 1200, cache_write: 300 },
      ]
      vi.mocked(mockedQueryLive).mockResolvedValueOnce(mockRows)
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'day' }) as { success: boolean; rows: unknown[] }
      expect(result).toMatchObject({ success: true, rows: mockRows })
    })

    it('should return { success: true, rows } for week and month periods', async () => {
      for (const period of ['week', 'month'] as const) {
        vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
        const result = await callHandler('sessions:statsCost', '/fake/project.db', { period }) as { success: boolean; rows: unknown[] }
        expect(result).toMatchObject({ success: true, rows: [] })
      }
    })

    it('should return { success: false, error } when queryLive throws', async () => {
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'day' }) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.any(String) })
    })
  })

  // ── session:updateResult ──────────────────────────────────────────────────

  describe('session:updateResult handler (T777)', () => {
    it('should return INVALID_SESSION_ID for sessionId = 0', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', 0, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should return INVALID_SESSION_ID for sessionId = -1', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', -1, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should return INVALID_SESSION_ID for sessionId = 1.5 (float)', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', 1.5, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should return INVALID_SESSION_ID for sessionId = NaN', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', NaN, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should throw DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
      await expect(
        callHandler('session:updateResult', '/unregistered/evil.db', 1, {})
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: false, error } when writeDb throws (mock sql.js buffer)', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', 1, { cost_usd: 0.01 }) as { success: boolean; error?: string }
      expect(result).toHaveProperty('success')
      if (!result.success) {
        expect(result.error).toBeDefined()
      }
    })
  })

})
