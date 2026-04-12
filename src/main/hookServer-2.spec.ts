/**
 * Tests for hookServer — part 2: injectHookUrls (overflow) + injectIntoWslDistros + parseTokensFromJSONLStream (T858)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseTokensFromJSONLStream, injectIntoWslDistros, injectHookUrls } from './hookServer'

// ── Hoisted mocks (must be declared before vi.mock, which are hoisted) ────────
const { mockNetworkInterfaces, mockReadFile, mockWriteFile, mockMkdir, mockExecSync } = vi.hoisted(() => ({
  mockNetworkInterfaces: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockExecSync: vi.fn(),
}))

vi.mock('os', () => ({
  default: { networkInterfaces: mockNetworkInterfaces },
  networkInterfaces: mockNetworkInterfaces,
}))

vi.mock('child_process', () => ({
  default: { execSync: mockExecSync },
  execSync: mockExecSync,
}))

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

// ── JSONL fixtures ────────────────────────────────────────────────────────────

function makeAssistantLine(opts: {
  stopReason: string | null
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      stop_reason: opts.stopReason,
      usage: {
        input_tokens: opts.inputTokens ?? 0,
        output_tokens: opts.outputTokens ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
      }
    }
  })
}

// ── injectHookUrls (overflow from hookServer.spec.ts) ────────────────────────

describe('injectHookUrls (continued)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('does not crash when an http hook has no url property', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http' }] }], // url absent
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/instructions-loaded' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    // Should not throw; Stop already has an http hook (no url) so hasHttp=true, no extra group added
    await expect(injectHookUrls('/fake/settings.json', '172.17.240.1', 27182)).resolves.toBeUndefined()
  })

  it('adds only missing hook events when hooks section is partially populated', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/stop' }] }],
        // SessionStart, SubagentStart, SubagentStop, PreToolUse, PostToolUse, InstructionsLoaded missing
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookUrls('/fake/settings.json', '172.17.240.1', 27182)

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(Object.keys(written.hooks)).toHaveLength(8)
    // Existing Stop hook preserved
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
    // Missing hooks created
    expect(written.hooks.SessionStart[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/session-start')
  })
})

// ── injectIntoWslDistros ──────────────────────────────────────────────────────

describe('injectIntoWslDistros', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('returns early on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await injectIntoWslDistros('172.17.240.1', 27182)
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it('returns gracefully when wsl.exe --list fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockExecSync.mockImplementation(() => { throw new Error('wsl.exe not found') })
    await expect(injectIntoWslDistros('172.17.240.1', 27182)).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('reads and writes WSL settings via wsl.exe (not UNC path)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)  // wsl.exe --list --quiet
      .mockReturnValueOnce('{}')        // cat ~/.claude/settings.json → empty, hooks created
      .mockReturnValueOnce(undefined)   // mkdir -p + cat > settings.json (write)

    await injectIntoWslDistros('172.17.240.1', 27182)

    expect(mockExecSync).toHaveBeenCalledWith('wsl.exe --list --quiet', { timeout: 5000 })
    expect(mockExecSync).toHaveBeenCalledWith(
      `wsl.exe -d "Ubuntu" -- bash -c "cat ~/.claude/settings.json 2>/dev/null || echo '{}'"`,
      { timeout: 5000, encoding: 'utf-8' }
    )
    expect(mockExecSync).toHaveBeenCalledWith(
      `wsl.exe -d "Ubuntu" -- bash -c "mkdir -p ~/.claude && cat > ~/.claude/settings.json"`,
      expect.objectContaining({ input: expect.any(String), timeout: 5000, encoding: 'utf-8' })
    )
    // Verify injected JSON contains all 8 hooks
    const writeCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    expect(writeCall).toBeDefined()
    const written = JSON.parse((writeCall![1] as { input: string }).input)
    expect(Object.keys(written.hooks)).toHaveLength(8)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
  })

  it('logs error and continues when distro is stopped (read or write fails)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList) // wsl.exe --list
      .mockImplementationOnce(() => { throw new Error('distro stopped') }) // cat → fails
      .mockImplementationOnce(() => { throw new Error('distro stopped') }) // write → fails

    await expect(injectIntoWslDistros('172.17.240.1', 27182)).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('handles multiple distros, injecting into each via wsl.exe', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\nDebian\n', 'utf16le')
    const settings = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
      },
    })
    mockExecSync
      .mockReturnValueOnce(distroList)  // wsl.exe --list
      .mockReturnValueOnce(settings)    // cat settings for Ubuntu
      .mockReturnValueOnce(undefined)   // write for Ubuntu
      .mockReturnValueOnce(settings)    // cat settings for Debian
      .mockReturnValueOnce(undefined)   // write for Debian

    await injectIntoWslDistros('172.17.240.1', 27182)

    // Verify write commands were called for both distros
    const writeCalls = mockExecSync.mock.calls.filter((c) =>
      (c[0] as string).includes('mkdir -p')
    )
    expect(writeCalls).toHaveLength(2)
    expect(writeCalls[0][0]).toContain('"Ubuntu"')
    expect(writeCalls[1][0]).toContain('"Debian"')
  })

  it('passes null wslIp: reads settings but skips write when no changes', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList) // wsl.exe --list
      .mockReturnValueOnce('{}')       // cat settings.json → empty, no http hooks to update

    await injectIntoWslDistros(null, 27182)

    // null wslIp + no hookSecret + no existing hooks → changed = false → no write
    expect(mockExecSync).toHaveBeenCalledTimes(2)
  })
})

// ── parseTokensFromJSONLStream ────────────────────────────────────────────────

describe('parseTokensFromJSONLStream', () => {
  const tmpFile = join(tmpdir(), 'hookServer_test_transcript.jsonl')

  afterEach(() => {
    try { unlinkSync(tmpFile) } catch { /* file may not exist */ }
  })

  it('returns zero counts for an empty file', async () => {
    writeFileSync(tmpFile, '')
    await expect(parseTokensFromJSONLStream(tmpFile)).resolves.toEqual(
      { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }
    )
  })

  it('counts tokens across multiple finalized assistant messages', async () => {
    const lines = [
      makeAssistantLine({ stopReason: 'tool_use', inputTokens: 100, outputTokens: 50 }),
      makeAssistantLine({ stopReason: null, inputTokens: 200, outputTokens: 1 }), // streaming start — ignored
      makeAssistantLine({ stopReason: 'end_turn', inputTokens: 200, outputTokens: 80, cacheRead: 30, cacheWrite: 10 }),
    ].join('\n')
    writeFileSync(tmpFile, lines)
    await expect(parseTokensFromJSONLStream(tmpFile)).resolves.toEqual({
      tokensIn: 300, tokensOut: 130, cacheRead: 30, cacheWrite: 10,
    })
  })

  it('processes 10 000 lines without error and returns correct totals', async () => {
    const LINE_COUNT = 10_000
    // Each even line: finalized assistant (1 token in/out), odd line: noise
    const lines: string[] = []
    for (let i = 0; i < LINE_COUNT; i++) {
      if (i % 2 === 0) {
        lines.push(makeAssistantLine({ stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 }))
      } else {
        lines.push(JSON.stringify({ type: 'user', message: { content: 'hello' } }))
      }
    }
    writeFileSync(tmpFile, lines.join('\n'))
    const result = await parseTokensFromJSONLStream(tmpFile)
    expect(result.tokensIn).toBe(LINE_COUNT / 2)
    expect(result.tokensOut).toBe(LINE_COUNT / 2)
    expect(result.cacheRead).toBe(0)
    expect(result.cacheWrite).toBe(0)
  })

  it('rejects when file does not exist', async () => {
    await expect(parseTokensFromJSONLStream('/nonexistent/path/file.jsonl')).rejects.toThrow()
  })
})
