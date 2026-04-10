/**
 * Tests for the codex adapter (T1518).
 *
 * Targets:
 * - CODEX_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: customBinaryName guard, approval-mode, systemPromptFile
 * - parseLine: response.output_item.added function_call → tool_use block
 * - parseLine: other response.* events filtered (return null)
 * - parseLine: non-response JSON and plain text fallback
 * - extractTokenUsage: usage field extraction
 */

import { describe, it, expect, vi } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { codexAdapter, CODEX_CMD_REGEX } from './codex'

// ── CODEX_CMD_REGEX ───────────────────────────────────────────────────────────

describe('CODEX_CMD_REGEX', () => {
  it('matches exact "codex"', () => {
    expect(CODEX_CMD_REGEX.test('codex')).toBe(true)
  })

  it('matches "codex-custom" (valid suffix)', () => {
    expect(CODEX_CMD_REGEX.test('codex-custom')).toBe(true)
  })

  it('matches "codex-123" (numeric suffix)', () => {
    expect(CODEX_CMD_REGEX.test('codex-123')).toBe(true)
  })

  it('rejects "codex-CAPS" (uppercase in suffix)', () => {
    expect(CODEX_CMD_REGEX.test('codex-CAPS')).toBe(false)
  })

  it('rejects "not-codex" (anchor ^ required)', () => {
    expect(CODEX_CMD_REGEX.test('not-codex')).toBe(false)
  })

  it('rejects "codex-" (trailing dash without suffix body)', () => {
    expect(CODEX_CMD_REGEX.test('codex-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(CODEX_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "codex extra" (space — anchor $ required)', () => {
    expect(CODEX_CMD_REGEX.test('codex extra')).toBe(false)
  })
})

// ── codexAdapter.buildCommand ─────────────────────────────────────────────────

describe('codexAdapter.buildCommand', () => {
  it('defaults to "codex" when customBinaryName is undefined', () => {
    const spec = codexAdapter.buildCommand({})
    expect(spec.command).toBe('codex')
  })

  it('defaults to "codex" when customBinaryName is empty string (falsy)', () => {
    const spec = codexAdapter.buildCommand({ customBinaryName: '' })
    expect(spec.command).toBe('codex')
  })

  it('defaults to "codex" when customBinaryName fails regex (invalid)', () => {
    const spec = codexAdapter.buildCommand({ customBinaryName: 'rm -rf /' })
    expect(spec.command).toBe('codex')
  })

  it('uses customBinaryName when it matches CODEX_CMD_REGEX', () => {
    const spec = codexAdapter.buildCommand({ customBinaryName: 'codex-dev' })
    expect(spec.command).toBe('codex-dev')
  })

  it('args contain "--approval-mode" and "full-auto"', () => {
    const spec = codexAdapter.buildCommand({})
    expect(spec.args).toContain('--approval-mode')
    expect(spec.args).toContain('full-auto')
  })

  it('"--approval-mode" directly precedes "full-auto" in args', () => {
    const spec = codexAdapter.buildCommand({})
    const idx = spec.args.indexOf('--approval-mode')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('full-auto')
  })

  it('includes --instructions <file> when systemPromptFile provided', () => {
    const spec = codexAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--instructions')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('/tmp/sp.txt')
  })

  it('does not include --instructions when systemPromptFile is absent', () => {
    const spec = codexAdapter.buildCommand({})
    expect(spec.args).not.toContain('--instructions')
  })

  it('injects --model flag when modelId is provided (T1822)', () => {
    const spec = codexAdapter.buildCommand({ modelId: 'o4-mini' })
    expect(spec.args).toContain('--model')
    const idx = spec.args.indexOf('--model')
    expect(spec.args[idx + 1]).toBe('o4-mini')
  })

  it('does not inject --model when modelId is absent (T1822)', () => {
    const spec = codexAdapter.buildCommand({})
    expect(spec.args).not.toContain('--model')
  })
})

// ── codexAdapter.parseLine ────────────────────────────────────────────────────

describe('codexAdapter.parseLine', () => {
  it('returns null for blank line', () => {
    expect(codexAdapter.parseLine('')).toBeNull()
    expect(codexAdapter.parseLine('   ')).toBeNull()
  })

  // response.output_item.added with function_call → tool_use block
  it('converts response.output_item.added function_call to assistant tool_use block', () => {
    const line = JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'function_call', name: 'bash', arguments: '{"cmd":"ls -la"}', call_id: 'call_001' },
    })
    const event = codexAdapter.parseLine(line)
    expect(event?.type).toBe('assistant')
    expect(event?.message?.content[0]?.type).toBe('tool_use')
    expect(event?.message?.content[0]?.name).toBe('bash')
    expect(event?.message?.content[0]?.input).toEqual({ cmd: 'ls -la' })
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_001')
  })

  it('converts function_call with empty arguments to empty input object', () => {
    const line = JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'function_call', name: 'list_files', arguments: '{}' },
    })
    const event = codexAdapter.parseLine(line)
    expect(event?.message?.content[0]?.input).toEqual({})
  })

  it('converts function_call with malformed arguments to empty input object', () => {
    const line = JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'function_call', name: 'bash', arguments: 'not-json' },
    })
    const event = codexAdapter.parseLine(line)
    expect(event?.message?.content[0]?.input).toEqual({})
  })

  it('converts function_call with unknown name to "unknown" fallback', () => {
    const line = JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'function_call', arguments: '{}' },
    })
    const event = codexAdapter.parseLine(line)
    expect(event?.message?.content[0]?.name).toBe('unknown')
  })

  it('converts function_call without call_id to undefined tool_use_id', () => {
    const line = JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'function_call', name: 'bash', arguments: '{}' },
    })
    const event = codexAdapter.parseLine(line)
    expect(event?.message?.content[0]?.tool_use_id).toBeUndefined()
  })

  // response.output_item.added with non-function_call item → null
  it('returns null for response.output_item.added with non-function_call item', () => {
    const line = JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'message', content: 'hello' },
    })
    expect(codexAdapter.parseLine(line)).toBeNull()
  })

  it('returns null for response.output_item.added with no item field', () => {
    const line = JSON.stringify({ type: 'response.output_item.added' })
    expect(codexAdapter.parseLine(line)).toBeNull()
  })

  // Other response.* events filtered
  it('returns null for response.completed (lifecycle event)', () => {
    const line = JSON.stringify({ type: 'response.completed', response: { id: 'r1' } })
    expect(codexAdapter.parseLine(line)).toBeNull()
  })

  it('returns null for response.created (lifecycle event)', () => {
    const line = JSON.stringify({ type: 'response.created' })
    expect(codexAdapter.parseLine(line)).toBeNull()
  })

  it('returns null for response.in_progress (lifecycle event)', () => {
    const line = JSON.stringify({ type: 'response.in_progress' })
    expect(codexAdapter.parseLine(line)).toBeNull()
  })

  it('returns null for response.output_text.delta (streaming text delta)', () => {
    const line = JSON.stringify({ type: 'response.output_text.delta', delta: 'hello' })
    expect(codexAdapter.parseLine(line)).toBeNull()
  })

  // Non-response JSON events — pass through
  it('passes through non-response JSON events with type field', () => {
    const line = JSON.stringify({ type: 'text', text: 'hello world' })
    const event = codexAdapter.parseLine(line)
    expect(event?.type).toBe('text')
  })

  // JSON without type field
  it('wraps JSON without type field as text event', () => {
    const line = JSON.stringify({ data: 'no type here' })
    const event = codexAdapter.parseLine(line)
    expect(event?.type).toBe('text')
    expect(event?.text).toBe(line)
  })

  // Plain text fallback
  it('wraps plain text line as text event', () => {
    const event = codexAdapter.parseLine('some plain output')
    expect(event).toEqual({ type: 'text', text: 'some plain output' })
  })

  it('wraps non-JSON line as text event', () => {
    const event = codexAdapter.parseLine('Initializing agent...')
    expect(event).toEqual({ type: 'text', text: 'Initializing agent...' })
  })
})

// ── codexAdapter.extractTokenUsage ───────────────────────────────────────────

describe('codexAdapter.extractTokenUsage', () => {
  it('returns null for events with no usage field', () => {
    expect(codexAdapter.extractTokenUsage?.({ type: 'text', text: 'hello' })).toBeNull()
  })

  it('extracts input_tokens / output_tokens (OpenAI snake_case format)', () => {
    const event = { type: 'text', usage: { input_tokens: 120, output_tokens: 45 } } as any
    expect(codexAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 120, tokensOut: 45 })
  })

  it('extracts prompt_tokens / completion_tokens (legacy OpenAI format)', () => {
    const event = { type: 'text', usage: { prompt_tokens: 80, completion_tokens: 30 } } as any
    expect(codexAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 80, tokensOut: 30 })
  })

  it('returns zeroes when usage fields are missing', () => {
    const event = { type: 'text', usage: {} } as any
    expect(codexAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 0, tokensOut: 0 })
  })
})
