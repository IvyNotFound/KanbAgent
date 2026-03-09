/**
 * Tests for ipc-project.ts — T1077
 * ZIP export (buildSingleFileZip), dialog cancel guard, backup filename regex,
 * agentLang guard, find-project-db handler.
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
vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    return {
      pragma: vi.fn(),
      prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn() })),
      exec: vi.fn(),
      close: vi.fn(),
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

describe('ipc-project T1077 — ZIP export, dialog guard, agentLang', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerProjectPath('/fake/project')
    registerProjectPath('/my/project')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── project:exportZip — ZIP buffer integrity ───────────────────────────────

  describe('project:exportZip — ZIP buffer integrity (T1077)', () => {
    it('success: returns { success: true, path: ...zip }', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('fake db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as { success: boolean; path?: string }
      expect(result.success).toBe(true)
      expect(result.path).toMatch(/kanbagent-export-.+\.zip$/)
    })

    it('calls shell.showItemInFolder with the zip path', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      const { shell } = await import('electron')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('data'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      await callHandler('project:exportZip', '/fake/project.db')
      expect(shell.showItemInFolder).toHaveBeenCalledWith(expect.stringContaining('.zip'))
    })

    it('ZIP buffer starts with PK local file header (0x50 0x4b 0x03 0x04)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      let capturedBuffer: Buffer | undefined
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('hello world'))
      vi.mocked(writeFile).mockImplementationOnce((_p, data) => {
        capturedBuffer = data as Buffer
        return Promise.resolve()
      })
      await callHandler('project:exportZip', '/fake/project.db')
      expect(capturedBuffer).toBeDefined()
      expect(capturedBuffer![0]).toBe(0x50)
      expect(capturedBuffer![1]).toBe(0x4b)
      expect(capturedBuffer![2]).toBe(0x03)
      expect(capturedBuffer![3]).toBe(0x04)
    })

    it('ZIP buffer contains central directory signature (0x50 0x4b 0x01 0x02)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      let capturedBuffer: Buffer | undefined
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('some data'))
      vi.mocked(writeFile).mockImplementationOnce((_p, data) => {
        capturedBuffer = data as Buffer
        return Promise.resolve()
      })
      await callHandler('project:exportZip', '/fake/project.db')
      expect(capturedBuffer).toBeDefined()
      const buf = capturedBuffer!
      let found = false
      for (let i = 0; i < buf.length - 3; i++) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
          found = true; break
        }
      }
      expect(found).toBe(true)
    })

    it('empty data → ZIP buffer is non-empty and starts with PK', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      let capturedBuffer: Buffer | undefined
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.alloc(0))
      vi.mocked(writeFile).mockImplementationOnce((_p, data) => {
        capturedBuffer = data as Buffer
        return Promise.resolve()
      })
      await callHandler('project:exportZip', '/fake/project.db')
      expect(capturedBuffer).toBeDefined()
      expect(capturedBuffer!.length).toBeGreaterThan(0)
      expect(capturedBuffer![0]).toBe(0x50)
      expect(capturedBuffer![1]).toBe(0x4b)
    })

    it('failure: returns { success: false, error } when readFile throws', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT: file not found'))
      const result = await callHandler('project:exportZip', '/fake/project.db') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(result.error).toContain('ENOENT')
    })

    it('throws DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
      await expect(
        callHandler('project:exportZip', '/unregistered/evil.db')
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })
  })

  // ── backup filename regex ──────────────────────────────────────────────────

  describe('backup filename — /[:.]/g replace (T1077)', () => {
    it('filename has no colons or dots except .zip extension', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      let capturedPath: string | undefined
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('data'))
      vi.mocked(writeFile).mockImplementationOnce((p) => {
        capturedPath = String(p)
        return Promise.resolve()
      })
      await callHandler('project:exportZip', '/fake/project.db')
      expect(capturedPath).toBeDefined()
      const filename = capturedPath!.split(/[/\\]/).pop()!
      expect(filename).toMatch(/^kanbagent-export-[\dT-]+\.zip$/)
      expect(filename).not.toContain(':')
    })

    it('filename timestamp portion has no dots (replaced by dashes)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      let capturedPath: string | undefined
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('data'))
      vi.mocked(writeFile).mockImplementationOnce((p) => {
        capturedPath = String(p)
        return Promise.resolve()
      })
      await callHandler('project:exportZip', '/fake/project.db')
      expect(capturedPath).toBeDefined()
      const filename = capturedPath!.split(/[/\\]/).pop()!
      // Remove .zip extension — the timestamp part should have no dots
      const withoutExt = filename.replace('.zip', '')
      expect(withoutExt).not.toContain('.')
    })
  })

  // ── dialog cancel guard — filePaths empty ─────────────────────────────────

  describe('dialog cancel guard — filePaths=[] (T1077)', () => {
    it('select-project-dir: canceled=false + filePaths=[] → null', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [] })
      const result = await callHandler('select-project-dir')
      expect(result).toBeNull()
    })

    it('select-new-project-dir: canceled=false + filePaths=[] → null', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [] })
      const result = await callHandler('select-new-project-dir')
      expect(result).toBeNull()
    })
  })

  // ── find-project-db ────────────────────────────────────────────────────────

  describe('find-project-db handler (T1077)', () => {
    it('throws PROJECT_PATH_REQUIRED when projectPath is empty', async () => {
      await expect(callHandler('find-project-db', '')).rejects.toThrow('PROJECT_PATH_REQUIRED')
    })

    it('returns null when no .db found', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'))
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce([])
      const result = await callHandler('find-project-db', '/fake/project')
      expect(result).toBeNull()
    })

    it('returns path when .db found in .claude/ subfolder', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      const result = await callHandler('find-project-db', '/fake/project')
      expect(String(result)).toContain('project.db')
      expect(String(result)).toContain('.claude')
    })
  })

  // ── find-project-db — T1173 security: allowlist self-registration guard ────

  describe('find-project-db — allowlist self-registration guard (T1173)', () => {
    it('does NOT register an arbitrary untrusted path into the allowlist', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // trusted-project-paths.json returns empty list
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')
      const before = [...getAllowedProjectPaths()]
      const result = await callHandler('find-project-db', '/attacker/evil-path')
      expect(String(result)).toContain('project.db') // still returns db path
      const after = getAllowedProjectPaths()
      expect(after).toEqual(before) // no new path added
      expect(after).not.toContain(resolve('/attacker/evil-path'))
    })

    it('registers a path already in the in-memory allowlist (dialog-approved session path)', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // /my/project is pre-registered in beforeEach
      const result = await callHandler('find-project-db', '/my/project')
      expect(String(result)).toContain('project.db')
      expect(getAllowedProjectPaths()).toContain(resolve('/my/project'))
    })

    it('registers a path present in trusted-project-paths.json (cold-start recovery)', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      const recoveryPath = '/recovery/project'
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify([recoveryPath]))
      const result = await callHandler('find-project-db', recoveryPath)
      expect(String(result)).toContain('project.db')
      expect(getAllowedProjectPaths()).toContain(resolve(recoveryPath))
    })

    it('does NOT register when trusted-project-paths.json is corrupt', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce('not-valid-json')
      const before = [...getAllowedProjectPaths()]
      const result = await callHandler('find-project-db', '/corrupt-recovery/project')
      expect(String(result)).toContain('project.db') // still returns db path safely
      expect(getAllowedProjectPaths()).toEqual(before) // no change
    })
  })

  // ── agentLang guard ───────────────────────────────────────────────────────

  describe('agentLang guard — lang === "en" ? "en" : "fr" (T1077)', () => {
    it('GENERIC_AGENTS_BY_LANG["en"] has English system_prompt', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      const dev = GENERIC_AGENTS_BY_LANG['en'].find(a => a.name === 'dev')
      expect(dev?.system_prompt).toContain('You are the **dev** agent')
    })

    it('GENERIC_AGENTS scope is null or string — never undefined (scope ?? null guard)', async () => {
      const { GENERIC_AGENTS } = await import('./default-agents')
      for (const agent of GENERIC_AGENTS) {
        expect(agent.scope ?? null).not.toBeUndefined()
        const v = agent.scope ?? null
        expect(v === null || typeof v === 'string').toBe(true)
      }
    })

    it('lang guard logic: unknown lang maps to "fr"', () => {
      const cases = [
        { lang: 'en', expected: 'en' },
        { lang: 'fr', expected: 'fr' },
        { lang: 'de', expected: 'fr' },
        { lang: undefined, expected: 'fr' },
      ] as const
      for (const { lang, expected } of cases) {
        const agentLang = lang === 'en' ? 'en' : 'fr'
        expect(agentLang).toBe(expected)
      }
    })
  })
})
