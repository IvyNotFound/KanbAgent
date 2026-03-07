/**
 * Deep mutation-killing tests for the aider adapter (T1070).
 *
 * Targets:
 * - AIDER_CMD_REGEX: anchors, suffix pattern, non-hex/non-lowercase chars
 * - buildCommand: binaryName guard (falsy, valid, invalid)
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
  it('defaults to "aider" when binaryName is undefined', () => {
    const spec = aiderAdapter.buildCommand({})
    expect(spec.command).toBe('aider')
  })

  it('defaults to "aider" when binaryName is empty string (falsy)', () => {
    const spec = aiderAdapter.buildCommand({ binaryName: '' })
    expect(spec.command).toBe('aider')
  })

  it('defaults to "aider" when binaryName fails regex (invalid)', () => {
    const spec = aiderAdapter.buildCommand({ binaryName: 'rm -rf /' })
    expect(spec.command).toBe('aider')
  })

  it('uses binaryName when it matches AIDER_CMD_REGEX', () => {
    const spec = aiderAdapter.buildCommand({ binaryName: 'aider-dev' })
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

  it('binaryName exact name is in returned command field', () => {
    const spec = aiderAdapter.buildCommand({ binaryName: 'aider' })
    expect(spec.command).toBe('aider')
  })
})
