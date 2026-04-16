/**
 * Tests for the claude adapter (T1946).
 *
 * Targets:
 * - CLAUDE_CMD_REGEX: anchors, suffix pattern, injection characters
 * - buildClaudeCmd: base command, flags injection, customBinaryName guard
 * - claudeAdapter.buildCommand: SpawnSpec wrapping
 * - claudeAdapter.parseLine: JSON passthrough, non-JSON → null
 * - claudeAdapter.extractConvId: system:init detection
 * - claudeAdapter.prepareSystemPrompt: file write + cleanup
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { claudeAdapter, CLAUDE_CMD_REGEX, buildClaudeCmd } from './claude'

afterEach(() => {
  vi.clearAllMocks()
})

// ── CLAUDE_CMD_REGEX ──────────────────────────────────────────────────────────

describe('CLAUDE_CMD_REGEX', () => {
  it('matches exact "claude"', () => {
    expect(CLAUDE_CMD_REGEX.test('claude')).toBe(true)
  })

  it('matches "claude-dev" (valid suffix)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude-dev')).toBe(true)
  })

  it('matches "claude-pro2" (alphanumeric suffix)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude-pro2')).toBe(true)
  })

  it('matches "claude-123" (numeric suffix)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude-123')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(CLAUDE_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "claude;rm" (semicolon — command injection)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude;rm')).toBe(false)
  })

  it('rejects "claude$(whoami)" (subshell injection)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude$(whoami)')).toBe(false)
  })

  it('rejects "claude-CAPS" (uppercase in suffix)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude-CAPS')).toBe(false)
  })

  it('rejects "not-claude" (anchor ^ required)', () => {
    expect(CLAUDE_CMD_REGEX.test('not-claude')).toBe(false)
  })

  it('rejects "claude-" (trailing dash with no suffix body)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude-')).toBe(false)
  })

  it('rejects "claude extra" (space — anchor $ required)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude extra')).toBe(false)
  })

  it('rejects "claude|cat /etc/passwd" (pipe injection)', () => {
    expect(CLAUDE_CMD_REGEX.test('claude|cat /etc/passwd')).toBe(false)
  })
})

// ── buildClaudeCmd ────────────────────────────────────────────────────────────

describe('buildClaudeCmd', () => {
  it('returns a non-empty string with no options', () => {
    const cmd = buildClaudeCmd({})
    expect(typeof cmd).toBe('string')
    expect(cmd.length).toBeGreaterThan(0)
  })

  it('starts with "claude" when no customBinaryName', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd.startsWith('claude ')).toBe(true)
  })

  it('includes -p, --verbose, --input-format stream-json, --output-format stream-json in base command', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd).toContain('-p')
    expect(cmd).toContain('--verbose')
    expect(cmd).toContain('--input-format')
    expect(cmd).toContain('stream-json')
    expect(cmd).toContain('--output-format')
  })

  it('substitutes valid customBinaryName for "claude"', () => {
    const cmd = buildClaudeCmd({ customBinaryName: 'claude-dev' })
    expect(cmd.startsWith('claude-dev ')).toBe(true)
  })

  it('falls back to "claude" for invalid customBinaryName (injection attempt)', () => {
    const cmd = buildClaudeCmd({ customBinaryName: 'claude;rm -rf /' })
    expect(cmd.startsWith('claude ')).toBe(true)
    expect(cmd).not.toContain(';')
  })

  it('falls back to "claude" for empty customBinaryName', () => {
    const cmd = buildClaudeCmd({ customBinaryName: '' })
    expect(cmd.startsWith('claude ')).toBe(true)
  })

  it('includes --resume <convId> when convId provided', () => {
    const cmd = buildClaudeCmd({ convId: 'abc-123' })
    expect(cmd).toContain('--resume abc-123')
  })

  it('does not include --resume when convId is absent', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd).not.toContain('--resume')
  })

  it('includes --model <modelId> when modelId provided', () => {
    const cmd = buildClaudeCmd({ modelId: 'claude-opus-4-6' })
    expect(cmd).toContain('--model claude-opus-4-6')
  })

  it('does not include --model when modelId is absent', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd).not.toContain('--model')
  })

  it('includes --append-system-prompt with $(cat ...) when systemPromptFile provided', () => {
    const cmd = buildClaudeCmd({ systemPromptFile: '/tmp/sp.txt' })
    expect(cmd).toContain('--append-system-prompt')
    expect(cmd).toContain("$(cat '/tmp/sp.txt')")
  })

  it('does not include --append-system-prompt when systemPromptFile is absent', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd).not.toContain('--append-system-prompt')
  })

  it('includes --settings with alwaysThinkingEnabled:false when thinkingMode="disabled"', () => {
    const cmd = buildClaudeCmd({ thinkingMode: 'disabled' })
    expect(cmd).toContain('--settings')
    expect(cmd).toContain('alwaysThinkingEnabled')
    expect(cmd).toContain('false')
  })

  it('does not include --settings when thinkingMode is absent', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd).not.toContain('--settings')
  })

  it('does not include --settings when thinkingMode is "auto"', () => {
    const cmd = buildClaudeCmd({ thinkingMode: 'auto' })
    expect(cmd).not.toContain('--settings')
  })

  it('includes --dangerously-skip-permissions when permissionMode="auto"', () => {
    const cmd = buildClaudeCmd({ permissionMode: 'auto' })
    expect(cmd).toContain('--dangerously-skip-permissions')
  })

  it('does not include --dangerously-skip-permissions when permissionMode is absent', () => {
    const cmd = buildClaudeCmd({})
    expect(cmd).not.toContain('--dangerously-skip-permissions')
  })

  it('does not include --dangerously-skip-permissions when permissionMode is "default"', () => {
    const cmd = buildClaudeCmd({ permissionMode: 'default' })
    expect(cmd).not.toContain('--dangerously-skip-permissions')
  })

  it('combines convId + systemPromptFile + modelId + thinkingMode correctly', () => {
    const cmd = buildClaudeCmd({
      convId: 'conv-uuid-42',
      systemPromptFile: '/tmp/sp.txt',
      modelId: 'claude-sonnet-4-6',
      thinkingMode: 'disabled',
    })
    expect(cmd).toContain('--resume conv-uuid-42')
    expect(cmd).toContain("$(cat '/tmp/sp.txt')")
    expect(cmd).toContain('--model claude-sonnet-4-6')
    expect(cmd).toContain('alwaysThinkingEnabled')
  })

  it('combines all options including permissionMode', () => {
    const cmd = buildClaudeCmd({
      customBinaryName: 'claude-dev',
      convId: 'x',
      systemPromptFile: '/tmp/sp.txt',
      modelId: 'claude-haiku-4-5-20251001',
      thinkingMode: 'disabled',
      permissionMode: 'auto',
    })
    expect(cmd.startsWith('claude-dev ')).toBe(true)
    expect(cmd).toContain('--resume x')
    expect(cmd).toContain("$(cat '/tmp/sp.txt')")
    expect(cmd).toContain('--model claude-haiku-4-5-20251001')
    expect(cmd).toContain('--dangerously-skip-permissions')
  })
})

// ── claudeAdapter.buildCommand ────────────────────────────────────────────────

describe('claudeAdapter.buildCommand', () => {
  it('returns command "bash"', () => {
    const spec = claudeAdapter.buildCommand({})
    expect(spec.command).toBe('bash')
  })

  it('args start with -l and -c', () => {
    const spec = claudeAdapter.buildCommand({})
    expect(spec.args[0]).toBe('-l')
    expect(spec.args[1]).toBe('-c')
  })

  it('third arg is the built claude command string', () => {
    const spec = claudeAdapter.buildCommand({})
    expect(spec.args[2]).toContain('claude')
    expect(spec.args[2]).toContain('-p')
  })

  it('passes customBinaryName through to the bash command', () => {
    const spec = claudeAdapter.buildCommand({ customBinaryName: 'claude-pro2' })
    expect(spec.args[2]).toMatch(/^claude-pro2 /)
  })
})

// ── claudeAdapter.parseLine ───────────────────────────────────────────────────

describe('claudeAdapter.parseLine', () => {
  it('parses valid JSON and returns it as-is', () => {
    const line = '{"type":"text","text":"hello"}'
    expect(claudeAdapter.parseLine(line)).toEqual({ type: 'text', text: 'hello' })
  })

  it('returns null for non-JSON line', () => {
    expect(claudeAdapter.parseLine('not json')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(claudeAdapter.parseLine('')).toBeNull()
  })

  it('returns the parsed object for system events', () => {
    const line = '{"type":"system","subtype":"init","session_id":"s123"}'
    const event = claudeAdapter.parseLine(line)
    expect(event?.type).toBe('system')
  })

  it('returns null for malformed JSON (partial)', () => {
    expect(claudeAdapter.parseLine('{"type":')).toBeNull()
  })
})

// ── claudeAdapter.extractConvId ───────────────────────────────────────────────

describe('claudeAdapter.extractConvId', () => {
  it('extracts session_id from system:init event', () => {
    const event = { type: 'system', subtype: 'init', session_id: 'abc-uuid-123' } as any
    expect(claudeAdapter.extractConvId(event)).toBe('abc-uuid-123')
  })

  it('returns null for non-system event', () => {
    const event = { type: 'text', text: 'hello' } as any
    expect(claudeAdapter.extractConvId(event)).toBeNull()
  })

  it('returns null for system event with wrong subtype', () => {
    const event = { type: 'system', subtype: 'result', session_id: 'abc' } as any
    expect(claudeAdapter.extractConvId(event)).toBeNull()
  })

  it('returns null for system:init event without session_id', () => {
    const event = { type: 'system', subtype: 'init' } as any
    expect(claudeAdapter.extractConvId(event)).toBeNull()
  })

  it('returns null when session_id is not a string', () => {
    const event = { type: 'system', subtype: 'init', session_id: 42 } as any
    expect(claudeAdapter.extractConvId(event)).toBeNull()
  })
})

// ── claudeAdapter.prepareSystemPrompt ────────────────────────────────────────

describe('claudeAdapter.prepareSystemPrompt', () => {
  it('calls writeFileSync with the prompt content', async () => {
    const result = await claudeAdapter.prepareSystemPrompt('my prompt', '/tmp')
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    const [, content, encoding] = mockWriteFileSync.mock.calls[0]
    expect(content).toBe('my prompt')
    expect(encoding).toBe('utf-8')
  })

  it('returns a filePath inside the tempDir', async () => {
    const result = await claudeAdapter.prepareSystemPrompt('prompt', '/tmp')
    expect(result.filePath).toMatch(/ka-sp-\d+\.txt$/)
  })

  it('returns a cleanup function', async () => {
    const result = await claudeAdapter.prepareSystemPrompt('prompt', '/tmp')
    expect(typeof result.cleanup).toBe('function')
  })

  it('cleanup calls unlinkSync on the file', async () => {
    const result = await claudeAdapter.prepareSystemPrompt('prompt', '/tmp')
    await result.cleanup()
    expect(mockUnlinkSync).toHaveBeenCalledWith(result.filePath)
  })

  it('cleanup does not throw if unlinkSync throws (best-effort)', async () => {
    mockUnlinkSync.mockImplementation(() => { throw new Error('ENOENT') })
    const result = await claudeAdapter.prepareSystemPrompt('prompt', '/tmp')
    await expect(result.cleanup()).resolves.not.toThrow()
  })
})
