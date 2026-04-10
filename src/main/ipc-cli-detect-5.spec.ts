/**
 * Tests for ipc-cli-detect — Part 3 (T1225)
 *
 * Targets surviving mutants:
 * - StringLiteral on 'where', '--version', 'bash', '-c', 'local', 'wsl', 'utf-8'
 * - Regex precision on parseVersion
 * - MethodExpression on .split('\n')[0], .map, .filter, .slice
 * - ConditionalExpression on platform branches, colonIdx, filterClis
 * - BooleanLiteral on isDefault
 * - ObjectLiteral/ArrayDeclaration on CLI_REGISTRY entries
 * - LogicalOperator on platform || condition and handler forceRefresh
 * - ArithmeticOperator on colonIdx ± 1
 * - BlockStatement on warmupCliDetection, linux/darwin branch, detectionCache
 * - ArrowFunction on catch(() => [])
 * - EqualityOperator on i < distros.length
 * - NoCoverage lines 38-59 (WSL_TIMEOUT, LOCAL_TIMEOUT, CONCURRENCY, CLI_REGISTRY)
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const { execFileMock, enrichWindowsPathMock, getWslDistrosMock, writeFileSyncMock, unlinkSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  enrichWindowsPathMock: vi.fn().mockResolvedValue(undefined),
  getWslDistrosMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}))

vi.mock('util', () => ({
  default: { promisify: () => execFileMock },
  promisify: () => execFileMock,
}))

vi.mock('fs', () => ({
  default: { writeFileSync: writeFileSyncMock, unlinkSync: unlinkSyncMock },
  writeFileSync: writeFileSyncMock,
  unlinkSync: unlinkSyncMock,
}))

// ── Mock electron ─────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('./ipc-wsl', () => ({
  enrichWindowsPath: enrichWindowsPathMock,
  getWslDistros: getWslDistrosMock,
  getWslExe: () => 'wsl.exe',
}))

vi.mock('./utils/wsl', () => ({
  toWslPath: (p: string) => {
    const drive = p.charAt(0).toLowerCase()
    const rest = p.slice(2).replace(/\\/g, '/')
    return `/mnt/${drive}${rest}`
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import {
  registerCliDetectHandlers,
  detectLocalClis,
  detectWslClis,
  warmupCliDetection,
  _resetDetectionCacheForTest,
} from './ipc-cli-detect'

// ── Helpers ───────────────────────────────────────────────────────────────────
function callHandler(args?: { clis?: string[]; forceRefresh?: boolean }): Promise<unknown> {
  const handler = handlers['wsl:get-cli-instances']
  if (!handler) throw new Error('Handler not registered')
  return handler(null, args) as Promise<unknown>
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Windows local detection — exact command arguments (StringLiteral) ─────────
// ══════════════════════════════════════════════════════════════════════════════
describe('warmupCliDetection — fires detection (BlockStatement)', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    _resetDetectionCacheForTest()
    for (const key of Object.keys(handlers)) delete handlers[key]
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    registerCliDetectHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('warmupCliDetection actually fires detection (not a no-op)', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.0.0\n', stderr: '' })
    warmupCliDetection()
    // Wait for fire-and-forget
    await new Promise(resolve => setTimeout(resolve, 10))
    // If BlockStatement was removed, execFile would NOT be called
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('warmupCliDetection result is reused by IPC handler (no double spawn)', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:2.0.0\n', stderr: '' })
    warmupCliDetection()
    await new Promise(resolve => setTimeout(resolve, 10))
    // IPC call uses cached result
    const result = await callHandler() as Array<{ cli: string }>
    expect(result[0].cli).toBe('claude')
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── IPC handler — forceRefresh and filterClis (LogicalOp, MethodExp, BoolLit) ─
// ══════════════════════════════════════════════════════════════════════════════
describe('wsl:get-cli-instances — handler forceRefresh and filterClis', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    _resetDetectionCacheForTest()
    for (const key of Object.keys(handlers)) delete handlers[key]
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    registerCliDetectHandlers()
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('forceRefresh: true invalidates cache → re-detects with fresh data', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: 'claude:1.0.0\n', stderr: '' }) // first detection
      .mockResolvedValueOnce({ stdout: 'claude:2.0.0\n', stderr: '' }) // second detection (force refresh)
    await callHandler()
    const result2 = await callHandler({ forceRefresh: true }) as Array<{ version: string }>
    expect(result2[0].version).toBe('2.0.0')
  })

  it('forceRefresh: false does NOT invalidate cache', async () => {
    execFileMock.mockResolvedValue({ stdout: 'claude:1.0.0\n', stderr: '' })
    await callHandler()
    await callHandler({ forceRefresh: false })
    // If LogicalOperator mutation makes forceRefresh always true, this would be 2
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('clis filter: only specified CLIs returned (MethodExpression .filter)', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\naider:0.50.0\ngemini:0.1.0\n',
      stderr: '',
    })
    const result = await callHandler({ clis: ['aider'] }) as Array<{ cli: string }>
    expect(result).toHaveLength(1)
    expect(result[0].cli).toBe('aider')
  })

  it('clis filter: empty array → returns empty (all filtered out)', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\n',
      stderr: '',
    })
    const result = await callHandler({ clis: [] }) as Array<unknown>
    // filterClis = [] → Array.isArray([]) = true, filter returns nothing that matches
    expect(result).toHaveLength(0)
  })

  it('clis not an array (non-array args.clis) → no filter applied, returns all', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\naider:0.50.0\n',
      stderr: '',
    })
    // Pass clis as a string (not array) → filterClis=undefined → all returned
    const result = await callHandler({ clis: 'claude' as unknown as string[] }) as Array<unknown>
    expect(result).toHaveLength(2)
  })

  it('no args at all → returns all CLIs without filter', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\ngemini:0.1.0\n',
      stderr: '',
    })
    const result = await callHandler(undefined) as Array<{ cli: string }>
    expect(result).toHaveLength(2)
  })

  it('result order: filter preserves original detection order', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\ngemini:0.1.0\naider:0.50.0\n',
      stderr: '',
    })
    const result = await callHandler({ clis: ['gemini', 'aider'] }) as Array<{ cli: string }>
    expect(result[0].cli).toBe('gemini')
    expect(result[1].cli).toBe('aider')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── parseVersion — regex precision (Regex mutants L70) ────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
describe('parseVersion — regex precision', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  async function parseViaDetect(raw: string): Promise<string> {
    execFileMock.mockResolvedValueOnce({ stdout: `claude:${raw}\n`, stderr: '' })
    const result = await detectLocalClis(['claude'])
    return result[0]?.version ?? ''
  }

  it('requires at least 2 version number groups (d+.d+): "1.2" → "1.2"', async () => {
    // If regex requires only 1 group (d+.d), "1.2" might fail
    expect(await parseViaDetect('1.2')).toBe('1.2')
  })

  it('requires major version to be 1+ digits: "10.2.3" → "10.2.3"', async () => {
    // If regex requires only 1 digit in major, "10.2.3" might fail
    expect(await parseViaDetect('10.2.3')).toBe('10.2.3')
  })

  it('requires minor version to be 1+ digits: "1.20.3" → "1.20.3"', async () => {
    // If regex requires only 1 digit in minor, "1.20" might fail
    expect(await parseViaDetect('1.20.3')).toBe('1.20.3')
  })

  it('strips v prefix: "v10.0.0" → "10.0.0"', async () => {
    expect(await parseViaDetect('v10.0.0')).toBe('10.0.0')
  })

  it('parses version with 4 parts: "1.2.3.4" → "1.2.3.4"', async () => {
    expect(await parseViaDetect('1.2.3.4')).toBe('1.2.3.4')
  })

  it('only uses first line (MethodExpression .split("\\n")[0])', async () => {
    // Multi-line version output — only first line matters
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:1.0.0 (first line)\nExtraLine: 9.9.9\n',
      stderr: '',
    })
    const result = await detectLocalClis(['claude'])
    // version from '1.0.0 (first line)' → '1.0.0'
    expect(result[0].version).toBe('1.0.0')
  })

  it('version from multiline Windows output uses first line only', async () => {
    const platformSpy2 = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    enrichWindowsPathMock.mockResolvedValue(undefined)
    execFileMock
      .mockResolvedValueOnce({ stdout: 'C:\\claude.cmd\n', stderr: '' }) // where
      .mockResolvedValueOnce({
        stdout: '2.1.0 (build 123)\nExtra info\n', // multiline
        stderr: '',
      })
      .mockRejectedValue(new Error('not found'))
    const result = await detectLocalClis(['claude'])
    // If .split('\n')[0] is replaced by raw, version might pick up wrong line
    expect(result[0].version).toBe('2.1.0')
    platformSpy2.mockRestore()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ── CLI_REGISTRY — NoCoverage lines 53-59 ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
describe('CLI_REGISTRY — all 6 entries are functional', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  // Each CLI in the registry must have a binary with the exact string
  const allClis = [
    { cli: 'claude',   binary: 'claude'   },
    { cli: 'codex',    binary: 'codex'    },
    { cli: 'gemini',   binary: 'gemini'   },
    { cli: 'opencode', binary: 'opencode' },
    { cli: 'aider',    binary: 'aider'    },
    { cli: 'goose',    binary: 'goose'    },
  ]

  for (const { cli, binary } of allClis) {
    it(`detects "${cli}" CLI with binary "${binary}"`, async () => {
      execFileMock.mockResolvedValueOnce({
        stdout: `${binary}:1.0.0\n`,
        stderr: '',
      })
      const result = await detectLocalClis([cli as Parameters<typeof detectLocalClis>[0][0]])
      expect(result).toHaveLength(1)
      expect(result[0].cli).toBe(cli)
      expect(result[0].version).toBe('1.0.0')
    })

    it(`bash script includes "${binary}" binary for "${cli}"`, async () => {
      execFileMock.mockResolvedValueOnce({ stdout: '', stderr: '' })
      await detectLocalClis([cli as Parameters<typeof detectLocalClis>[0][0]])
      const scriptArg = (execFileMock.mock.calls[0] as [string, string[]])[1][1]
      expect(scriptArg).toContain(binary)
    })
  }

  it('detects all 6 CLIs simultaneously when all are present (Linux)', async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: 'claude:2.0.0\ncodex:1.0.0\ngemini:0.2.0\nopencode:0.1.2\naider:0.50.0\ngoose:1.0.0\n',
      stderr: '',
    })
    const result = await detectLocalClis()
    expect(result).toHaveLength(6)
    expect(result.map(r => r.cli).sort()).toEqual(['aider', 'claude', 'codex', 'gemini', 'goose', 'opencode'])
  })
})
