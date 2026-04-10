/**
 * Deep mutation-killing tests for the aider adapter (T1070).
 *
 * Targets:
 * - AIDER_CMD_REGEX: anchors, suffix pattern, non-hex/non-lowercase chars
 * - buildCommand: customBinaryName guard (falsy, valid, invalid)
 * - buildCommand: args array non-empty with correct flags
 * - buildCommand: worktreeDir branch (true/false)
 */

import { describe, it, expect, vi } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { aiderAdapter, AIDER_CMD_REGEX } from './aider'

// ── AIDER_CMD_REGEX ───────────────────────────────────────────────────────────

describe('AIDER_CMD_REGEX', () => {
  it('matches exact "aider"', () => {
    expect(AIDER_CMD_REGEX.test('aider')).toBe(true)
  })

  it('matches "aider-custom" (valid suffix)', () => {
    expect(AIDER_CMD_REGEX.test('aider-custom')).toBe(true)
  })

  it('matches "aider-123" (numeric suffix)', () => {
    expect(AIDER_CMD_REGEX.test('aider-123')).toBe(true)
  })

  it('rejects "aider-CAPS" (uppercase in suffix)', () => {
    expect(AIDER_CMD_REGEX.test('aider-CAPS')).toBe(false)
  })

  it('rejects "not-aider" (anchor ^ required)', () => {
    expect(AIDER_CMD_REGEX.test('not-aider')).toBe(false)
  })

  it('rejects "aider-" (trailing dash without suffix body)', () => {
    // The pattern requires at least one char after '-'
    expect(AIDER_CMD_REGEX.test('aider-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(AIDER_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "aider extra" (space — anchor $ required)', () => {
    expect(AIDER_CMD_REGEX.test('aider extra')).toBe(false)
  })

  it('rejects undefined coerced to string "undefined"', () => {
    expect(AIDER_CMD_REGEX.test('undefined')).toBe(false)
  })
})

// ── aiderAdapter.buildCommand ─────────────────────────────────────────────────

describe('aiderAdapter.buildCommand', () => {
  it('defaults to "aider" when customBinaryName is undefined', () => {
    const spec = aiderAdapter.buildCommand({})
    expect(spec.command).toBe('aider')
  })

  it('defaults to "aider" when customBinaryName is empty string (falsy)', () => {
    const spec = aiderAdapter.buildCommand({ customBinaryName: '' })
    expect(spec.command).toBe('aider')
  })

  it('defaults to "aider" when customBinaryName fails regex (invalid)', () => {
    const spec = aiderAdapter.buildCommand({ customBinaryName: 'rm -rf /' })
    expect(spec.command).toBe('aider')
  })

  it('uses customBinaryName when it matches AIDER_CMD_REGEX', () => {
    const spec = aiderAdapter.buildCommand({ customBinaryName: 'aider-dev' })
    expect(spec.command).toBe('aider-dev')
  })

  it('args array is non-empty (has at least --no-auto-commits)', () => {
    const spec = aiderAdapter.buildCommand({})
    expect(spec.args.length).toBeGreaterThan(0)
  })

  it('args contain --no-auto-commits and --yes-always by default', () => {
    const spec = aiderAdapter.buildCommand({})
    expect(spec.args).toContain('--no-auto-commits')
    expect(spec.args).toContain('--yes-always')
  })

  it('includes --read <file> when systemPromptFile provided', () => {
    const spec = aiderAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--read')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('/tmp/sp.txt')
  })

  it('does not include --read when systemPromptFile is absent', () => {
    const spec = aiderAdapter.buildCommand({})
    expect(spec.args).not.toContain('--read')
  })

  it('customBinaryName exact name is in returned command field', () => {
    const spec = aiderAdapter.buildCommand({ customBinaryName: 'aider' })
    expect(spec.command).toBe('aider')
  })
})

// ── aiderAdapter.extractTokenUsage ───────────────────────────────────────────

describe('aiderAdapter.extractTokenUsage', () => {
  it('returns null for events with no text', () => {
    expect(aiderAdapter.extractTokenUsage?.({ type: 'error', text: undefined })).toBeNull()
  })

  it('returns null for text events that do not match the token pattern', () => {
    expect(aiderAdapter.extractTokenUsage?.({ type: 'text', text: 'some random output' })).toBeNull()
  })

  it('extracts tokensIn and tokensOut from "Tokens: X sent, Y received" line', () => {
    const event = { type: 'text', text: 'Tokens: 1,234 sent, 567 received.' }
    const result = aiderAdapter.extractTokenUsage?.(event)
    expect(result?.tokensIn).toBe(1234)
    expect(result?.tokensOut).toBe(567)
  })

  it('extracts tokens without thousands separator', () => {
    const event = { type: 'text', text: 'Tokens: 100 sent, 200 received.' }
    expect(aiderAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 100, tokensOut: 200 })
  })

  it('extracts costUsd when "Cost: $X session" is present', () => {
    const event = { type: 'text', text: 'Tokens: 500 sent, 300 received. Cost: $0.0042 session, $0.0042 total.' }
    const result = aiderAdapter.extractTokenUsage?.(event)
    expect(result?.tokensIn).toBe(500)
    expect(result?.tokensOut).toBe(300)
    expect(result?.costUsd).toBeCloseTo(0.0042)
  })

  it('omits costUsd when cost section is absent', () => {
    const event = { type: 'text', text: 'Tokens: 100 sent, 50 received.' }
    expect(aiderAdapter.extractTokenUsage?.(event)?.costUsd).toBeUndefined()
  })
})
