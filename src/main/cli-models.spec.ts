/**
 * Unit tests for cli-models pricing registry (T1924).
 *
 * Tests getModelPricing() lookup function across all CLIs and edge cases.
 * No Electron or Node.js dependencies — pure TypeScript module test.
 */

import { describe, it, expect } from 'vitest'
import { getModelPricing, CLI_STATIC_MODELS } from '../shared/cli-models'

describe('getModelPricing (T1924)', () => {
  // ── Anthropic models ─────────────────────────────────────────────────────────

  it('returns Sonnet 4.6 pricing for claude cli modelId "sonnet"', () => {
    const p = getModelPricing('sonnet', 'claude')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(3.00)
    expect(p!.output).toBe(15.00)
    expect(p!.cacheRead).toBe(0.30)
    expect(p!.cacheWrite).toBe(3.75)
  })

  it('returns Opus 4.7 pricing for claude cli modelId "claude-opus-4-7"', () => {
    const p = getModelPricing('claude-opus-4-7', 'claude')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(15.00)
    expect(p!.output).toBe(75.00)
    expect(p!.cacheRead).toBe(1.50)
    expect(p!.cacheWrite).toBe(18.75)
  })

  it('returns Haiku 4.5 pricing for claude cli modelId "haiku"', () => {
    const p = getModelPricing('haiku', 'claude')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(0.80)
    expect(p!.output).toBe(4.00)
    expect(p!.cacheRead).toBe(0.08)
    expect(p!.cacheWrite).toBe(1.00)
  })

  it('Opus pricing is ~5x Sonnet input price', () => {
    const sonnet = getModelPricing('sonnet', 'claude')!
    const opus = getModelPricing('claude-opus-4-7', 'claude')!
    expect(opus.input / sonnet.input).toBe(5)
  })

  // ── Aider full model IDs ──────────────────────────────────────────────────────

  it('returns Sonnet pricing for aider modelId "claude-sonnet-4-6"', () => {
    const p = getModelPricing('claude-sonnet-4-6', 'aider')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(3.00)
    expect(p!.output).toBe(15.00)
  })

  it('returns Opus pricing for aider modelId "claude-opus-4-7"', () => {
    const p = getModelPricing('claude-opus-4-7', 'aider')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(15.00)
  })

  it('returns GPT-4o pricing for aider modelId "gpt-4o"', () => {
    const p = getModelPricing('gpt-4o', 'aider')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(2.50)
    expect(p!.output).toBe(10.00)
    expect(p!.cacheRead).toBeUndefined()
  })

  // ── OpenAI / Codex models ─────────────────────────────────────────────────────

  it('returns o3 pricing for codex cli', () => {
    const p = getModelPricing('o3', 'codex')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(10.00)
    expect(p!.output).toBe(40.00)
  })

  it('returns o4-mini pricing for codex cli', () => {
    const p = getModelPricing('o4-mini', 'codex')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(1.10)
    expect(p!.output).toBe(4.40)
  })

  it('returns GPT-4.1 pricing for codex cli', () => {
    const p = getModelPricing('gpt-4.1', 'codex')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(2.00)
    expect(p!.output).toBe(8.00)
  })

  // ── Google Gemini ─────────────────────────────────────────────────────────────

  it('returns Gemini 2.5 Pro pricing for gemini cli', () => {
    const p = getModelPricing('gemini-2.5-pro', 'gemini')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(1.25)
    expect(p!.output).toBe(10.00)
  })

  it('returns Gemini 2.5 Flash pricing for gemini cli', () => {
    const p = getModelPricing('gemini-2.5-flash', 'gemini')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(0.15)
    expect(p!.output).toBe(0.60)
  })

  // ── Cross-CLI search (no cli specified) ────────────────────────────────────────

  it('finds sonnet pricing without specifying cli', () => {
    const p = getModelPricing('sonnet')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(3.00)
  })

  it('finds gpt-4o pricing without specifying cli', () => {
    const p = getModelPricing('gpt-4o')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(2.50)
  })

  it('finds claude-sonnet-4-6 pricing without specifying cli (used by aider/goose)', () => {
    const p = getModelPricing('claude-sonnet-4-6')
    expect(p).not.toBeNull()
    expect(p!.input).toBe(3.00)
    expect(p!.output).toBe(15.00)
  })

  // ── Unknown / null cases ───────────────────────────────────────────────────────

  it('returns null for unknown modelId', () => {
    expect(getModelPricing('unknown-model-xyz')).toBeNull()
  })

  it('returns null for empty string modelId', () => {
    expect(getModelPricing('')).toBeNull()
  })

  it('returns null when cli filter excludes the only matching model', () => {
    // 'sonnet' only exists in claude cli, not in gemini
    expect(getModelPricing('sonnet', 'gemini')).toBeNull()
  })

  // ── Registry coverage: every model with pricing has valid values ──────────────

  it('all models with pricing have positive input and output rates', () => {
    for (const models of Object.values(CLI_STATIC_MODELS)) {
      for (const model of (models ?? [])) {
        if (model.pricing) {
          expect(model.pricing.input, `${model.id}.input`).toBeGreaterThan(0)
          expect(model.pricing.output, `${model.id}.output`).toBeGreaterThan(0)
          if (model.pricing.cacheRead != null) {
            expect(model.pricing.cacheRead, `${model.id}.cacheRead`).toBeGreaterThan(0)
          }
          if (model.pricing.cacheWrite != null) {
            expect(model.pricing.cacheWrite, `${model.id}.cacheWrite`).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})
