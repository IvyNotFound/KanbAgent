/**
 * Tests for hookServer — JSONL transcript parsing (T737) + exports (T741) + WSL fix (T858)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseTokensFromJSONL, HOOK_PORT, detectWslGatewayIp, injectHookUrls, resolvePermission, pendingPermissions } from './hookServer'

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
    const convert = (url: string) => {
      const raw = url.replace('/hooks/', '').replace(/-./g, (m) => m[1].toUpperCase())
      return raw.charAt(0).toUpperCase() + raw.slice(1)
    }

    expect(convert('/hooks/session-start')).toBe('SessionStart')
    expect(convert('/hooks/subagent-start')).toBe('SubagentStart')
    expect(convert('/hooks/subagent-stop')).toBe('SubagentStop')
    expect(convert('/hooks/pre-tool-use')).toBe('PreToolUse')
    expect(convert('/hooks/post-tool-use')).toBe('PostToolUse')
    expect(convert('/hooks/instructions-loaded')).toBe('InstructionsLoaded')
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

  it('ignores assistant messages with no message field at all', () => {
    const content = JSON.stringify({ type: 'assistant' })
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('ignores assistant message with usage but stop_reason explicitly null', () => {
    // Ensures ConditionalExpression mutation `stop_reason == null` is killed
    const content = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: null, usage: { input_tokens: 99, output_tokens: 10 } },
    })
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

  it('skips WSL interface whose addrs is undefined', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockNetworkInterfaces.mockReturnValue({
      'vEthernet (WSL)': undefined,
    })
    expect(detectWslGatewayIp()).toBeNull()
  })

  it('skips internal IPv4 addresses on WSL interface', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockNetworkInterfaces.mockReturnValue({
      'vEthernet (WSL)': [
        { family: 'IPv4', address: '127.0.0.1', internal: true, netmask: '', mac: '', cidr: '' },
      ],
    })
    expect(detectWslGatewayIp()).toBeNull()
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

  it('creates all 8 hooks when settings.json exists but has no hooks section', async () => {
    mockReadFile.mockResolvedValue('{}')
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(typeof written.hooks).toBe('object')
    expect(Object.keys(written.hooks)).toHaveLength(8)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
    expect(written.hooks.SessionStart[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/session-start')
    expect(written.hooks.SubagentStart[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/subagent-start')
    expect(written.hooks.SubagentStop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/subagent-stop')
    expect(written.hooks.PreToolUse[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/pre-tool-use')
    expect(written.hooks.PostToolUse[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/post-tool-use')
    expect(written.hooks.InstructionsLoaded[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/instructions-loaded')
  })

  it('does not write when all 8 hooks are present and URLs already match', async () => {
    const settings = {
      hooks: {
        Stop:               [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/stop' }] }],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/instructions-loaded' }] }],
        PermissionRequest:  [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/permission-request' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('adds http hook alongside existing command hook (peon-ping coexistence)', async () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
        SessionStart:  [{ hooks: [{ type: 'command', command: 'peon-ping' }] }],
        SubagentStart: [{ hooks: [{ type: 'command', command: 'peon-ping' }] }],
        SubagentStop:  [{ hooks: [{ type: 'command', command: 'peon-ping' }] }],
        PreToolUse:    [{ hooks: [{ type: 'command', command: 'peon-ping' }] }],
        PostToolUse:   [{ hooks: [{ type: 'command', command: 'peon-ping' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    // Command hooks preserved
    expect(written.hooks.Stop[0].hooks[0].type).toBe('command')
    expect(written.hooks.SessionStart[0].hooks[0].type).toBe('command')
    // HTTP hooks added as new group
    expect(written.hooks.Stop[1].hooks[0].type).toBe('http')
    expect(written.hooks.Stop[1].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
    expect(written.hooks.SessionStart[1].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/session-start')
  })

  it('does not duplicate http hook when event already has one', async () => {
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo done' }] },
          { hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/stop' }] },
        ],
        SessionStart:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/session-start' }] }],
        SubagentStart:      [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-start' }] }],
        SubagentStop:       [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/subagent-stop' }] }],
        PreToolUse:         [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/pre-tool-use' }] }],
        PostToolUse:        [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/post-tool-use' }] }],
        InstructionsLoaded: [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/instructions-loaded' }] }],
        PermissionRequest:  [{ hooks: [{ type: 'http', url: 'http://172.17.240.1:27182/hooks/permission-request' }] }],
      },
    }
    mockReadFile.mockResolvedValue(JSON.stringify(settings))
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    // All http hooks already present, URLs already match → no write
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('creates settings.json with all 8 hooks when file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)

    await injectHookUrls('/fake/.claude/settings.json', '172.17.240.1')

    expect(mockMkdir).toHaveBeenCalledWith('/fake/.claude', { recursive: true })
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(Object.keys(written.hooks)).toHaveLength(8)
    expect(written.hooks.Stop[0].hooks[0].url).toBe('http://172.17.240.1:27182/hooks/stop')
  })

  it('returns without writing when readFile fails with non-ENOENT error', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockReadFile.mockRejectedValue(err)
    await injectHookUrls('/fake/settings.json', '172.17.240.1')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

// ── resolvePermission (T1816) ────────────────────────────────────────────────

describe('resolvePermission', () => {
  afterEach(() => {
    // Clean up any pending permissions left by tests
    for (const [id, p] of pendingPermissions) {
      clearTimeout(p.timer)
      pendingPermissions.delete(id)
    }
  })

  it('returns false for unknown permissionId', () => {
    expect(resolvePermission('nonexistent', { behavior: 'allow' })).toBe(false)
  })

  it('resolves a pending permission and returns true', async () => {
    const decision = { behavior: 'allow' as const }
    let resolvedValue: { behavior: string } | undefined

    const promise = new Promise<{ behavior: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ behavior: 'deny' }), 60_000)
      pendingPermissions.set('test-1', { resolve, timer })
    })
    promise.then((v) => { resolvedValue = v })

    const result = resolvePermission('test-1', decision)
    expect(result).toBe(true)
    expect(pendingPermissions.has('test-1')).toBe(false)

    // Let the microtask resolve
    await promise
    expect(resolvedValue?.behavior).toBe('allow')
  })

  it('returns false on second call for same permissionId (already consumed)', () => {
    const timer = setTimeout(() => {}, 60_000)
    pendingPermissions.set('test-2', { resolve: () => {}, timer })

    expect(resolvePermission('test-2', { behavior: 'deny' })).toBe(true)
    expect(resolvePermission('test-2', { behavior: 'allow' })).toBe(false)
  })

  it('clears the timeout when resolved', () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    const timer = setTimeout(() => {}, 60_000)
    pendingPermissions.set('test-3', { resolve: () => {}, timer })

    resolvePermission('test-3', { behavior: 'allow' })

    expect(clearSpy).toHaveBeenCalledWith(timer)
    clearSpy.mockRestore()
  })
})
