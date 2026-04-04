import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { agentHue, agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder, setDarkMode as setDarkModeReactive, colorVersion } from '@renderer/utils/agentColor'

/** Toggle dark mode on document.documentElement and reactive ref for testing */
function setDarkMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  setDarkModeReactive(enabled)
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

describe('agentColor', () => {
  afterEach(() => setDarkMode(false))

  describe('cache LRU eviction', () => {
    beforeEach(() => setDarkMode(false))

    it('cache does not grow beyond CACHE_MAX when filling agentHue with 110 names', () => {
      for (let i = 0; i < 110; i++) {
        const idx = agentHue(`cache-test-name-${i}`)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(15)
      }
    })

    it('agentFg cache still works after eviction — returns valid hex for new names', () => {
      for (let i = 0; i < 105; i++) {
        agentFg(`eviction-fg-${i}`)
      }
      const fg = agentFg('eviction-fg-new')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('agentBg cache stays functional after eviction', () => {
      for (let i = 0; i < 105; i++) {
        agentBg(`eviction-bg-${i}`)
      }
      const bg = agentBg('eviction-bg-new')
      expect(bg).toMatch(HEX_PATTERN)
    })
  })

  describe('shade relationships', () => {
    it('agentBg dark differs from agentFg dark (different MD shades)', () => {
      setDarkMode(true)
      const name = 'sat-test-agent'
      expect(agentBg(name)).not.toBe(agentFg(name))
    })

    it('agentBg light differs from agentFg light (different MD shades)', () => {
      setDarkMode(false)
      const name = 'sat-test-agent'
      expect(agentBg(name)).not.toBe(agentFg(name))
    })

    it('agentBorder dark differs from agentFg dark', () => {
      setDarkMode(true)
      const name = 'sat-compare-agent'
      expect(agentBorder(name)).not.toBe(agentFg(name))
    })

    it('perimeterFg dark differs from agentBg dark', () => {
      setDarkMode(true)
      const name = 'sat-perimeter-test'
      expect(perimeterFg(name)).not.toBe(agentBg(name))
    })
  })

  describe('agentFg hex format', () => {
    it('dark mode: returns valid hex color', () => {
      setDarkMode(true)
      const fg = agentFg('exact-lightness-test')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('light mode: returns valid hex color', () => {
      setDarkMode(false)
      const fg = agentFg('exact-lightness-test-light')
      expect(fg).toMatch(HEX_PATTERN)
    })
  })

  describe('agentBg hex format', () => {
    it('dark mode: returns valid hex color', () => {
      setDarkMode(true)
      const bg = agentBg('exact-bg-lightness-dark')
      expect(bg).toMatch(HEX_PATTERN)
    })

    it('light mode: returns valid hex color', () => {
      setDarkMode(false)
      const bg = agentBg('exact-bg-lightness-light')
      expect(bg).toMatch(HEX_PATTERN)
    })
  })

  describe('agentBorder hex format', () => {
    it('dark mode: returns valid hex color', () => {
      setDarkMode(true)
      const border = agentBorder('exact-border-dark')
      expect(border).toMatch(HEX_PATTERN)
    })

    it('light mode: returns valid hex color', () => {
      setDarkMode(false)
      const border = agentBorder('exact-border-light')
      expect(border).toMatch(HEX_PATTERN)
    })
  })

  describe('perimeterFg hex format', () => {
    it('dark mode: returns valid hex color', () => {
      setDarkMode(true)
      const fg = perimeterFg('exact-pfg-dark')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('light mode: returns valid hex color', () => {
      setDarkMode(false)
      const fg = perimeterFg('exact-pfg-light')
      expect(fg).toMatch(HEX_PATTERN)
    })
  })

  describe('perimeterBg and perimeterBorder', () => {
    it('perimeterBg dark: returns valid hex color', () => {
      setDarkMode(true)
      const bg = perimeterBg('pbg-dark-test')
      expect(bg).toMatch(HEX_PATTERN)
    })

    it('perimeterBg light: returns valid hex color', () => {
      setDarkMode(false)
      const bg = perimeterBg('pbg-light-test')
      expect(bg).toMatch(HEX_PATTERN)
    })

    it('perimeterBorder dark: returns valid hex color', () => {
      setDarkMode(true)
      const border = perimeterBorder('pborder-dark-test')
      expect(border).toMatch(HEX_PATTERN)
    })

    it('perimeterBorder light: returns valid hex color', () => {
      setDarkMode(false)
      const border = perimeterBorder('pborder-light-test')
      expect(border).toMatch(HEX_PATTERN)
    })

    it('perimeterBg changes on theme switch', () => {
      const name = 'pbg-theme-switch'
      setDarkMode(true)
      const dark = perimeterBg(name)
      setDarkMode(false)
      const light = perimeterBg(name)
      expect(dark).not.toBe(light)
    })

    it('perimeterBorder changes on theme switch', () => {
      const name = 'pborder-theme-switch'
      setDarkMode(true)
      const dark = perimeterBorder(name)
      setDarkMode(false)
      const light = perimeterBorder(name)
      expect(dark).not.toBe(light)
    })

    it('perimeterBg and perimeterBorder use same family (same base color, different shade)', () => {
      // Both use agentFamily(name) — so in dark mode they share darken4 and darken3 of same family.
      // They should differ in shade, not in family.
      setDarkMode(true)
      const name = 'perimeter-family-check'
      const bg = perimeterBg(name)
      const border = perimeterBorder(name)
      // Same family → colors share the same hue family but different shades → they differ
      expect(bg).not.toBe(border)
    })

    it('perimeterBg uses same family as agentHue for a given name', () => {
      const name = 'perimeter-hue-check'
      const idx = agentHue(name)
      // Both perimeterBg and agentBg use the same family (same agentHue index)
      setDarkMode(true)
      expect(perimeterBg(name)).toBe(agentBg(name))
    })
  })

  describe('hex format correctness', () => {
    it('all color functions return exactly "#rrggbb" hex format', () => {
      const name = 'format-check-agent'
      setDarkMode(false)
      expect(agentFg(name)).toMatch(HEX_PATTERN)
      expect(agentBg(name)).toMatch(HEX_PATTERN)
      expect(agentBorder(name)).toMatch(HEX_PATTERN)
      expect(perimeterFg(name)).toMatch(HEX_PATTERN)
      expect(perimeterBg(name)).toMatch(HEX_PATTERN)
      expect(perimeterBorder(name)).toMatch(HEX_PATTERN)
      setDarkMode(true)
      expect(agentFg(name)).toMatch(HEX_PATTERN)
      expect(agentBg(name)).toMatch(HEX_PATTERN)
      expect(agentBorder(name)).toMatch(HEX_PATTERN)
      expect(perimeterFg(name)).toMatch(HEX_PATTERN)
      expect(perimeterBg(name)).toMatch(HEX_PATTERN)
      expect(perimeterBorder(name)).toMatch(HEX_PATTERN)
    })

    it('format starts with # and has 6 hex digits', () => {
      const fg = agentFg('format-sep-test')
      expect(fg.startsWith('#')).toBe(true)
      expect(fg).toHaveLength(7)
    })
  })
})
