/**
 * Deep mutation-killing tests for the opencode adapter (T1070, updated T1084).
 *
 * Targets:
 * - OPENCODE_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: binaryName guard (falsy, valid, invalid)
 * - buildCommand: args array contains "run" subcommand and "--format json"
 * - buildCommand: no --message flag (opencode does not support it)
 * - parseLine: text, reasoning, error, lifecycle events, plain text fallback
 */

import { describe, it, expect, vi } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { opencodeAdapter, OPENCODE_CMD_REGEX } from './opencode'

// ── OPENCODE_CMD_REGEX ────────────────────────────────────────────────────────

describe('OPENCODE_CMD_REGEX', () => {
  it('matches exact "opencode"', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode')).toBe(true)
  })

  it('matches "opencode-custom" (valid suffix)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-custom')).toBe(true)
  })

  it('matches "opencode-123" (numeric suffix)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-123')).toBe(true)
  })

  it('rejects "opencode-CAPS" (uppercase in suffix)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-CAPS')).toBe(false)
  })

  it('rejects "not-opencode" (anchor ^ required)', () => {
    expect(OPENCODE_CMD_REGEX.test('not-opencode')).toBe(false)
  })

  it('rejects "opencode-" (trailing dash without suffix body)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(OPENCODE_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "opencode extra" (space — anchor $ required)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode extra')).toBe(false)
  })
})

// ── opencodeAdapter.buildCommand ──────────────────────────────────────────────

describe('opencodeAdapter.buildCommand', () => {
  it('defaults to "opencode" when binaryName is undefined', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.command).toBe('opencode')
  })

  it('defaults to "opencode" when binaryName is empty string (falsy)', () => {
    const spec = opencodeAdapter.buildCommand({ binaryName: '' })
    expect(spec.command).toBe('opencode')
  })

  it('defaults to "opencode" when binaryName fails regex (invalid)', () => {
    const spec = opencodeAdapter.buildCommand({ binaryName: 'rm -rf /' })
    expect(spec.command).toBe('opencode')
  })

  it('uses binaryName when it matches OPENCODE_CMD_REGEX', () => {
    const spec = opencodeAdapter.buildCommand({ binaryName: 'opencode-dev' })
    expect(spec.command).toBe('opencode-dev')
  })

  it('args array is non-empty (at least "run" and "--format" flags)', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args.length).toBeGreaterThan(0)
  })

  it('args contain "run" subcommand by default', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).toContain('run')
  })

  it('args[0] is "run" (subcommand position correct)', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args[0]).toBe('run')
  })

  it('args contain "--format" flag for JSONL output', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).toContain('--format')
  })

  it('args contain "json" as value for --format flag', () => {
    const spec = opencodeAdapter.buildCommand({})
    const idx = spec.args.indexOf('--format')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('json')
  })

  it('does not include --message flag (opencode has no --message @file support)', () => {
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    expect(spec.args).not.toContain('--message')
  })

  it('does not include --message when systemPromptFile is absent', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).not.toContain('--message')
  })

  it('binaryName exact name is in returned command field', () => {
    const spec = opencodeAdapter.buildCommand({ binaryName: 'opencode' })
    expect(spec.command).toBe('opencode')
  })

  it('appends initialMessage as positional arg when provided', () => {
    const spec = opencodeAdapter.buildCommand({ initialMessage: 'hello world' })
    expect(spec.args[spec.args.length - 1]).toBe('hello world')
  })

  it('does not append positional arg when initialMessage is absent', () => {
    const spec = opencodeAdapter.buildCommand({})
    // args: ['run', '--format', 'json'] — no extra positional
    expect(spec.args.length).toBe(3)
  })

  it('initialMessage is passed as a single arg (not split on spaces)', () => {
    const spec = opencodeAdapter.buildCommand({ initialMessage: 'fix the bug in app.ts' })
    const positionalArgs = spec.args.slice(3)
    expect(positionalArgs).toEqual(['fix the bug in app.ts'])
  })
})

// ── opencodeAdapter.parseLine ─────────────────────────────────────────────────

describe('opencodeAdapter.parseLine', () => {
  it('returns null for blank line', () => {
    expect(opencodeAdapter.parseLine('')).toBeNull()
    expect(opencodeAdapter.parseLine('   ')).toBeNull()
  })

  it('maps type:text event to StreamEvent text', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","text":"hello","sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'hello' })
  })

  it('maps type:reasoning event to StreamEvent text', () => {
    const event = opencodeAdapter.parseLine('{"type":"reasoning","text":"thinking...","sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'thinking...' })
  })

  it('maps type:error event using message field', () => {
    const event = opencodeAdapter.parseLine('{"type":"error","message":"something failed"}')
    expect(event).toEqual({ type: 'error', text: 'something failed' })
  })

  it('maps type:error event using text field when message absent', () => {
    const event = opencodeAdapter.parseLine('{"type":"error","text":"alt error"}')
    expect(event).toEqual({ type: 'error', text: 'alt error' })
  })

  it('returns null for type:tool_use (lifecycle event)', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","name":"bash","input":{}}')
    expect(event).toBeNull()
  })

  it('returns null for type:step_start (lifecycle event)', () => {
    const event = opencodeAdapter.parseLine('{"type":"step_start","timestamp":1234}')
    expect(event).toBeNull()
  })

  it('returns null for type:step_finish (lifecycle event)', () => {
    const event = opencodeAdapter.parseLine('{"type":"step_finish","duration":100}')
    expect(event).toBeNull()
  })

  it('falls back to plain text for non-JSON line', () => {
    const event = opencodeAdapter.parseLine('some plain text output')
    expect(event).toEqual({ type: 'text', text: 'some plain text output' })
  })

  it('maps type:text event with part-wrapped format (v1.3+)', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","part":{"text":"hello from part"},"sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'hello from part' })
  })

  it('maps type:reasoning event with part-wrapped format (v1.3+)', () => {
    const event = opencodeAdapter.parseLine('{"type":"reasoning","part":{"text":"thinking via part"},"sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'thinking via part' })
  })

  it('prefers part.text over flat text when both present', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","part":{"text":"from part"},"text":"from flat"}')
    expect(event).toEqual({ type: 'text', text: 'from part' })
  })

  it('falls back to flat text when part is present but has no text field', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","part":{"other":"field"},"text":"flat fallback"}')
    expect(event).toEqual({ type: 'text', text: 'flat fallback' })
  })

  it('falls back to raw line for type:text event with missing text field and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = '{"type":"text","other":"field"}'
    const event = opencodeAdapter.parseLine(raw)
    expect(event).toEqual({ type: 'text', text: raw })
    expect(warnSpy).toHaveBeenCalledWith(
      '[opencode] parseLine: text event with unknown structure, surfacing raw line'
    )
    warnSpy.mockRestore()
  })

  it('maps type:error with nested error.data.message (opencode v1.2+ format)', () => {
    const line = '{"type":"error","timestamp":1000,"sessionID":"s1","error":{"name":"ProviderAuthError","data":{"providerID":"google","message":"API key is missing"}}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event).toEqual({ type: 'error', text: 'API key is missing' })
  })

  it('falls back to raw line for type:error with unknown nested structure', () => {
    const raw = '{"type":"error","error":{"name":"UnknownError"}}'
    const event = opencodeAdapter.parseLine(raw)
    expect(event).toEqual({ type: 'error', text: raw })
  })
})

// ── opencodeAdapter.formatStdinMessage ────────────────────────────────────────

describe('opencodeAdapter.formatStdinMessage', () => {
  it('is defined (opencode uses plain-text stdin, not Claude JSONL)', () => {
    expect(typeof opencodeAdapter.formatStdinMessage).toBe('function')
  })

  it('returns text with a trailing newline', () => {
    const result = opencodeAdapter.formatStdinMessage!('hello world')
    expect(result).toBe('hello world\n')
  })

  it('preserves special characters in the message', () => {
    const result = opencodeAdapter.formatStdinMessage!('fix: add "quoted" & <html> stuff')
    expect(result).toBe('fix: add "quoted" & <html> stuff\n')
  })

  it('returns empty string + newline for empty input', () => {
    const result = opencodeAdapter.formatStdinMessage!('')
    expect(result).toBe('\n')
  })
})

// ── opencodeAdapter.singleShotStdin ──────────────────────────────────────────

describe('opencodeAdapter.singleShotStdin', () => {
  it('is true (opencode run reads one prompt per spawn — stdin must be closed after write)', () => {
    expect(opencodeAdapter.singleShotStdin).toBe(true)
  })
})
