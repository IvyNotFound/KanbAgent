/**
 * Tests for hookServer — JSONL transcript parsing (T737) + exports (T741) + WSL fix (T858)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseTokensFromJSONL, HOOK_PORT, detectWslGatewayIp, injectHookUrls, injectIntoWslDistros } from './hookServer'

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

// ── Constants ─────────────────────────────────────────────────────────────────

describe('hookServer constants', () => {
  it('HOOK_PORT is 27182', () => {
    expect(HOOK_PORT).toBe(27182)
  })

  it('route-to-eventName conversion matches expected values', () => {
    // Inline the same conversion used in startHookServer
    const convert = (url: string) =>
      url.replace('/hooks/', '').replace(/-./g, (m) => m[1].toUpperCase())

    expect(convert('/hooks/session-start')).toBe('sessionStart')
    expect(convert('/hooks/subagent-start')).toBe('subagentStart')
    expect(convert('/hooks/subagent-stop')).toBe('subagentStop')
    expect(convert('/hooks/pre-tool-use')).toBe('preToolUse')
    expect(convert('/hooks/post-tool-use')).toBe('postToolUse')
  })
})

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseTokensFromJSONL', () => {
  it('returns zero counts for empty string', () => {
    expect(parseTokensFromJSONL('')).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('returns zero counts for blank lines only', () => {
    expect(parseTokensFromJSONL('\n\n  \n')).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('ignores non-assistant message types', () => {
    const content = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'tool_result', content: 'result' }),
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('ignores assistant messages with stop_reason = null (streaming start)', () => {
    const content = makeAssistantLine({ stopReason: null, inputTokens: 100, outputTokens: 1 })
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('counts a single finalized assistant message', () => {
    const content = makeAssistantLine({
      stopReason: 'tool_use',
      inputTokens: 500,
      outputTokens: 150,
      cacheRead: 200,
      cacheWrite: 50,
    })
    expect(parseTokensFromJSONL(content)).toEqual({
      tokensIn: 500,
      tokensOut: 150,
      cacheRead: 200,
      cacheWrite: 50,
    })
  })

  it('sums tokens across multiple finalized messages', () => {
    const content = [
      makeAssistantLine({ stopReason: 'tool_use', inputTokens: 100, outputTokens: 50 }),
      makeAssistantLine({ stopReason: 'end_turn', inputTokens: 200, outputTokens: 80, cacheRead: 30, cacheWrite: 10 }),
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({
      tokensIn: 300,
      tokensOut: 130,
      cacheRead: 30,
      cacheWrite: 10,
    })
  })

  it('skips streaming entries (stop_reason null) but counts finalized entries', () => {
    const content = [
      // Streaming start — stop_reason null, output_tokens ~1
      makeAssistantLine({ stopReason: null, inputTokens: 500, outputTokens: 1 }),
      // Finalized — same call, full output_tokens
      makeAssistantLine({ stopReason: 'tool_use', inputTokens: 500, outputTokens: 120 }),
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({
      tokensIn: 500,
      tokensOut: 120,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('skips malformed JSON lines gracefully', () => {
    const content = [
      'not json at all',
      makeAssistantLine({ stopReason: 'end_turn', inputTokens: 100, outputTokens: 40 }),
      '{broken json',
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({
      tokensIn: 100,
      tokensOut: 40,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('ignores assistant messages missing usage field', () => {
    const content = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' } })
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('treats missing token sub-fields as 0', () => {
    const content = JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        usage: { input_tokens: 50 } // output_tokens etc. missing
      }
    })
    expect(parseTokensFromJSONL(content)).toEqual({
      tokensIn: 50,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })
})

// ── detectWslGatewayIp ────────────────────────────────────────────────────────

describe('detectWslGatewayIp', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('returns null on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    expect(detectWslGatewayIp()).toBeNull()
  })

  it('returns null when no WSL interface found on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockNetworkInterfaces.mockReturnValue({
      Ethernet: [{ family: 'IPv4', address: '192.168.1.2', internal: false, netmask: '', mac: '', cidr: '' }],
    })
    expect(detectWslGatewayIp()).toBeNull()
  })

  it('returns IPv4 address of WSL interface on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockNetworkInterfaces.mockReturnValue({
      'vEthernet (WSL)': [
        { family: 'IPv6', address: 'fe80::1', internal: false, netmask: '', mac: '', cidr: '' },
        { family: 'IPv4', address: '172.17.240.1', internal: false, netmask: '', mac: '', cidr: '' },
      ],
    })
    expect(detectWslGatewayIp()).toBe('172.17.240.1')
  })
})

// ── injectHookUrls ────────────────────────────────────────────────────────────

describe('injectHookUrls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('replaces 127.0.0.1 URLs in http hooks with the given IP', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
        SessionStart: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/session-start' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookUrls('/fake/settings.json', '172.17.240.1')

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
    expect(written.hooks.SessionStart[0].hooks[0].url).toBe(
      'http://172.17.240.1:27182/hooks/session-start'
    )
  })

  it('creates all 6 hooks when settings.json exists but has no hooks section', async () => {
    mockReadFile.mockResolvedValue('{}')
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.hooks).toBeDefined()
    expect(Object.keys(written.hooks)).toHaveLength(6)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
    expect(written.hooks.SessionStart[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/session-start')
    expect(written.hooks.SubagentStart[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/subagent-start')
    expect(written.hooks.SubagentStop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/subagent-stop')
    expect(written.hooks.PreToolUse[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/pre-tool-use')
    expect(written.hooks.PostToolUse[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/post-tool-use')
  })

  it('does not write when all 6 hooks are present and URLs already match', async () => {
    const settings = {
      hooks: {
        Stop:          [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/stop' }] }],
        SessionStart:  [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/session-start' }] }],
        SubagentStart: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-start' }] }],
        SubagentStop:  [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:    [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:   [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/post-tool-use' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('skips non-http hooks and does not overwrite Stop when all 6 events present', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
        SessionStart:  [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/session-start' }] }],
        SubagentStart: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-start' }] }],
        SubagentStop:  [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:    [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:   [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/post-tool-use' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    // All 6 events present, no URL changes needed → no write
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('creates settings.json with all 6 hooks when file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)

    await injectHookUrls('/fake/.claude/settings.json', '172.17.240.1')

    expect(mockMkdir).toHaveBeenCalledWith('/fake/.claude', { recursive: true })
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(Object.keys(written.hooks)).toHaveLength(6)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
  })

  it('adds only missing hook events when hooks section is partially populated', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/stop' }] }],
        // SessionStart, SubagentStart, SubagentStop, PreToolUse, PostToolUse missing
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectHookUrls('/fake/settings.json', '172.17.240.1')

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(Object.keys(written.hooks)).toHaveLength(6)
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
    await injectIntoWslDistros('172.17.240.1')
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it('returns gracefully when wsl.exe --list fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockExecSync.mockImplementation(() => { throw new Error('wsl.exe not found') })
    await expect(injectIntoWslDistros('172.17.240.1')).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('processes distros and injects into UNC settings path', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    // UTF-16LE encoded "Ubuntu\n"
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList) // wsl.exe --list --quiet
      .mockReturnValueOnce('/home/user\n') // wsl.exe -d Ubuntu -- printenv HOME
    mockReadFile.mockResolvedValue('{}') // settings.json has no hooks → no write

    await injectIntoWslDistros('172.17.240.1')

    expect(mockExecSync).toHaveBeenCalledWith('wsl.exe --list --quiet', { timeout: 5000 })
    expect(mockExecSync).toHaveBeenCalledWith('wsl.exe -d "Ubuntu" -- printenv HOME', {
      timeout: 5000,
      encoding: 'utf-8',
    })
  })

  it('skips distros where printenv HOME fails (distro stopped)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockImplementationOnce(() => { throw new Error('distro stopped') })

    await expect(injectIntoWslDistros('172.17.240.1')).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('handles multiple distros, injecting into each', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\nDebian\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('/home/alice\n') // Ubuntu
      .mockReturnValueOnce('/home/bob\n')   // Debian
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/hooks/stop' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))

    await injectIntoWslDistros('172.17.240.1')

    // writeFile called twice: once per distro (injectHookUrls writes, injectHookSecret may also write)
    const writtenPaths = mockWriteFile.mock.calls.map((c) => c[0] as string)
    expect(writtenPaths.some((p) => p.includes('Ubuntu'))).toBe(true)
    expect(writtenPaths.some((p) => p.includes('Debian'))).toBe(true)
  })

  it('passes null wslIp and skips injectHookUrls', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const distroList = Buffer.from('Ubuntu\n', 'utf16le')
    mockExecSync
      .mockReturnValueOnce(distroList)
      .mockReturnValueOnce('/home/user\n')
    mockReadFile.mockResolvedValue('{}')

    await injectIntoWslDistros(null)

    // Only one execSync call for printenv (no injectHookUrls → no readFile for URLs)
    expect(mockExecSync).toHaveBeenCalledTimes(2)
  })
})
