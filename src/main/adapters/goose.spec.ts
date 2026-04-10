/**
 * Deep mutation-killing tests for the goose adapter (T1070).
 *
 * Targets:
 * - GOOSE_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: customBinaryName guard (falsy, valid, invalid)
 * - buildCommand: args array contains "run" and "--with-builtin developer"
 * - buildCommand: systemPromptFile flag wiring
 */

import { describe, it, expect, vi } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { gooseAdapter, GOOSE_CMD_REGEX } from './goose'

// ── GOOSE_CMD_REGEX ───────────────────────────────────────────────────────────

describe('GOOSE_CMD_REGEX', () => {
  it('matches exact "goose"', () => {
    expect(GOOSE_CMD_REGEX.test('goose')).toBe(true)
  })

  it('matches "goose-custom" (valid suffix)', () => {
    expect(GOOSE_CMD_REGEX.test('goose-custom')).toBe(true)
  })

  it('matches "goose-123" (numeric suffix)', () => {
    expect(GOOSE_CMD_REGEX.test('goose-123')).toBe(true)
  })

  it('rejects "goose-CAPS" (uppercase in suffix)', () => {
    expect(GOOSE_CMD_REGEX.test('goose-CAPS')).toBe(false)
  })

  it('rejects "not-goose" (anchor ^ required)', () => {
    expect(GOOSE_CMD_REGEX.test('not-goose')).toBe(false)
  })

  it('rejects "goose-" (trailing dash without suffix body)', () => {
    expect(GOOSE_CMD_REGEX.test('goose-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(GOOSE_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "goose extra" (space — anchor $ required)', () => {
    expect(GOOSE_CMD_REGEX.test('goose extra')).toBe(false)
  })
})

// ── gooseAdapter.buildCommand ─────────────────────────────────────────────────

describe('gooseAdapter.buildCommand', () => {
  it('defaults to "goose" when customBinaryName is undefined', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.command).toBe('goose')
  })

  it('defaults to "goose" when customBinaryName is empty string (falsy)', () => {
    const spec = gooseAdapter.buildCommand({ customBinaryName: '' })
    expect(spec.command).toBe('goose')
  })

  it('defaults to "goose" when customBinaryName fails regex (invalid)', () => {
    const spec = gooseAdapter.buildCommand({ customBinaryName: 'rm -rf /' })
    expect(spec.command).toBe('goose')
  })

  it('uses customBinaryName when it matches GOOSE_CMD_REGEX', () => {
    const spec = gooseAdapter.buildCommand({ customBinaryName: 'goose-dev' })
    expect(spec.command).toBe('goose-dev')
  })

  it('args array is non-empty (at least "run" and developer flags)', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.args.length).toBeGreaterThan(0)
  })

  it('args contain "run" subcommand by default', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.args).toContain('run')
  })

  it('args contain "--with-builtin" and "developer"', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.args).toContain('--with-builtin')
    expect(spec.args).toContain('developer')
  })

  it('"--with-builtin" directly precedes "developer" in args', () => {
    const spec = gooseAdapter.buildCommand({})
    const idx = spec.args.indexOf('--with-builtin')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('developer')
  })

  it('includes --system-prompt <file> when systemPromptFile provided', () => {
    const spec = gooseAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--system-prompt')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('/tmp/sp.txt')
  })

  it('does not include --system-prompt when systemPromptFile is absent', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.args).not.toContain('--system-prompt')
  })

  it('customBinaryName exact name is in returned command field', () => {
    const spec = gooseAdapter.buildCommand({ customBinaryName: 'goose' })
    expect(spec.command).toBe('goose')
  })

  it('injects --model flag when modelId is provided (T1822)', () => {
    const spec = gooseAdapter.buildCommand({ modelId: 'claude-sonnet-4-6' })
    expect(spec.args).toContain('--model')
    const idx = spec.args.indexOf('--model')
    expect(spec.args[idx + 1]).toBe('claude-sonnet-4-6')
  })

  it('does not inject --model when modelId is absent (T1822)', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.args).not.toContain('--model')
  })
})
