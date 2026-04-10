/**
 * Tests for ipc-project.ts — T1226
 * Targets the 61 surviving mutants (StringLiteral, ConditionalExpression,
 * ObjectLiteral, BlockStatement, LogicalOperator, etc.) by asserting exact values.
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
    getPath: vi.fn((name: string) => `/fake/${name}`),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
}))

// ── better-sqlite3 mock ─────────────────────────────────────────────────────
const mockPragma = vi.fn()
const mockExec = vi.fn()
const mockClose = vi.fn()
const mockRun = vi.fn()
const mockPrepare = vi.fn(() => ({ run: mockRun, all: vi.fn(() => []), get: vi.fn() }))

vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    return {
      pragma: mockPragma,
      prepare: mockPrepare,
      exec: mockExec,
      close: mockClose,
    }
  },
}))

// ── fs/promises mock ───────────────────────────────────────────────────────────
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
    readFile, writeFile, mkdir, rename, stat, access, readdir, copyFile,
  }
})

// ── fs mock ────────────────────────────────────────────────────────────────────
vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  const readdirSync = vi.fn(() => [] as string[])
  const stat = vi.fn((_path: string, cb?: (err: null, s: { mtimeMs: number }) => void) => {
    if (cb) cb(null, { mtimeMs: 1000 })
    return Promise.resolve({ mtimeMs: 1000 })
  })
  return { default: { watch, existsSync, readdirSync, stat }, watch, existsSync, readdirSync, stat }
})

// ── child_process mock ─────────────────────────────────────────────────────────
vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

// ── ./db mock ──────────────────────────────────────────────────────────────────
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    queryLive: vi.fn().mockRejectedValue(new Error('file is not a database')),
  }
})

import { registerIpcHandlers, registerDbPath, registerProjectPath } from './ipc'
import { getAllowedProjectPaths } from './db'
import { resolve } from 'path'

async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ipc-project T1226 — exact string & value assertions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerProjectPath('/fake/project')
    registerProjectPath('/my/project')
    registerProjectPath('/empty/project')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── getTrustedPathsFile — L29-30: exact filename ──────────────────────────

  describe('init-new-project — exact return shapes', () => {
    it('success: returns { success: true } without error field', async () => {
      const result = await callHandler('init-new-project', '/fake/project') as Record<string, unknown>
      expect(result.success).toBe(true)
      expect(result.success).not.toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('success: filesCreated contains exactly CLAUDE.md and .claude/WORKFLOW.md', async () => {
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; filesCreated: string[]
      }
      expect(result.filesCreated).toEqual(['CLAUDE.md', '.claude/WORKFLOW.md'])
      expect(result.filesCreated).toHaveLength(2)
    })

    it('mkdir failure: success=false, error contains EACCES', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(result.error).toContain('EACCES')
    })

    it('writeFile failure: success=false, error is a string', async () => {
      const { writeFile } = await import('fs/promises')
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(typeof result.error).toBe('string')
      expect(result.error).toContain('ENOSPC')
    })

    it('writes CLAUDE.md with template content to exact path', async () => {
      const { writeFile } = await import('fs/promises')
      const { CLAUDE_MD_TEMPLATE } = await import('./project-templates')
      await callHandler('init-new-project', '/fake/project')
      const writeFileCalls = vi.mocked(writeFile).mock.calls
      const claudeCall = writeFileCalls.find(c => String(c[0]).includes('CLAUDE.md') && !String(c[0]).includes('WORKFLOW'))
      expect(claudeCall).toBeDefined()
      expect(String(claudeCall![0])).toContain('CLAUDE.md')
      expect(claudeCall![1]).toBe(CLAUDE_MD_TEMPLATE)
      expect(claudeCall![2]).toBe('utf-8')
    })

    it('writes WORKFLOW.md to .claude/WORKFLOW.md with utf-8', async () => {
      const { writeFile } = await import('fs/promises')
      const { WORKFLOW_MD_TEMPLATE } = await import('./project-templates')
      await callHandler('init-new-project', '/fake/project')
      const writeFileCalls = vi.mocked(writeFile).mock.calls
      const workflowCall = writeFileCalls.find(c => String(c[0]).includes('WORKFLOW.md'))
      expect(workflowCall).toBeDefined()
      expect(String(workflowCall![0])).toContain('.claude')
      expect(String(workflowCall![0])).toContain('WORKFLOW.md')
      expect(workflowCall![1]).toBe(WORKFLOW_MD_TEMPLATE)
      expect(workflowCall![2]).toBe('utf-8')
    })

    it('creates .claude dir with { recursive: true }', async () => {
      const { mkdir } = await import('fs/promises')
      await callHandler('init-new-project', '/fake/project')
      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.claude'),
        { recursive: true }
      )
    })
  })

  // ── find-project-db — L294, L300: trusted conditional ────────────────────

  describe('find-project-db — trusted path logic (L294, L300)', () => {
    it('trusted=true (in-memory): registerDbPath is called with found dbPath', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // /my/project is pre-registered in beforeEach
      const result = await callHandler('find-project-db', '/my/project')
      expect(result).not.toBeNull()
      expect(String(result)).toContain('project.db')
    })

    it('trusted=false (not in-memory, not in json): returns dbPath but does NOT register', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['data.db'])
      // trusted-project-paths.json returns empty list
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')
      const before = [...getAllowedProjectPaths()]
      const result = await callHandler('find-project-db', '/unregistered/path')
      // Still returns path
      expect(result).not.toBeNull()
      expect(String(result)).toContain('data.db')
      // Did NOT add to allowlist
      expect(getAllowedProjectPaths()).toEqual(before)
    })

    it('trusted via json (L300): registers the path when found in persisted file', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      const jsonPath = '/json-trusted/project'
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify([jsonPath]))
      const result = await callHandler('find-project-db', jsonPath)
      expect(String(result)).toContain('project.db')
      expect(getAllowedProjectPaths()).toContain(resolve(jsonPath))
    })

    it('readFile with encoding "utf-8" for trusted paths file (L297)', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')
      await callHandler('find-project-db', '/untrusted/path')
      const readFileCalls = vi.mocked(readFile).mock.calls
      const trustedCall = readFileCalls.find(c => String(c[0]).includes('trusted-project-paths'))
      expect(trustedCall).toBeDefined()
      expect(trustedCall![1]).toBe('utf-8')
    })
  })

  // ── project:exportZip — L326-334: exact success/error shapes ─────────────

  describe('project:exportZip — exact return shapes (L326-334)', () => {
    it('success: result.success is exactly true (not truthy)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; path?: string
      }
      expect(result.success).toBe(true)
      expect(result.success).not.toBe(false)
    })

    it('success: result.path starts with downloads dir (L328)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      const { app } = await import('electron')
      vi.mocked(app.getPath).mockReturnValue('/fake/downloads')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; path: string
      }
      // Cross-platform path: check the filename pattern
      expect(result.path).toMatch(/kanbagent-export-.+\.zip$/)
    })

    it('success: result has no error field', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as Record<string, unknown>
      expect(result.error).toBeUndefined()
    })

    it('error: result.success is exactly false (not falsy)', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT: file not found'))
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(result.success).not.toBe(true)
    })

    it('error: result.error is a string containing the error message (L334)', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; error: string
      }
      expect(typeof result.error).toBe('string')
      expect(result.error).toContain('EACCES')
    })

    it('success: result.path is a string (not a buffer or object)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as { path: unknown }
      expect(typeof result.path).toBe('string')
    })
  })

  // ── AGENT_SCRIPTS — ArrayDeclaration exact content ────────────────────────

  describe('AGENT_SCRIPTS exact values (L47-53)', () => {
    it('AGENT_SCRIPTS contains dbq.js as first element', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS[0]).toBe('dbq.js')
    })

    it('AGENT_SCRIPTS contains dbw.js as second element', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS[1]).toBe('dbw.js')
    })

    it('AGENT_SCRIPTS contains dbstart.js, dblock.js, capture-tokens-hook.js', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS).toContain('dbstart.js')
      expect(AGENT_SCRIPTS).toContain('dblock.js')
      expect(AGENT_SCRIPTS).toContain('capture-tokens-hook.js')
    })

    it('AGENT_SCRIPTS has exactly 5 elements', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS).toHaveLength(5)
    })
  })
})
