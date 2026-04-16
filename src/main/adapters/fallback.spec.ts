/**
 * Tests for the fallback CLI adapter (T1953).
 *
 * Covers:
 * - parseLine: JSON with type, JSON without type, non-JSON, empty line
 * - buildCommand: customBinaryName handling
 * - prepareSystemPrompt: filePath empty + cleanup no-op
 */

import { describe, it, expect } from 'vitest'
import { fallbackAdapter } from './fallback'

// ── parseLine ─────────────────────────────────────────────────────────────────

describe('fallbackAdapter.parseLine', () => {
  it('returns parsed event when line is valid JSON with a string type field', () => {
    const line = JSON.stringify({ type: 'text', text: 'hello' })
    const result = fallbackAdapter.parseLine(line)
    expect(result).toEqual({ type: 'text', text: 'hello' })
  })

  it('wraps valid JSON without type field as {type:"text", text:line}', () => {
    const line = JSON.stringify({ message: 'no type here' })
    const result = fallbackAdapter.parseLine(line)
    expect(result).toEqual({ type: 'text', text: line })
  })

  it('wraps non-JSON line as {type:"text", text:line}', () => {
    const line = 'plain output from CLI'
    const result = fallbackAdapter.parseLine(line)
    expect(result).toEqual({ type: 'text', text: line })
  })

  it('returns null for empty string', () => {
    expect(fallbackAdapter.parseLine('')).toBeNull()
  })

  it('returns null for whitespace-only line', () => {
    expect(fallbackAdapter.parseLine('   ')).toBeNull()
  })

  it('preserves all fields when JSON has a valid type', () => {
    const line = JSON.stringify({ type: 'tool_use', id: 'abc', name: 'Bash', input: {} })
    const result = fallbackAdapter.parseLine(line)
    expect(result).toMatchObject({ type: 'tool_use', id: 'abc', name: 'Bash' })
  })

  it('wraps JSON whose type field is a number (not a string)', () => {
    const line = JSON.stringify({ type: 42 })
    const result = fallbackAdapter.parseLine(line)
    expect(result).toEqual({ type: 'text', text: line })
  })
})

// ── buildCommand ──────────────────────────────────────────────────────────────

describe('fallbackAdapter.buildCommand', () => {
  it('returns command equal to customBinaryName when provided', () => {
    const spec = fallbackAdapter.buildCommand({ customBinaryName: 'my-cli' })
    expect(spec.command).toBe('my-cli')
  })

  it('falls back to "unknown-cli" when customBinaryName is absent', () => {
    const spec = fallbackAdapter.buildCommand({})
    expect(spec.command).toBe('unknown-cli')
  })

  it('falls back to "unknown-cli" when customBinaryName is undefined', () => {
    const spec = fallbackAdapter.buildCommand({ customBinaryName: undefined })
    expect(spec.command).toBe('unknown-cli')
  })

  it('returns an empty args array', () => {
    const spec = fallbackAdapter.buildCommand({ customBinaryName: 'some-cli' })
    expect(spec.args).toEqual([])
  })

  it('returns SpawnSpec with both command and args keys', () => {
    const spec = fallbackAdapter.buildCommand({})
    expect(spec).toHaveProperty('command')
    expect(spec).toHaveProperty('args')
  })
})

// ── prepareSystemPrompt ───────────────────────────────────────────────────────

describe('fallbackAdapter.prepareSystemPrompt', () => {
  it('returns filePath as empty string', async () => {
    const result = await fallbackAdapter.prepareSystemPrompt('my prompt', '/tmp')
    expect(result.filePath).toBe('')
  })

  it('returns a cleanup function that is a no-op (resolves without error)', async () => {
    const result = await fallbackAdapter.prepareSystemPrompt('', '/tmp')
    await expect(result.cleanup()).resolves.toBeUndefined()
  })
})
