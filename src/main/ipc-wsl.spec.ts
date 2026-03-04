/**
 * Tests for wsl:getClaudeInstances IPC handler (T721)
 *
 * Strategy: mock child_process.execFile via promisify hoisting,
 * capture the handler registered with ipcMain.handle, then call it directly.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { registerWslHandlers } from './ipc-wsl'

// ── Helper: call the handler ──────────────────────────────────────────────────
function callHandler(): Promise<unknown> {
  const handler = handlers['wsl:getClaudeInstances']
  if (!handler) throw new Error('Handler not registered')
  return handler(null) as Promise<unknown>
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Simulate wsl.exe -l --verbose output */
function wslListOutput(distros: Array<{ name: string; isDefault: boolean }>): string {
  const lines = ['NAME            STATE           VERSION']
  for (const d of distros) {
    const prefix = d.isDefault ? '* ' : '  '
    lines.push(`${prefix}${d.name}         Running         2`)
  }
  return lines.join('\n') + '\n'
}

/** Simulate `claude --version` output */
function claudeVersionOutput(version = '2.1.58'): string {
  return `${version} (Claude Code)\n`
}

describe('wsl:getClaudeInstances', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Restore spawn mock impl since resetAllMocks clears implementations
    spawnMock.mockReturnValue({ unref: vi.fn() })
    for (const key of Object.keys(handlers)) delete handlers[key]
    registerWslHandlers()
  })

  it('returns empty array when wsl.exe fails', async () => {
    execFileMock.mockRejectedValue(new Error('wsl.exe not found'))
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('returns empty array when no distros found', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: 'NAME            STATE           VERSION\n', stderr: '' })
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('skips docker-desktop distros', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: wslListOutput([
        { name: 'docker-desktop', isDefault: false },
        { name: 'docker-desktop-data', isDefault: false },
      ]),
      stderr: ''
    })
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('returns empty array when distro has no claude', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await callHandler()
    expect(result).toEqual([])
  })

  it('detects a single distro with claude', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.1.58'), stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await callHandler()
    expect(result).toEqual([
      { distro: 'Ubuntu', version: '2.1.58', isDefault: true, profiles: ['claude'] }
    ])
  })

  it('strips UTF-16 null bytes from wsl.exe output', async () => {
    const rawWithNulls = wslListOutput([{ name: 'Ubuntu', isDefault: false }])
      .split('').join('\0')
    execFileMock
      .mockResolvedValueOnce({ stdout: rawWithNulls, stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput(), stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await callHandler() as Array<{ distro: string }>
    expect(result[0].distro).toBe('Ubuntu')
  })

  it('sorts default distro first', async () => {
    // With CONCURRENCY=2, both distros are processed in the same batch via Promise.all.
    // Execution order: [Debian-version, Ubuntu-version] (parallel), then [Debian-bin, Ubuntu-bin].
    execFileMock
      .mockResolvedValueOnce({
        stdout: wslListOutput([
          { name: 'Debian', isDefault: false },
          { name: 'Ubuntu', isDefault: true },
        ]),
        stderr: ''
      })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.0.0'), stderr: '' }) // Debian version
      .mockResolvedValueOnce({ stdout: claudeVersionOutput('2.1.58'), stderr: '' }) // Ubuntu version
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // Debian bin
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // Ubuntu bin
    const result = await callHandler() as Array<{ distro: string; isDefault: boolean }>
    expect(result[0].distro).toBe('Ubuntu')
    expect(result[0].isDefault).toBe(true)
    expect(result[1].distro).toBe('Debian')
  })

  it('includes ~/bin/ profiles when present', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput(), stderr: '' })
      .mockResolvedValueOnce({ stdout: 'claude\nclaude-dev\nclaude-review\nsome-other-tool\n', stderr: '' })
    const result = await callHandler() as Array<{ profiles: string[] }>
    expect(result[0].profiles).toEqual(['claude', 'claude-dev', 'claude-review'])
  })

  it('falls back to default profile when ~/bin/ scan fails', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: claudeVersionOutput(), stderr: '' })
      .mockRejectedValueOnce(new Error('ls failed'))
    const result = await callHandler() as Array<{ profiles: string[] }>
    expect(result[0].profiles).toEqual(['claude'])
  })

  it('returns empty array when claude version call times out', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: wslListOutput([{ name: 'Ubuntu', isDefault: true }]), stderr: '' })
      .mockRejectedValueOnce(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }))
    const result = await callHandler()
    expect(result).toEqual([])
  })
})
