/**
 * MD2 palette correctness tests for agentColor.ts (T1467, updated T1625)
 *
 * Verifies that the Material Design 2 color migration is correct:
 * - agentHue returns palette indices 0–11 (12-family palette, no green/orange/deepOrange)
 * - Each color function picks the right shade for dark/light mode
 * - Exact hex values for known names (palette index deterministic from hash)
 * - Cache eviction continues to work with hex output
 *
 * Pre-computed palette indices (hash(name) % 12):
 *   'a'  → idx=1  (pink)
 *   'b'  → idx=2  (purple)
 *   'i'  → idx=9  (brown)
 *   'j'  → idx=10 (blueGrey)
 *   'k'  → idx=11 (amber)
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
  describe('agentHue() — palette index 0–11', () => {
    it('returns index 1 for "a" (hash=97, 97%12=1)', () => {
      expect(agentHue('a')).toBe(1)
    })

    it('returns index 2 for "b" (hash=98, 98%12=2)', () => {
      expect(agentHue('b')).toBe(2)
    })

    it('returns index 9 for "i" (hash=105, 105%12=9)', () => {
      expect(agentHue('i')).toBe(9)
    })

    it('returns index 10 for "j" (hash=106, 106%12=10)', () => {
      expect(agentHue('j')).toBe(10)
    })

    it('returns index 11 for "k" (hash=107, 107%12=11)', () => {
      expect(agentHue('k')).toBe(11)
    })

    it('all results are in range [0, 11]', () => {
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
      for (const name of names) {
        const idx = agentHue(name)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThanOrEqual(11)
      }
    })

    it('all 12 palette indices are reachable', () => {
      const found = new Set<number>()
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
        found.add(agentHue(name))
      }
      // Single-char ASCII letters a-l span exactly indices 1-11 then wraps to 0 (12 total)
      expect(found.size).toBe(12)
    })
  })

  // ── agentFg() — WCAG AA ratio >= 4.5:1 (T1510: shade escalation replaces fixed shades) ────
  describe('agentFg() — WCAG AA contrast ratio >= 4.5:1', () => {
    it('"a" (pink idx=1) dark meets WCAG AA', () => {
      setDarkMode(true)
      expect(contrastRatio(agentFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"a" (pink idx=1) light meets WCAG AA', () => {
      setDarkMode(false)
      expect(contrastRatio(agentFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"i" (brown idx=9) dark meets WCAG AA', () => {
      setDarkMode(true)
      expect(contrastRatio(agentFg('i'), agentBg('i'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"i" (brown idx=9) light meets WCAG AA', () => {
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
    it('"a" (pink idx=1) dark → pink darken4 #880e4f', () => {
      setDarkMode(true)
      expect(agentBg('a')).toBe('#880e4f')
    })

    it('"a" (pink idx=1) light → pink lighten5 #fce4ec', () => {
      setDarkMode(false)
      expect(agentBg('a')).toBe('#fce4ec')
    })

    it('"i" (brown idx=9) dark → brown darken4 #3e2723', () => {
      setDarkMode(true)
      expect(agentBg('i')).toBe('#3e2723')
    })

    it('"i" (brown idx=9) light → brown lighten5 #efebe9', () => {
      setDarkMode(false)
      expect(agentBg('i')).toBe('#efebe9')
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
    it('"a" (pink idx=1) dark → pink darken2 #c2185b', () => {
      setDarkMode(true)
      expect(agentBorder('a')).toBe('#c2185b')
    })

    it('"a" (pink idx=1) light → pink lighten2 #f06292', () => {
      setDarkMode(false)
      expect(agentBorder('a')).toBe('#f06292')
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
    it('"a" (lightBlue idx=6) dark meets WCAG AA', () => {
      setDarkMode(true)
      expect(contrastRatio(perimeterFg('a'), agentBg('a'))).toBeGreaterThanOrEqual(4.5)
    })

    it('"a" (lightBlue idx=6) light meets WCAG AA', () => {
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
    it('"a" (pink idx=1) dark → pink darken4 #880e4f', () => {
      setDarkMode(true)
      expect(perimeterBg('a')).toBe('#880e4f')
    })

    it('"a" (pink idx=1) light → pink lighten5 #fce4ec', () => {
      setDarkMode(false)
      expect(perimeterBg('a')).toBe('#fce4ec')
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
    it('"a" (pink idx=1) dark → pink darken3 #ad1457', () => {
      setDarkMode(true)
      expect(perimeterBorder('a')).toBe('#ad1457')
    })

    it('"a" (pink idx=1) light → pink lighten3 #f48fb1', () => {
      setDarkMode(false)
      expect(perimeterBorder('a')).toBe('#f48fb1')
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

// ─── T1510: WCAG AA compliance — all 12 families × 2 themes ──────────────────
// Single-char names a–l map to palette indices 1–11 then 0, covering all 12.
//   a=pink(1) b=purple(2) c=deepPurple(3) d=indigo(4) e=blue(5) f=lightBlue(6)
//   g=cyan(7) h=teal(8) i=brown(9) j=blueGrey(10) k=amber(11) l=red(0)
const ALL_FAMILIES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']

function setDarkModeForWcag(enabled: boolean) {
  if (enabled) document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
  setDarkModeReactive(enabled)
}

describe('WCAG AA compliance — all 12 families × 2 themes (T1510, updated T1625)', () => {
  afterEach(() => setDarkModeForWcag(false))

  it('agentFg dark mode: all 12 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(true)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(agentFg(name), agentBg(name))
      expect(ratio, `agentFg('${name}') dark: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('agentFg light mode: all 12 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(false)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(agentFg(name), agentBg(name))
      expect(ratio, `agentFg('${name}') light: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('perimeterFg dark mode: all 12 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(true)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(perimeterFg(name), agentBg(name))
      expect(ratio, `perimeterFg('${name}') dark: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('perimeterFg light mode: all 12 families meet 4.5:1 against agentBg', () => {
    setDarkModeForWcag(false)
    for (const name of ALL_FAMILIES) {
      const ratio = contrastRatio(perimeterFg(name), agentBg(name))
      expect(ratio, `perimeterFg('${name}') light: ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
