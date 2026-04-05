/**
 * Deep mutation-killing tests for the gemini adapter (T1070, T1245).
 *
 * Targets:
 * - GEMINI_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: binaryName guard (falsy, valid, invalid)
 * - buildCommand: headless mode via -p + --output-format stream-json
 * - parseLine: stream-json format (init, message, result)
 * - singleShotStdin flag
 */

import { describe, it, expect, vi } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { geminiAdapter, GEMINI_CMD_REGEX } from './gemini'

// ── GEMINI_CMD_REGEX ──────────────────────────────────────────────────────────

describe('GEMINI_CMD_REGEX', () => {
  it('matches exact "gemini"', () => {
    expect(GEMINI_CMD_REGEX.test('gemini')).toBe(true)
  })

  it('matches "gemini-custom" (valid suffix)', () => {
    expect(GEMINI_CMD_REGEX.test('gemini-custom')).toBe(true)
  })

  it('matches "gemini-123" (numeric suffix)', () => {
    expect(GEMINI_CMD_REGEX.test('gemini-123')).toBe(true)
  })

  it('rejects "gemini-CAPS" (uppercase in suffix)', () => {
    expect(GEMINI_CMD_REGEX.test('gemini-CAPS')).toBe(false)
  })

  it('rejects "not-gemini" (anchor ^ required)', () => {
    expect(GEMINI_CMD_REGEX.test('not-gemini')).toBe(false)
  })

  it('rejects "gemini-" (trailing dash without suffix body)', () => {
    expect(GEMINI_CMD_REGEX.test('gemini-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(GEMINI_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "gemini extra" (space — anchor $ required)', () => {
    expect(GEMINI_CMD_REGEX.test('gemini extra')).toBe(false)
  })
})

// ── geminiAdapter.buildCommand ────────────────────────────────────────────────

describe('geminiAdapter.buildCommand', () => {
  it('defaults to "gemini" when binaryName is undefined', () => {
    const spec = geminiAdapter.buildCommand({})
    expect(spec.command).toBe('gemini')
  })

  it('defaults to "gemini" when binaryName is empty string (falsy)', () => {
    const spec = geminiAdapter.buildCommand({ binaryName: '' })
    expect(spec.command).toBe('gemini')
  })

  it('defaults to "gemini" when binaryName fails regex (invalid)', () => {
    const spec = geminiAdapter.buildCommand({ binaryName: 'rm -rf /' })
    expect(spec.command).toBe('gemini')
  })

  it('uses binaryName when it matches GEMINI_CMD_REGEX', () => {
    const spec = geminiAdapter.buildCommand({ binaryName: 'gemini-dev' })
    expect(spec.command).toBe('gemini-dev')
  })

  it('args are empty by default (no initialMessage → interactive fallback)', () => {
    const spec = geminiAdapter.buildCommand({})
    expect(spec.args).toEqual([])
  })

  it('does not include -p by default (no initialMessage provided)', () => {
    const spec = geminiAdapter.buildCommand({})
    expect(spec.args).not.toContain('-p')
  })

  it('includes --output-format stream-json when initialMessage is provided', () => {
    const spec = geminiAdapter.buildCommand({ initialMessage: 'hello' })
    const idx = spec.args.indexOf('--output-format')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('stream-json')
  })

  it('includes -p <initialMessage> when initialMessage is provided', () => {
    const spec = geminiAdapter.buildCommand({ initialMessage: 'fix the bug' })
    const idx = spec.args.indexOf('-p')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('fix the bug')
  })

  it('--output-format appears before -p in args', () => {
    const spec = geminiAdapter.buildCommand({ initialMessage: 'test' })
    const fmtIdx = spec.args.indexOf('--output-format')
    const pIdx = spec.args.indexOf('-p')
    expect(fmtIdx).toBeGreaterThan(-1)
    expect(pIdx).toBeGreaterThan(-1)
    expect(fmtIdx).toBeLessThan(pIdx)
  })

  it('does not include --system-prompt (flag does not exist in gemini CLI)', () => {
    const spec = geminiAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    expect(spec.args).not.toContain('--system-prompt')
  })

  it('binaryName exact name is in returned command field', () => {
    const spec = geminiAdapter.buildCommand({ binaryName: 'gemini' })
    expect(spec.command).toBe('gemini')
  })

  it('includes -m <model> when model is provided', () => {
    const spec = geminiAdapter.buildCommand({ model: 'gemini-2.5-flash' })
    const idx = spec.args.indexOf('-m')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('gemini-2.5-flash')
  })

  it('does not include -m when model is not provided', () => {
    const spec = geminiAdapter.buildCommand({ initialMessage: 'hello' })
    expect(spec.args).not.toContain('-m')
  })

  it('includes both -m and -p when model and initialMessage are provided', () => {
    const spec = geminiAdapter.buildCommand({ model: 'gemini-2.5-flash', initialMessage: 'test' })
    expect(spec.args).toContain('-m')
    expect(spec.args).toContain('-p')
    expect(spec.args[spec.args.indexOf('-m') + 1]).toBe('gemini-2.5-flash')
    expect(spec.args[spec.args.indexOf('-p') + 1]).toBe('test')
  })

  it('-m appears before -p in args', () => {
    const spec = geminiAdapter.buildCommand({ model: 'gemini-2.5-pro', initialMessage: 'test' })
    const mIdx = spec.args.indexOf('-m')
    const pIdx = spec.args.indexOf('-p')
    expect(mIdx).toBeLessThan(pIdx)
  })

  it('includes --resume <convId> when convId is provided', () => {
    const spec = geminiAdapter.buildCommand({ convId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const idx = spec.args.indexOf('--resume')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('--resume appears before --output-format in args when both convId and initialMessage provided', () => {
    const spec = geminiAdapter.buildCommand({
      convId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      initialMessage: 'continue',
    })
    const resumeIdx = spec.args.indexOf('--resume')
    const fmtIdx = spec.args.indexOf('--output-format')
    expect(resumeIdx).toBeGreaterThan(-1)
    expect(fmtIdx).toBeGreaterThan(-1)
    expect(resumeIdx).toBeLessThan(fmtIdx)
  })

  it('does not include --resume when convId is not provided', () => {
    const spec = geminiAdapter.buildCommand({ initialMessage: 'hello' })
    expect(spec.args).not.toContain('--resume')
  })
})

// ── geminiAdapter.extractConvId ───────────────────────────────────────────────

describe('geminiAdapter.extractConvId', () => {
  it('returns session_id from system:init event', () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const event = { type: 'system' as const, subtype: 'init', session_id: uuid }
    expect(geminiAdapter.extractConvId!(event)).toBe(uuid)
  })

  it('returns null for system:init without session_id', () => {
    const event = { type: 'system' as const, subtype: 'init' }
    expect(geminiAdapter.extractConvId!(event)).toBeNull()
  })

  it('returns null for non-init system events', () => {
    const event = { type: 'system' as const, subtype: 'other', session_id: 'abc' }
    expect(geminiAdapter.extractConvId!(event)).toBeNull()
  })

  it('returns null for non-system events', () => {
    const event = { type: 'text' as const, text: 'hello' }
    expect(geminiAdapter.extractConvId!(event)).toBeNull()
  })
})

// ── geminiAdapter.singleShotStdin ─────────────────────────────────────────────

describe('geminiAdapter.singleShotStdin', () => {
  it('is true (gemini exits after one -p response)', () => {
    expect(geminiAdapter.singleShotStdin).toBe(true)
  })
})

// ── geminiAdapter.formatStdinMessage ─────────────────────────────────────────

describe('geminiAdapter.formatStdinMessage', () => {
  it('returns plain text with trailing newline', () => {
    expect(geminiAdapter.formatStdinMessage?.('hello')).toBe('hello\n')
  })

  it('preserves internal whitespace', () => {
    expect(geminiAdapter.formatStdinMessage?.('hello world')).toBe('hello world\n')
  })

  it('handles empty string', () => {
    expect(geminiAdapter.formatStdinMessage?.('')).toBe('\n')
  })
})

// ── geminiAdapter.parseLine ───────────────────────────────────────────────────

describe('geminiAdapter.parseLine', () => {
  // Blank lines
  it('returns null for empty string', () => {
    expect(geminiAdapter.parseLine('')).toBeNull()
  })

  it('returns null for whitespace-only line', () => {
    expect(geminiAdapter.parseLine('   ')).toBeNull()
  })

  // init event
  it('returns system:init event for type:init with session_id', () => {
    const line = JSON.stringify({ type: 'init', session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', model: 'gemini-3' })
    expect(geminiAdapter.parseLine(line)).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
  })

  it('returns null for type:init without session_id', () => {
    const line = JSON.stringify({ type: 'init', model: 'gemini-3' })
    expect(geminiAdapter.parseLine(line)).toBeNull()
  })

  // message events — user role
  it('returns null for type:message role:user (echo of input)', () => {
    const line = JSON.stringify({ type: 'message', role: 'user', content: 'hello' })
    expect(geminiAdapter.parseLine(line)).toBeNull()
  })

  // message events — assistant role (delta chunks)
  it('returns text event for type:message role:assistant delta:true', () => {
    const line = JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello,', delta: true })
    expect(geminiAdapter.parseLine(line)).toEqual({ type: 'text', text: 'Hello,' })
  })

  it('returns text event for type:message role:assistant without delta flag', () => {
    const line = JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello world!' })
    expect(geminiAdapter.parseLine(line)).toEqual({ type: 'text', text: 'Hello world!' })
  })

  it('returns null for type:message role:assistant with empty content', () => {
    const line = JSON.stringify({ type: 'message', role: 'assistant', content: '' })
    expect(geminiAdapter.parseLine(line)).toBeNull()
  })

  // result events
  it('returns system:stats event for type:result status:success (for token accounting)', () => {
    const line = JSON.stringify({ type: 'result', status: 'success', stats: { total_tokens: 100 } })
    const result = geminiAdapter.parseLine(line)
    expect(result?.type).toBe('system')
    expect((result as any).subtype).toBe('stats')
    expect((result as any).stats).toEqual({ total_tokens: 100 })
  })

  it('returns error event for type:result status:error with string error', () => {
    const line = JSON.stringify({ type: 'result', status: 'error', error: 'rate limit exceeded' })
    const result = geminiAdapter.parseLine(line)
    expect(result).toEqual({ type: 'error', text: 'rate limit exceeded' })
  })

  it('returns error event for type:result status:error with no error field', () => {
    const line = JSON.stringify({ type: 'result', status: 'error' })
    const result = geminiAdapter.parseLine(line)
    expect(result?.type).toBe('error')
    expect(result?.text).toContain('error')
  })

  // tool_use events
  it('converts type:tool_use to assistant event with tool_use block', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'shell', input: { cmd: 'ls' } })
    const event = geminiAdapter.parseLine(line)
    expect(event?.type).toBe('assistant')
    expect(event?.message?.content[0]?.type).toBe('tool_use')
    expect(event?.message?.content[0]?.name).toBe('shell')
    expect(event?.message?.content[0]?.input).toEqual({ cmd: 'ls' })
  })

  it('converts type:tool_use with id field to tool_use_id', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'bash', input: {}, id: 'call_gemini_001' })
    const event = geminiAdapter.parseLine(line)
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_gemini_001')
  })

  it('converts type:tool_use with unknown name to "unknown" fallback', () => {
    const line = JSON.stringify({ type: 'tool_use', input: {} })
    const event = geminiAdapter.parseLine(line)
    expect(event?.message?.content[0]?.name).toBe('unknown')
  })

  it('converts type:tool_use with null input to empty object fallback', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'shell', input: null })
    const event = geminiAdapter.parseLine(line)
    expect(event?.message?.content[0]?.input).toEqual({})
  })

  // Unknown type
  it('returns null for unknown event types (lifecycle metadata)', () => {
    const line = JSON.stringify({ type: 'lifecycle_unknown', data: 'ignored' })
    expect(geminiAdapter.parseLine(line)).toBeNull()
  })

  // Non-JSON fallback
  it('returns text event for non-JSON lines (e.g. "Loaded cached credentials.")', () => {
    expect(geminiAdapter.parseLine('Loaded cached credentials.')).toEqual({
      type: 'text',
      text: 'Loaded cached credentials.',
    })
  })
})

// ── geminiAdapter.extractTokenUsage ──────────────────────────────────────────

describe('geminiAdapter.extractTokenUsage', () => {
  it('returns null for non-stats events', () => {
    expect(geminiAdapter.extractTokenUsage?.({ type: 'text', text: 'hello' })).toBeNull()
  })

  it('returns null for system events without stats subtype', () => {
    expect(geminiAdapter.extractTokenUsage?.({ type: 'system' })).toBeNull()
  })

  it('returns null when stats field is absent', () => {
    const event = { type: 'system', subtype: 'stats', stats: null } as any
    expect(geminiAdapter.extractTokenUsage?.(event)).toBeNull()
  })

  it('extracts inputTokenCount + outputTokenCount when available', () => {
    const event = { type: 'system', subtype: 'stats', stats: { inputTokenCount: 120, outputTokenCount: 45 } } as any
    expect(geminiAdapter.extractTokenUsage?.(event)).toEqual({ tokensIn: 120, tokensOut: 45 })
  })

  it('falls back to total_tokens as tokensOut when split counts are absent', () => {
    const event = { type: 'system', subtype: 'stats', stats: { total_tokens: 200 } } as any
    const result = geminiAdapter.extractTokenUsage?.(event)
    expect(result?.tokensIn).toBe(0)
    expect(result?.tokensOut).toBe(200)
  })

  it('returns zeroes when stats has no recognized count fields', () => {
    const event = { type: 'system', subtype: 'stats', stats: {} } as any
    expect(geminiAdapter.extractTokenUsage?.(event)).toEqual({ tokensIn: 0, tokensOut: 0 })
  })
})
