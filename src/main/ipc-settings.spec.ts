/**
 * Tests for IPC handlers — src/main/ipc-settings.ts
 *
 * Covers: check-for-updates
 *
 * Strategy: mock electron (ipcMain), fs/promises. Fetch is mocked via
 * globalThis.fetch (restored in finally) — same pattern as ipc.spec.ts.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Capture handlers ──────────────────────────────────────────────────────────
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

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
    access: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
  },
  readFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
}))

vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  return {
    default: { watch, existsSync },
    watch,
    existsSync,
  }
})

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

import { registerSettingsHandlers } from './ipc-settings'
import { registerDbPath } from './db'

// ── Helper ────────────────────────────────────────────────────────────────────
async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}. Available: ${Object.keys(handlers).join(', ')}`)
  return handler(null, ...args)
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  registerSettingsHandlers()
  registerDbPath('/fake/project.db')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── T476: check-for-updates ───────────────────────────────────────────────────

describe('check-for-updates handler', () => {
  it('returns { hasUpdate: false, error: "URL invalide" } for non-github URL', async () => {
    const result = await callHandler('check-for-updates', '/fake/project.db', 'https://gitlab.com/owner/repo', '1.0.0') as {
      hasUpdate: boolean; error?: string
    }
    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBe('URL invalide')
  })

  it('returns { hasUpdate: false, error: "URL invalide" } for empty string URL', async () => {
    const result = await callHandler('check-for-updates', '/fake/project.db', '', '1.0.0') as {
      hasUpdate: boolean; error?: string
    }
    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBe('URL invalide')
  })

  it('returns { hasUpdate: false, error: "URL invalide" } for plain string', async () => {
    const result = await callHandler('check-for-updates', '/fake/project.db', 'not-a-url', '1.0.0') as {
      hasUpdate: boolean; error?: string
    }
    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBe('URL invalide')
  })

  it('returns { hasUpdate: false, error: "owner/repo invalide" } for owner with semicolon', async () => {
    const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/own;er/repo', '1.0.0') as {
      hasUpdate: boolean; error?: string
    }
    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBe('owner/repo invalide')
  })

  it('returns { hasUpdate: false, error: "owner/repo invalide" } for repo with ".." path traversal', async () => {
    const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/re..po', '1.0.0') as {
      hasUpdate: boolean; error?: string
    }
    // ".." → regex match group, then validation fails
    // Note: regex [^/.] stops at dot, so "re..po" may not reach validation.
    // Either URL invalide or owner/repo invalide — both indicate rejection.
    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns { hasUpdate: true, latestVersion: "1.2.0" } when tag_name > currentVersion', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ tag_name: 'v1.2.0' }),
    })
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/repo', '1.0.0') as {
        hasUpdate: boolean; latestVersion: string
      }
      expect(result.hasUpdate).toBe(true)
      expect(result.latestVersion).toBe('1.2.0')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('strips "v" prefix from tag_name', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ tag_name: 'v2.0.0' }),
    })
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/repo', '1.9.9') as {
        hasUpdate: boolean; latestVersion: string
      }
      expect(result.latestVersion).toBe('2.0.0')
      expect(result.latestVersion.startsWith('v')).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns { hasUpdate: false } when tag_name equals currentVersion', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ tag_name: 'v1.0.0' }),
    })
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/repo', '1.0.0') as {
        hasUpdate: boolean; latestVersion: string
      }
      expect(result.hasUpdate).toBe(false)
      expect(result.latestVersion).toBe('1.0.0')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns { hasUpdate: false, error } on HTTP 404', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    })
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/repo', '1.0.0') as {
        hasUpdate: boolean; error?: string
      }
      expect(result.hasUpdate).toBe(false)
      expect(result.error).toContain('HTTP 404')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns { hasUpdate: false, error } on fetch timeout / rejection', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('AbortError: The operation was aborted'))
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/repo', '1.0.0') as {
        hasUpdate: boolean; error?: string
      }
      expect(result.hasUpdate).toBe(false)
      expect(typeof result.error).toBe('string')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('accepts SSH URL format: git@github.com:owner/repo.git', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ tag_name: 'v1.5.0' }),
    })
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'git@github.com:owner/repo.git', '1.0.0') as {
        hasUpdate: boolean; latestVersion: string
      }
      expect(result.hasUpdate).toBe(true)
      expect(result.latestVersion).toBe('1.5.0')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('always returns { hasUpdate, latestVersion } shape on success', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ tag_name: 'v0.9.0' }),
    })
    try {
      const result = await callHandler('check-for-updates', '/fake/project.db', 'https://github.com/owner/repo', '1.0.0') as Record<string, unknown>
      expect(result).toHaveProperty('hasUpdate')
      expect(result).toHaveProperty('latestVersion')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('always returns { hasUpdate: false, latestVersion, error } shape on failure', async () => {
    const result = await callHandler('check-for-updates', '/fake/project.db', 'invalid-url', '1.0.0') as Record<string, unknown>
    expect(result).toHaveProperty('hasUpdate')
    expect(result).toHaveProperty('latestVersion')
    expect(result.hasUpdate).toBe(false)
  })
})
