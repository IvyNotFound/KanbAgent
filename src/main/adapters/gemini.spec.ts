/**
 * Deep mutation-killing tests for the gemini adapter (T1070).
 *
 * Targets:
 * - GEMINI_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: binaryName guard (falsy, valid, invalid)
 * - buildCommand: args array contains --headless flag
 * - buildCommand: systemPromptFile flag wiring
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

  it('args array is non-empty (at least --headless flag)', () => {
    const spec = geminiAdapter.buildCommand({})
    expect(spec.args.length).toBeGreaterThan(0)
  })

  it('args contain --headless by default', () => {
    const spec = geminiAdapter.buildCommand({})
    expect(spec.args).toContain('--headless')
  })

  it('includes --system-prompt <file> when systemPromptFile provided', () => {
    const spec = geminiAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--system-prompt')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('/tmp/sp.txt')
  })

  it('does not include --system-prompt when systemPromptFile is absent', () => {
    const spec = geminiAdapter.buildCommand({})
    expect(spec.args).not.toContain('--system-prompt')
  })

  it('binaryName exact name is in returned command field', () => {
    const spec = geminiAdapter.buildCommand({ binaryName: 'gemini' })
    expect(spec.command).toBe('gemini')
  })
})
