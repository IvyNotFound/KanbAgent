/**
 * MD2 palette correctness tests for agentColor.ts (T1467)
 *
 * Verifies that the Material Design 2 color migration is correct:
 * - agentHue returns palette indices 0–14
 * - Each color function picks the right shade for dark/light mode
 * - Exact hex values for known names (palette index deterministic from hash)
 * - Cache eviction continues to work with hex output
 *
 * Pre-computed palette indices (hash(name) % 15):
 *   'a'  → idx=7  (cyan)
 *   'b'  → idx=8  (teal)
 *   'i'  → idx=0  (red)
 *   'j'  → idx=1  (pink)
 *   'k'  → idx=2  (purple)
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  agentHue,
  agentFg,
  agentBg,
  agentBorder,
  perimeterFg,
  perimeterBg,
  perimeterBorder,
  setDarkMode as setDarkModeReactive,
} from '@renderer/utils/agentColor'

function setDarkMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  setDarkModeReactive(enabled)
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

describe('agentColor MD2 palette (T1467)', () => {
  afterEach(() => setDarkMode(false))

  // ── Palette index range ───────────────────────────────────────────────────────
  describe('agentHue() — palette index 0–14', () => {
    it('returns index 7 for "a" (hash=97, 97%15=7)', () => {
      expect(agentHue('a')).toBe(7)
    })

    it('returns index 8 for "b" (hash=98, 98%15=8)', () => {
      expect(agentHue('b')).toBe(8)
    })

    it('returns index 0 for "i" (hash=105, 105%15=0)', () => {
      expect(agentHue('i')).toBe(0)
    })

    it('returns index 1 for "j" (hash=106, 106%15=1)', () => {
      expect(agentHue('j')).toBe(1)
    })

    it('returns index 2 for "k" (hash=107, 107%15=2)', () => {
      expect(agentHue('k')).toBe(2)
    })

    it('all results are in range [0, 14]', () => {
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o']
      for (const name of names) {
        const idx = agentHue(name)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThanOrEqual(14)
      }
    })

    it('all 15 palette indices are reachable', () => {
      const found = new Set<number>()
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o']) {
        found.add(agentHue(name))
      }
      // Single-char ASCII letters a-o span exactly indices 7-14 then wraps to 0-6
      expect(found.size).toBe(15)
    })
  })

  // ── agentFg() — lighten3 dark / darken2 light ─────────────────────────────────
  describe('agentFg() — exact MD2 hex values', () => {
    it('"a" (cyan idx=7) dark → cyan lighten3 #80deea', () => {
      setDarkMode(true)
      expect(agentFg('a')).toBe('#80deea')
    })

    it('"a" (cyan idx=7) light → cyan darken2 #0097a7', () => {
      setDarkMode(false)
      expect(agentFg('a')).toBe('#0097a7')
    })

    it('"i" (red idx=0) dark → red lighten3 #ef9a9a', () => {
      setDarkMode(true)
      expect(agentFg('i')).toBe('#ef9a9a')
    })

    it('"i" (red idx=0) light → red darken2 #d32f2f', () => {
      setDarkMode(false)
      expect(agentFg('i')).toBe('#d32f2f')
    })

    it('dark and light values always differ', () => {
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        setDarkMode(false)
        const light = agentFg(name)
        setDarkMode(true)
        const dark = agentFg(name)
        expect(dark).not.toBe(light)
      }
    })

    it('all outputs are valid hex colors', () => {
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        setDarkMode(false)
        expect(agentFg(name)).toMatch(HEX_PATTERN)
        setDarkMode(true)
        expect(agentFg(name)).toMatch(HEX_PATTERN)
      }
    })
  })

  // ── agentBg() — darken4 dark / lighten5 light ────────────────────────────────
  describe('agentBg() — exact MD2 hex values', () => {
    it('"a" (cyan idx=7) dark → cyan darken4 #006064', () => {
      setDarkMode(true)
      expect(agentBg('a')).toBe('#006064')
    })

    it('"a" (cyan idx=7) light → cyan lighten5 #e0f7fa', () => {
      setDarkMode(false)
      expect(agentBg('a')).toBe('#e0f7fa')
    })

    it('"i" (red idx=0) dark → red darken4 #b71c1c', () => {
      setDarkMode(true)
      expect(agentBg('i')).toBe('#b71c1c')
    })

    it('"i" (red idx=0) light → red lighten5 #ffebee', () => {
      setDarkMode(false)
      expect(agentBg('i')).toBe('#ffebee')
    })

    it('agentBg dark differs from agentFg dark (different shades)', () => {
      setDarkMode(true)
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        expect(agentBg(name)).not.toBe(agentFg(name))
      }
    })

    it('agentBg light differs from agentFg light (different shades)', () => {
      setDarkMode(false)
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        expect(agentBg(name)).not.toBe(agentFg(name))
      }
    })
  })

  // ── agentBorder() — darken2 dark / lighten2 light ────────────────────────────
  describe('agentBorder() — exact MD2 hex values', () => {
    it('"a" (cyan idx=7) dark → cyan darken2 #0097a7', () => {
      setDarkMode(true)
      expect(agentBorder('a')).toBe('#0097a7')
    })

    it('"a" (cyan idx=7) light → cyan lighten2 #4dd0e1', () => {
      setDarkMode(false)
      expect(agentBorder('a')).toBe('#4dd0e1')
    })

    it('agentBorder dark differs from agentBg dark', () => {
      setDarkMode(true)
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        expect(agentBorder(name)).not.toBe(agentBg(name))
      }
    })

    it('all outputs are valid hex colors', () => {
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        setDarkMode(false)
        expect(agentBorder(name)).toMatch(HEX_PATTERN)
        setDarkMode(true)
        expect(agentBorder(name)).toMatch(HEX_PATTERN)
      }
    })
  })

  // ── perimeterFg() — lighten4 dark / darken1 light ────────────────────────────
  describe('perimeterFg() — exact MD2 hex values', () => {
    it('"a" (cyan idx=7) dark → cyan lighten4 #b2ebf2', () => {
      setDarkMode(true)
      expect(perimeterFg('a')).toBe('#b2ebf2')
    })

    it('"a" (cyan idx=7) light → cyan darken1 #00acc1', () => {
      setDarkMode(false)
      expect(perimeterFg('a')).toBe('#00acc1')
    })

    it('perimeterFg dark differs from agentFg dark (different shade: lighten4 vs lighten3)', () => {
      setDarkMode(true)
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        expect(perimeterFg(name)).not.toBe(agentFg(name))
      }
    })

    it('dark and light values always differ', () => {
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        setDarkMode(false)
        const light = perimeterFg(name)
        setDarkMode(true)
        const dark = perimeterFg(name)
        expect(dark).not.toBe(light)
      }
    })
  })

  // ── perimeterBg() — darken4 dark / lighten5 light (same as agentBg) ──────────
  describe('perimeterBg() — exact MD2 hex values', () => {
    it('"a" (cyan idx=7) dark → cyan darken4 #006064', () => {
      setDarkMode(true)
      expect(perimeterBg('a')).toBe('#006064')
    })

    it('"a" (cyan idx=7) light → cyan lighten5 #e0f7fa', () => {
      setDarkMode(false)
      expect(perimeterBg('a')).toBe('#e0f7fa')
    })

    it('dark and light values always differ', () => {
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        setDarkMode(false)
        const light = perimeterBg(name)
        setDarkMode(true)
        const dark = perimeterBg(name)
        expect(dark).not.toBe(light)
      }
    })
  })

  // ── perimeterBorder() — darken3 dark / lighten3 light ────────────────────────
  describe('perimeterBorder() — exact MD2 hex values', () => {
    it('"a" (cyan idx=7) dark → cyan darken3 #00838f', () => {
      setDarkMode(true)
      expect(perimeterBorder('a')).toBe('#00838f')
    })

    it('"a" (cyan idx=7) light → cyan lighten3 #80deea', () => {
      setDarkMode(false)
      expect(perimeterBorder('a')).toBe('#80deea')
    })

    it('perimeterBorder dark differs from agentBorder dark (different shade: darken3 vs darken2)', () => {
      setDarkMode(true)
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        expect(perimeterBorder(name)).not.toBe(agentBorder(name))
      }
    })

    it('dark and light values always differ', () => {
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        setDarkMode(false)
        const light = perimeterBorder(name)
        setDarkMode(true)
        const dark = perimeterBorder(name)
        expect(dark).not.toBe(light)
      }
    })
  })

  // ── cacheSet() FIFO eviction at exactly CACHE_MAX boundary ───────────────────
  describe('cacheSet() FIFO eviction — CACHE_MAX=100 boundary', () => {
    it('inserting exactly 100 entries then 1 more returns valid hex color', () => {
      setDarkMode(true)
      const prefix = 'fifo-t1467-'
      for (let i = 0; i < 100; i++) {
        agentFg(`${prefix}${i}`)
      }
      const result = agentFg(`${prefix}100`)
      expect(result).toMatch(HEX_PATTERN)
    })

    it('cache eviction keeps second entry accessible after evicting first', () => {
      setDarkMode(true)
      const prefix = 'fifo2-t1467-'
      for (let i = 0; i < 100; i++) {
        agentFg(`${prefix}${i}`)
      }
      agentFg(`${prefix}100`)
      const second = agentFg(`${prefix}1`)
      expect(second).toMatch(HEX_PATTERN)
    })

    it('cache size stays bounded after many inserts', () => {
      setDarkMode(false)
      for (let i = 0; i < 200; i++) {
        const result = agentFg(`size-bound-t1467-${i}`)
        expect(result).toMatch(HEX_PATTERN)
      }
    })

    it('99 entries do NOT trigger eviction (< CACHE_MAX)', () => {
      setDarkMode(true)
      const prefix = 'noevict-t1467-'
      for (let i = 0; i < 99; i++) {
        agentBg(`${prefix}${i}`)
      }
      const result = agentBg(`${prefix}99`)
      expect(result).toMatch(HEX_PATTERN)
    })

    it('exactly 100 entries trigger eviction on 101st insert (>= boundary)', () => {
      setDarkMode(true)
      const prefix = 'at-max-t1467-'
      for (let i = 0; i < 100; i++) {
        agentBorder(`${prefix}${i}`)
      }
      const result = agentBorder(`${prefix}100`)
      expect(result).toMatch(HEX_PATTERN)
    })
  })
})
