/**
 * Tests for wsl:getClaudeInstances IPC handler (T721, T774)
 *
 * Strategy: mock child_process.execFile via promisify hoisting,
 * capture the handler registered with ipcMain.handle, then call it directly.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoist mocks so they're available when vi.mock is hoisted ─────────────────
const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(() => ({ unref: vi.fn() })),
}))

vi.mock('child_process', () => ({
  default: { execFile: execFileMock, spawn: spawnMock },
  execFile: execFileMock,
  spawn: spawnMock,
}))

vi.mock('util', () => ({
  default: { promisify: () => execFileMock },
  promisify: () => execFileMock,
}))

// ── Mock electron ─────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
  shell: { openExternal: vi.fn() },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { registerWslHandlers, detectLocalInstance } from './ipc-wsl'

// ── Helper: call the handler ──────────────────────────────────────────────────
function callHandler(): Promise<unknown> {
  const handler = handlers['wsl:getClaudeInstances']
  if (!handler) throw new Error('Handler not registered')
  return handler(null) as Promise<unknown>
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Simulate wsl.exe -l --verbose output */
function wslListOutput(distros: Array<{ name: string; isDefault: boolean; state?: string }>): string {
  const lines = ['NAME            STATE           VERSION']
  for (const d of distros) {
    const prefix = d.isDefault ? '* ' : '  '
    const state = d.state ?? 'Running'
    lines.push(`${prefix}${d.name}         ${state}         2`)
  }
  return lines.join('\n') + '\n'
}

/** Simulate `claude --version` output */
function claudeVersionOutput(version = '2.1.58'): string {
  return `${version} (Claude Code)\n`
}

// ── WSL handler tests (Windows platform) ─────────────────────────────────────
describe('wsl:getClaudeInstances — Windows/WSL', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    // Restore spawn mock impl since resetAllMocks clears implementations
    spawnMock.mockReturnValue({ unref: vi.fn() })
    for (const key of Object.keys(handlers)) delete handlers[key]
    // Force Windows platform so WSL detection runs
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerWslHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('returns empty array when wsl.exe fails and no local instance', async () => {
    execFileMock.mockRejectedValue(new Error('not found')) // where claude fails
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('returns empty array when no distros found', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({ stdout: 'NAME            STATE           VERSION\n', stderr: '' }) // wsl -l
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('skips docker-desktop distros', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({
        stdout: wslListOutput([
          { name: 'docker-desktop', isDefault: false },
          { name: 'docker-desktop-data', isDefault: false },
        ]),
        stderr: ''
      })
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('skips Stopped distros (avoids timeout on cold-start)', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({
        stdout: wslListOutput([
          { name: 'Ubuntu', isDefault: true, state: 'Stopped' },
        ]),
        stderr: ''
      })
    const result = await callHandler()
    expect(result).toEqual([])
    // bash -lc should NOT have been called for the Stopped distro
    const calls = execFileMock.mock.calls as Array<[string, string[]]>
    const bashCalls = calls.filter(c => c[1]?.includes('-lc'))
    expect(bashCalls).toHaveLength(0)
  })

  it('returns empty array when distro has no claude', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('detects a single WSL distro with claude (type: wsl)', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.1.58'), stderr: '' })
    const result = await callHandler()
    expect(result).toEqual([
      { distro: 'Ubuntu', version: '2.1.58', isDefault: true, type: 'wsl' }
    ])
  })

  it('strips UTF-16 null bytes from wsl.exe output', async () => {
    const rawWithNulls = wslListOutput([{ name: 'Ubuntu', isDefault: false }])
      .split('').join('\0')
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({ stdout: rawWithNulls, stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput(), stderr: '' })
    const result = await callHandler() as Array<{ distro: string }>
    expect(result[0].distro).toBe('Ubuntu')
  })

  it('sorts default distro first', async () => {
    // With CONCURRENCY=2, both distros are processed in the same batch via Promise.all.
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({
        stdout: wslListOutput([
          { name: 'Debian', isDefault: false },
          { name: 'Ubuntu', isDefault: true },
        ]),
        stderr: ''
      })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.0.0'), stderr: '' }) // Debian version
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.1.58'), stderr: '' }) // Ubuntu version
    const result = await callHandler() as Array<{ distro: string; isDefault: boolean }>
    expect(result[0].distro).toBe('Ubuntu')
    expect(result[0].isDefault).toBe(true)
    expect(result[1].distro).toBe('Debian')
  })

  it('returns empty array when claude version call times out', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('not found')) // where claude (local)
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockRejectedValueOnce(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }))
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('prepends local instance before WSL distros on Windows', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\Users\\User\\claude.cmd\n', stderr: '' }) // where claude
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('3.0.0'), stderr: '' }) // claude --version (local, shell:true)
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.1.58'), stderr: '' }) // Ubuntu version
    const result = await callHandler() as Array<{ type: string; distro: string }>
    expect(result[0]).toMatchObject({ type: 'local', distro: 'local' })
    expect(result[1]).toMatchObject({ type: 'wsl', distro: 'Ubuntu' })
  })
})

// ── Linux/macOS handler tests ─────────────────────────────────────────────────
describe('wsl:getClaudeInstances — Linux/macOS', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    spawnMock.mockReturnValue({ unref: vi.fn() })
    for (const key of Object.keys(handlers)) delete handlers[key]
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    registerWslHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('returns local instance when claude is in PATH', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' }) // which claude
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.1.58'), stderr: '' }) // claude --version
    const result = await callHandler()
    expect(result).toEqual([
      { distro: 'local', version: '2.1.58', isDefault: true, type: 'local' }
    ])
  })

  it('returns [] when claude is not in PATH', async () => {
    execFileMock.mockRejectedValueOnce(new Error('which: claude: not found'))
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('never calls wsl.exe on linux', async () => {
    execFileMock.mockRejectedValueOnce(new Error('not found'))
    await callHandler()
    // All calls should use 'which', never 'wsl.exe'
    const calls = execFileMock.mock.calls as Array<[string, ...unknown[]]>
    const wslCall = calls.find(c => c[0] === 'wsl.exe')
    expect(wslCall).toBeUndefined()
  })
})

// ── detectLocalInstance unit tests ────────────────────────────────────────────
describe('detectLocalInstance', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    spawnMock.mockReturnValue({ unref: vi.fn() })
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('returns ClaudeInstance with type local on unix', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' }) // which claude
      .mockResolvedValueOnce({ stdout: '2.1.58 (Claude Code)\n', stderr: '' }) // claude --version
    const result = await detectLocalInstance()
    expect(result).toEqual({
      distro: 'local',
      version: '2.1.58',
      isDefault: true,
      type: 'local',
    })
  })

  it('returns null when which/where fails', async () => {
    execFileMock.mockRejectedValueOnce(new Error('not found'))
    const result = await detectLocalInstance()
    expect(result).toBeNull()
  })

  it('returns null when claude --version returns empty string', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: '/usr/bin/claude\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // empty version
    const result = await detectLocalInstance()
    expect(result).toBeNull()
  })

  it('uses where on win32 (not which)', async () => {
    platformSpy.mockReturnValue('win32')
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\Users\\User\\claude.cmd\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2.1.58\n', stderr: '' })
    await detectLocalInstance()
    const firstCall = execFileMock.mock.calls[0] as [string, string[]]
    expect(firstCall[0]).toBe('where')
    expect(firstCall[1]).toContain('claude')
  })
})
