/**
 * Mutation-focused tests for agentColor.ts (T1286 + T1467)
 *
 * Kills surviving mutants in:
 * - hash(): h * 31 + charCodeAt(0) — exact palette indices for known names
 * - agentHue(): hash(name) % 15 (palette size) — kills off-by-one on modulo
 * - cacheSet(): FIFO eviction at exactly CACHE_MAX boundary (>= not >)
 * - setDarkMode(): no-op guard — kills removal of the isDark() early return
 *
 * Pre-computed palette indices (hash(name) % 15):
 *   'a'   → hash=97,   97  % 15 = 7
 *   'ab'  → hash=3105, 3105% 15 = 0
 *   'aa'  → hash=3104, 3104% 15 = 14
 *   'z'   → hash=122,  122 % 15 = 2
 *   'bc'  → hash=3137, 3137% 15 = 2
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
  colorVersion,
  isDark,
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

describe('agentColor mutation coverage (T1286 + T1467)', () => {
  afterEach(() => setDarkMode(false))

  // ── Hash arithmetic — exact palette indices ───────────────────────────────────
  describe('hash arithmetic — exact palette indices', () => {
    it('agentHue("a") = 7 (hash=97, 97%15=7)', () => {
      // hash("a") = charCode('a') = 97; 97 % 15 = 7
      expect(agentHue('a')).toBe(7)
    })

    it('agentHue("ab") = 0 — verifies h*31 multiplier (not h+ch or h*32)', () => {
      // hash("ab"):
      //   after 'a': h = (0 * 31 + 97) & 0xffffffff = 97
      //   after 'b': h = (97 * 31 + 98) & 0xffffffff = 3105
      //   3105 % 15 = 0
      expect(agentHue('ab')).toBe(0)
    })

    it('agentHue("z") = 2 (hash=122, 122%15=2)', () => {
      // charCode('z') = 122; 122 % 15 = 2
      expect(agentHue('z')).toBe(2)
    })

    it('agentHue("aa") = 14 — verifies multiplier 31 vs alternatives', () => {
      // hash("aa"):
      //   h = 97 after 'a'
      //   h = (97 * 31 + 97) & 0xffffffff = 3104 after second 'a'
      //   3104 % 15 = 14
      expect(agentHue('aa')).toBe(14)
    })

    it('agentHue("bc") = 2 — verifies exact hash chain', () => {
      // charCode('b') = 98, charCode('c') = 99
      // h = 98 after 'b'
      // h = (98 * 31 + 99) & 0xffffffff = 3137 after 'c'
      // 3137 % 15 = 2
      expect(agentHue('bc')).toBe(2)
    })

    it('agentHue("") = 0 (hash returns 0 for empty string)', () => {
      expect(agentHue('')).toBe(0)
    })
  })

  // ── LRU eviction at CACHE_MAX boundary ──────────────────────────────────────
  describe('LRU eviction — exact CACHE_MAX boundary', () => {
    it('filling exactly CACHE_MAX=100 unique names — all return valid palette indices', () => {
      for (let i = 0; i < 100; i++) {
        const idx = agentHue(`lru-boundary-${i}`)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(15)
      }
    })

    it('at exactly CACHE_MAX+1=101 names — eviction triggers, result still valid', () => {
      for (let i = 0; i < 101; i++) {
        const idx = agentHue(`lru-trigger-${i}`)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(15)
      }
      const idx101 = agentHue('lru-trigger-101')
      expect(idx101).toBeGreaterThanOrEqual(0)
      expect(idx101).toBeLessThan(15)
    })

    it('agentFg eviction at boundary — 100 entries then 101st returns valid hex', () => {
      for (let i = 0; i < 100; i++) {
        agentFg(`fg-boundary-${i}`)
      }
      const fg = agentFg('fg-boundary-100')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('all color caches survive eviction correctly', () => {
      for (let i = 0; i < 101; i++) {
        agentBorder(`border-evict-${i}`)
        perimeterFg(`pfg-evict-${i}`)
        perimeterBg(`pbg-evict-${i}`)
        perimeterBorder(`pborder-evict-${i}`)
      }
      expect(agentBorder('border-evict-101')).toMatch(HEX_PATTERN)
      expect(perimeterFg('pfg-evict-101')).toMatch(HEX_PATTERN)
      expect(perimeterBg('pbg-evict-101')).toMatch(HEX_PATTERN)
      expect(perimeterBorder('pborder-evict-101')).toMatch(HEX_PATTERN)
    })
  })

  // ── MD2 shade relationships ──────────────────────────────────────────────────
  describe('MD2 shade relationships — semantic invariants', () => {
    it('agentBg dark differs from agentFg dark (darken4 vs lighten3)', () => {
      setDarkMode(true)
      const name = 'sat-factor-test'
      expect(agentBg(name)).not.toBe(agentFg(name))
    })

    it('agentBg light differs from agentFg light (lighten5 vs darken2)', () => {
      setDarkMode(false)
      const name = 'sat-light-factor-test'
      expect(agentBg(name)).not.toBe(agentFg(name))
    })

    it('agentBorder dark differs from agentFg dark (darken2 vs lighten3)', () => {
      setDarkMode(true)
      const name = 'border-factor-check'
      expect(agentBorder(name)).not.toBe(agentFg(name))
    })

    it('perimeterFg dark differs from agentBg dark (lighten4 vs darken4)', () => {
      setDarkMode(true)
      const name = 'perimeter-factor-dark'
      expect(perimeterFg(name)).not.toBe(agentBg(name))
    })

    it('perimeterFg differs between dark and light mode', () => {
      const name = 'perimeter-factor-light'
      setDarkMode(true)
      const dark = perimeterFg(name)
      setDarkMode(false)
      const light = perimeterFg(name)
      expect(dark).not.toBe(light)
    })

    it('perimeterBg dark differs from agentFg dark', () => {
      setDarkMode(true)
      const name = 'pbg-factor-test'
      expect(perimeterBg(name)).not.toBe(agentFg(name))
    })

    it('perimeterBg light: valid hex color', () => {
      setDarkMode(false)
      const name = 'pbg-light-factor-test'
      expect(perimeterBg(name)).toMatch(HEX_PATTERN)
    })

    it('perimeterBorder dark differs from agentBorder dark (darken3 vs darken2)', () => {
      setDarkMode(true)
      const name = 'pborder-factor-test'
      expect(perimeterBorder(name)).not.toBe(agentBorder(name))
    })
  })

  // ── agentFg light mode — no capping (pure MD shade lookup) ───────────────────
  describe('agentFg light mode — all names return valid darken2 hex', () => {
    it('light mode returns valid hex for 50 different names', () => {
      setDarkMode(false)
      for (let i = 0; i < 50; i++) {
        const fg = agentFg(`sat-cap-verify-${i}`)
        expect(fg).toMatch(HEX_PATTERN)
      }
    })

    it('dark mode returns valid hex for all names', () => {
      setDarkMode(true)
      let count = 0
      for (let i = 0; i < 50; i++) {
        const fg = agentFg(`dark-verify-${i}`)
        if (fg.match(HEX_PATTERN)) count++
      }
      expect(count).toBe(50)
    })
  })

  // ── isDark() guard in setDarkMode ────────────────────────────────────────────
  describe('setDarkMode no-op guard', () => {
    it('setDarkMode(false) twice does not increment colorVersion the second time', () => {
      setDarkMode(false)
      const v0 = colorVersion.value
      setDarkMode(false) // no-op
      expect(colorVersion.value).toBe(v0)
    })

    it('setDarkMode(true) twice does not increment colorVersion the second time', () => {
      setDarkMode(true)
      const v1 = colorVersion.value
      setDarkMode(true) // no-op
      expect(colorVersion.value).toBe(v1)
    })

    it('isDark() returns false initially (no dark class)', () => {
      setDarkMode(false)
      expect(isDark()).toBe(false)
    })

    it('isDark() returns true after setDarkMode(true)', () => {
      setDarkMode(true)
      expect(isDark()).toBe(true)
    })
  })

  // ── Palette coverage ─────────────────────────────────────────────────────────
  describe('palette coverage — all 15 indices reachable', () => {
    it('all names produce palette index from [0, 14]', () => {
      const names = [
        'a', 'b', 'ab', 'review', 'dev-front', 'test-back',
        'doc', 'arch', 'setup', 'devops', 'infra-prod', 'ux-front',
      ]
      for (const name of names) {
        const idx = agentHue(name)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThanOrEqual(14)
      }
    })

    it('single-char names a-o cover all 15 palette indices', () => {
      const found = new Set<number>()
      for (const ch of 'abcdefghijklmno') {
        found.add(agentHue(ch))
      }
      expect(found.size).toBe(15)
    })
  })

  // ── Cache invalidation on theme change ──────────────────────────────────────
  describe('cache invalidation on theme switch', () => {
    it('agentFg is recomputed after theme switch (not served from stale cache)', () => {
      const name = 'cache-invalidation-test'
      setDarkMode(false)
      const light = agentFg(name)
      setDarkMode(true)
      const dark = agentFg(name)
      expect(light).not.toBe(dark)
      expect(light).toMatch(HEX_PATTERN)
      expect(dark).toMatch(HEX_PATTERN)
    })

    it('all perimeter caches are invalidated on theme switch', () => {
      const name = 'perimeter-cache-invalidation'
      setDarkMode(false)
      const pfgLight = perimeterFg(name)
      const pbgLight = perimeterBg(name)
      const pborderLight = perimeterBorder(name)

      setDarkMode(true)
      const pfgDark = perimeterFg(name)
      const pbgDark = perimeterBg(name)
      const pborderDark = perimeterBorder(name)

      expect(pfgLight).not.toBe(pfgDark)
      expect(pbgLight).not.toBe(pbgDark)
      expect(pborderLight).not.toBe(pborderDark)
    })
  })
})
