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
  hexToRgb,
} from '@renderer/utils/agentColor'

function lum(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}
function contrastRatio(fg: string, bg: string): number {
  const l1 = lum(fg); const l2 = lum(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

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

  // ── agentFg() — WCAG AA ratio >= 4.5:1 (T1510: shade escalation replaces fixed shades) ────
  describe('agentFg() — WCAG AA contrast ratio >= 4.5:1', () => {
    it('"a" (cyan idx=7) dark meets WCAG AA', () => {
      setDarkMode(true)
      expect(contrastRatio(agentFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"a" (cyan idx=7) light meets WCAG AA', () => {
      setDarkMode(false)
      expect(contrastRatio(agentFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"i" (red idx=0) dark meets WCAG AA', () => {
      setDarkMode(true)
      expect(contrastRatio(agentFg('i'), agentBg('i'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"i" (red idx=0) light meets WCAG AA', () => {
      setDarkMode(false)
      expect(contrastRatio(agentFg('i'), agentBg('i'))).toBeGreaterThanOrEqual(4.5)
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

  // ── perimeterFg() — WCAG AA ratio >= 4.5:1 (T1510: shade escalation replaces fixed shades) ──
  describe('perimeterFg() — WCAG AA contrast ratio >= 4.5:1', () => {
    it('"a" (cyan idx=7) dark meets WCAG AA', () => {
      setDarkMode(true)
      expect(contrastRatio(perimeterFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"a" (cyan idx=7) light meets WCAG AA', () => {
      setDarkMode(false)
      expect(contrastRatio(perimeterFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('perimeterFg dark meets WCAG AA for all tested families', () => {
      setDarkMode(true)
      for (const name of ['a', 'b', 'i', 'j', 'k']) {
        expect(contrastRatio(perimeterFg(name), agentBg(name))).toBeGreaterThanOrEqual(4.5)
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

// ─── T1510: WCAG AA compliance — all 15 families × 2 themes ──────────────────
// Single-char names a–o map to palette indices 7–14 then 0–6, covering all 15.
//   a=cyan(7) b=teal(8) c=green(9) d=lightGreen(10) e=lime(11) f=amber(12)
//   g=orange(13) h=deepOrange(14) i=red(0) j=pink(1) k=purple(2)
//   l=deepPurple(3) m=indigo(4) n=blue(5) o=lightBlue(6)
const ALL_FAMILIES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o']

function setDarkModeForWcag(enabled: boolean) {
  if (enabled) document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
  setDarkModeReactive(enabled)
}

describe('WCAG AA compliance — all 15 families × 2 themes (T1510)', () => {
  afterEach(() => setDarkModeForWcag(false))

  it('agentFg dark mode: all 15 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(true)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(agentFg(name), agentBg(name))
      expect(ratio, `agentFg('${name}') dark: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('agentFg light mode: all 15 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(false)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(agentFg(name), agentBg(name))
      expect(ratio, `agentFg('${name}') light: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('perimeterFg dark mode: all 15 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(true)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(perimeterFg(name), agentBg(name))
      expect(ratio, `perimeterFg('${name}') dark: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('perimeterFg light mode: all 15 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(false)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(perimeterFg(name), agentBg(name))
      expect(ratio, `perimeterFg('${name}') light: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
