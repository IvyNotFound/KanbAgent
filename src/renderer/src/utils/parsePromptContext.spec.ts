/**
 * Unit tests for parsePromptContext utility (T1969).
 * Pure string function — no mocks needed.
 */
import { describe, it, expect } from 'vitest'
import { parsePromptContext } from './parsePromptContext'

describe('parsePromptContext', () => {
  it('text with "=== IDENTIFIANTS ===" + "\\n---\\n" separator → splits into context + base', () => {
    const text = '=== IDENTIFIANTS ===\nfoo: bar\n---\nThis is the real prompt'
    const result = parsePromptContext(text)
    expect(result.context).toBe('=== IDENTIFIANTS ===\nfoo: bar')
    expect(result.base).toBe('This is the real prompt')
  })

  it('"=== IDENTIFIANTS ===" with no "\\n---\\n" → context null, base = full text', () => {
    const text = '=== IDENTIFIANTS ===\nfoo: bar\nThis has no dash separator'
    const result = parsePromptContext(text)
    expect(result.context).toBeNull()
    expect(result.base).toBe(text)
  })

  it('" -> " with "Session préc.:" in prefix → extracts context', () => {
    const text = 'Session préc.: 2026-01-01 -> Start the agent task'
    const result = parsePromptContext(text)
    expect(result.context).toBe('Session préc.: 2026-01-01')
    expect(result.base).toBe('Start the agent task')
  })

  it('" -> " with "Tâches:" in prefix → extracts context', () => {
    const text = 'Tâches: T1234, T1235 -> Implement the feature'
    const result = parsePromptContext(text)
    expect(result.context).toBe('Tâches: T1234, T1235')
    expect(result.base).toBe('Implement the feature')
  })

  it('" -> " with unrecognised prefix → context null, base = full text', () => {
    const text = 'SomeOtherPrefix: value -> Do the thing'
    const result = parsePromptContext(text)
    expect(result.context).toBeNull()
    expect(result.base).toBe(text)
  })

  it('plain text without any separator → context null, base = original text', () => {
    const text = 'Just a plain prompt with no special markers'
    const result = parsePromptContext(text)
    expect(result.context).toBeNull()
    expect(result.base).toBe(text)
  })

  it('empty string → context null, base = empty string', () => {
    const result = parsePromptContext('')
    expect(result.context).toBeNull()
    expect(result.base).toBe('')
  })

  it('"=== IDENTIFIANTS ===" takes priority over " -> " when both present', () => {
    const text = '=== IDENTIFIANTS ===\nSession préc.: old -> leftover\n---\nActual base'
    const result = parsePromptContext(text)
    expect(result.context).toBe('=== IDENTIFIANTS ===\nSession préc.: old -> leftover')
    expect(result.base).toBe('Actual base')
  })
})
