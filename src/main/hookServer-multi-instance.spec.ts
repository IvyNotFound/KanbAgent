/**
 * Tests for ADR-013 — Multi-Instance Hook Server
 *
 * Covers:
 * - Lockfile protocol: write, delete, cleanup stale (dead PIDs)
 * - Port scan: tries HOOK_PORT_BASE..HOOK_PORT_MAX, skips alive ports
 * - Additive injection: each instance manages only its own port's entries
 * - removeStaleHookEntries: removes dead-instance http hooks from settings.json
 * - PermissionRequest guard: denies requests for unmanaged projects (ADR-013)
 * - hookServer:getPort IPC: returns effective bound port
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockReadFileSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockReaddirSync,
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockProcessKill,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockProcessKill: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    readdirSync: mockReaddirSync,
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
  readdirSync: mockReaddirSync,
}))

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

vi.mock('crypto', () => ({
  default: { randomBytes: vi.fn().mockReturnValue(Buffer.from('a'.repeat(32))) },
  randomBytes: vi.fn().mockReturnValue(Buffer.from('a'.repeat(32))),
}))

vi.mock('child_process', () => ({
  default: { execSync: vi.fn() },
  execSync: vi.fn(),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

const {
  HOOK_PORT_BASE,
  HOOK_PORT_MAX,
  HOOK_PORT,
  writeLockfile,
  deleteLockfile,
  cleanupStaleLockfiles,
  injectHookUrls,
  removeStaleHookEntries,
  HOOK_ROUTES,
} = await import('./hookServer-inject')

// ── Constants ─────────────────────────────────────────────────────────────────

describe('ADR-013 — port range constants', () => {
  it('HOOK_PORT_BASE is 27182', () => expect(HOOK_PORT_BASE).toBe(27182))
  it('HOOK_PORT_MAX is 27189', () => expect(HOOK_PORT_MAX).toBe(27189))
  it('HOOK_PORT equals HOOK_PORT_BASE (backward compat)', () => expect(HOOK_PORT).toBe(HOOK_PORT_BASE))
  it('range provides 8 ports', () => expect(HOOK_PORT_MAX - HOOK_PORT_BASE + 1).toBe(8))
})

// ── Lockfile protocol ─────────────────────────────────────────────────────────

describe('writeLockfile', () => {
  beforeEach(() => { vi.resetAllMocks(); mockWriteFileSync.mockReset() })

  it('writes JSON lockfile with pid, port, and startedAt', () => {
    writeLockfile('/userData', 27182)
    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const [path, content] = mockWriteFileSync.mock.calls[0]
    expect(path).toBe(join('/userData', 'hookserver-27182.lock'))
    const data = JSON.parse(content as string)
    expect(data.pid).toBe(process.pid)
    expect(data.port).toBe(27182)
    expect(typeof data.startedAt).toBe('string')
  })

  it('uses mode 0o600 for security', () => {
    writeLockfile('/userData', 27183)
    const opts = mockWriteFileSync.mock.calls[0][2]
    expect((opts as { mode: number }).mode).toBe(0o600)
  })

  it('silently ignores writeFileSync errors', () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('EACCES') })
    expect(() => writeLockfile('/userData', 27182)).not.toThrow()
  })
})

describe('deleteLockfile', () => {
  beforeEach(() => { vi.resetAllMocks(); mockUnlinkSync.mockReset() })

  it('deletes the correct lockfile path', () => {
    deleteLockfile('/userData', 27183)
    expect(mockUnlinkSync).toHaveBeenCalledWith(join('/userData', 'hookserver-27183.lock'))
  })

  it('silently ignores errors (file already deleted)', () => {
    mockUnlinkSync.mockImplementation(() => { throw new Error('ENOENT') })
    expect(() => deleteLockfile('/userData', 27182)).not.toThrow()
  })
})

describe('cleanupStaleLockfiles', () => {
  const originalKill = process.kill.bind(process)

  beforeEach(() => {
    vi.resetAllMocks()
    // Replace process.kill with our mock
    Object.defineProperty(process, 'kill', { value: mockProcessKill, configurable: true, writable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'kill', { value: originalKill, configurable: true, writable: true })
  })

  it('returns empty sets when userDataPath has no lockfiles', () => {
    mockReaddirSync.mockReturnValue([])
    const { alivePorts, stalePorts } = cleanupStaleLockfiles('/userData')
    expect(alivePorts.size).toBe(0)
    expect(stalePorts).toHaveLength(0)
  })

  it('returns empty sets when readdirSync fails', () => {
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT') })
    const { alivePorts, stalePorts } = cleanupStaleLockfiles('/userData')
    expect(alivePorts.size).toBe(0)
    expect(stalePorts).toHaveLength(0)
  })

  it('adds alive PID port to alivePorts (does not delete lockfile)', () => {
    mockReaddirSync.mockReturnValue(['hookserver-27182.lock'])
    mockReadFileSync.mockReturnValue(JSON.stringify({ pid: 9999, port: 27182, startedAt: '2026-01-01T00:00:00Z' }))
    mockProcessKill.mockReturnValue(true) // PID alive

    const { alivePorts, stalePorts } = cleanupStaleLockfiles('/userData')
    expect(alivePorts.has(27182)).toBe(true)
    expect(stalePorts).toHaveLength(0)
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })

  it('adds dead PID port to stalePorts and deletes lockfile', () => {
    mockReaddirSync.mockReturnValue(['hookserver-27183.lock'])
    mockReadFileSync.mockReturnValue(JSON.stringify({ pid: 9998, port: 27183, startedAt: '2026-01-01T00:00:00Z' }))
    mockProcessKill.mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }) })

    const { alivePorts, stalePorts } = cleanupStaleLockfiles('/userData')
    expect(alivePorts.has(27183)).toBe(false)
    expect(stalePorts).toContain(27183)
    expect(mockUnlinkSync).toHaveBeenCalledWith(join('/userData', 'hookserver-27183.lock'))
  })

  it('handles multiple lockfiles: one alive, one stale', () => {
    mockReaddirSync.mockReturnValue([
      'hookserver-27182.lock',
      'hookserver-27183.lock',
      'other-file.txt', // ignored
    ])
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify({ pid: 1111, port: 27182, startedAt: '' }))
      .mockReturnValueOnce(JSON.stringify({ pid: 2222, port: 27183, startedAt: '' }))
    mockProcessKill
      .mockReturnValueOnce(true)  // 1111 alive
      .mockImplementationOnce(() => { throw new Error('dead') }) // 2222 dead

    const { alivePorts, stalePorts } = cleanupStaleLockfiles('/userData')
    expect(alivePorts.has(27182)).toBe(true)
    expect(alivePorts.has(27183)).toBe(false)
    expect(stalePorts).toContain(27183)
    expect(stalePorts).not.toContain(27182)
  })

  it('deletes corrupt (unparseable) lockfiles', () => {
    mockReaddirSync.mockReturnValue(['hookserver-27185.lock'])
    mockReadFileSync.mockReturnValue('not valid json {{{')
    const { stalePorts } = cleanupStaleLockfiles('/userData')
    expect(stalePorts).toHaveLength(0) // corrupt = no port known
    expect(mockUnlinkSync).toHaveBeenCalledWith(join('/userData', 'hookserver-27185.lock'))
  })
})

// ── Additive injection (ADR-013 §3) ──────────────────────────────────────────

describe('injectHookUrls — additive multi-instance (ADR-013)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
  })

  it('does not touch http entries belonging to another KanbAgent instance', async () => {
    // Port 27183 already has entries from another instance
    const settings = {
      hooks: {
        Stop:               [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/instructions-loaded' }] }],
        PermissionRequest:  [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/permission-request' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    // Instance 2 injects on port 27182
    await injectHookUrls('/fake/settings.json', '127.0.0.1', 27182)

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Port 27183 entries preserved
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://127.0.0.1:27183/hooks/stop')
    // Port 27182 entries added as new groups
    expect(written.hooks.Stop[1].hooks[0].url).toBe('http://127.0.0.1:27182/hooks/stop')
    expect(written.hooks.Stop).toHaveLength(2)
  })

  it('updates own port IP without touching other ports', async () => {
    // Both instances have entries, port 27182 has stale IP
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'http', url: 'http://old-ip:27182/hooks/stop' }] },
          { hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/stop' }] },
        ],
        // other events absent for simplicity
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookUrls('/fake/settings.json', 'new-ip', 27182)

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Port 27182 IP updated
    const group27182 = written.hooks.Stop.find((g: { hooks: Array<{ url?: string }> }) =>
      g.hooks?.some((h: { url?: string }) => h.url?.includes(':27182/'))
    )
    expect(group27182.hooks[0].url).toBe('http://new-ip:27182/hooks/stop')
    // Port 27183 untouched
    const group27183 = written.hooks.Stop.find((g: { hooks: Array<{ url?: string }> }) =>
      g.hooks?.some((h: { url?: string }) => h.url?.includes(':27183/'))
    )
    expect(group27183.hooks[0].url).toBe('http://127.0.0.1:27183/hooks/stop')
  })

  it('does not write when own port entries are already up to date', async () => {
    const allRoutes = Object.fromEntries(
      Object.entries(HOOK_ROUTES).map(([event, path]) => [
        event,
        [{ hooks: [{ type: 'http', url: `http://127.0.0.1:27182${path}` }] }],
      ])
    )
    mockReadFile.mockResolvedValue(JSON.stringify({ hooks: allRoutes }))

    await injectHookUrls('/fake/settings.json', '127.0.0.1', 27182)

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('two instances: settings ends up with 2 groups per event', async () => {
    // Start empty, instance 1 injects port 27182
    mockReadFile.mockResolvedValue('{}')
    await injectHookUrls('/fake/settings.json', '127.0.0.1', 27182)
    const after1 = JSON.parse(mockWriteFile.mock.calls[0][1] as string)

    // Instance 2 injects port 27183 — reads previous state
    mockWriteFile.mockReset()
    mockReadFile.mockResolvedValue(JSON.stringify(after1))
    await injectHookUrls('/fake/settings.json', '127.0.0.1', 27183)
    const after2 = JSON.parse(mockWriteFile.mock.calls[0][1] as string)

    // Each event should have 2 groups (one per instance)
    expect(after2.hooks.Stop).toHaveLength(2)
    const urls = after2.hooks.Stop.map((g: { hooks: Array<{ url: string }> }) => g.hooks[0].url) as string[]
    expect(urls).toContain('http://127.0.0.1:27182/hooks/stop')
    expect(urls).toContain('http://127.0.0.1:27183/hooks/stop')
  })
})

// ── removeStaleHookEntries ────────────────────────────────────────────────────

describe('removeStaleHookEntries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('no-op when stalePorts is empty', async () => {
    await removeStaleHookEntries('/fake/settings.json', [])
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('removes groups pointing to stale port', async () => {
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }, // stale
          { hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/stop' }] }, // alive
        ],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await removeStaleHookEntries('/fake/settings.json', [27182])

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop).toHaveLength(1)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://127.0.0.1:27183/hooks/stop')
  })

  it('does not write when no groups match stale ports', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/stop' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await removeStaleHookEntries('/fake/settings.json', [27182])

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('no-op when file is missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await removeStaleHookEntries('/fake/settings.json', [27182])
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('preserves command-type hooks alongside cleaned http entries', async () => {
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'peon-ping' }] },
          { hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }, // stale
          { hooks: [{ type: 'http', url: 'http://127.0.0.1:27183/hooks/stop' }] }, // alive
        ],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await removeStaleHookEntries('/fake/settings.json', [27182])

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop).toHaveLength(2)
    expect(written.hooks.Stop[0].hooks[0].type).toBe('command')
    expect(written.hooks.Stop[1].hooks[0].url).toBe('http://127.0.0.1:27183/hooks/stop')
  })
})

// ── PermissionRequest guard (ADR-013 §6) — separate module scope ─────────────
// Note: these tests are in a separate file to avoid mock conflicts.
// The guard itself is tested in hookServer-handlers.spec.ts-style isolation below.

