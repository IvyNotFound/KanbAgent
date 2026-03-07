/**
 * Deep mutation-killing tests for the opencode adapter (T1070).
 *
 * Targets:
 * - OPENCODE_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: binaryName guard (falsy, valid, invalid)
 * - buildCommand: args array contains "run" subcommand
 * - buildCommand: systemPromptFile flag wiring
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

  it('args array is non-empty (at least "run" subcommand)', () => {
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

  it('includes --message @file when systemPromptFile provided', () => {
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--message')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('@/tmp/sp.txt')
  })

  it('does not include --message when systemPromptFile is absent', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).not.toContain('--message')
  })

  it('binaryName exact name is in returned command field', () => {
    const spec = opencodeAdapter.buildCommand({ binaryName: 'opencode' })
    expect(spec.command).toBe('opencode')
  })
})
