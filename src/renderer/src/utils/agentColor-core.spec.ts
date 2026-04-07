import { describe, it, expect, afterEach } from 'vitest'
import { agentHue, agentFg, agentBg, agentBorder, agentAccent, perimeterFg, perimeterBg, perimeterBorder, setDarkMode as setDarkModeReactive, colorVersion } from '@renderer/utils/agentColor'

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

  describe('agentHue', () => {
    it('should return a palette index between 0 and 11', () => {
      const idx = agentHue('test-agent')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(12)
    })

    it('should return consistent value for same input (determinism)', () => {
      expect(agentHue('test-agent')).toBe(agentHue('test-agent'))
    })

    it('should return same value on repeated calls (no randomness)', () => {
      const name = 'review-master'
      const idx1 = agentHue(name)
      const idx2 = agentHue(name)
      const idx3 = agentHue(name)
      expect(idx1).toBe(idx2)
      expect(idx2).toBe(idx3)
    })

    it('should return different values for different inputs', () => {
      expect(agentHue('agent-a')).not.toBe(agentHue('agent-b'))
    })

    it('should return integer (no decimals from modulo)', () => {
      const idx = agentHue('dev-front-vuejs')
      expect(Number.isInteger(idx)).toBe(true)
    })

    it('should handle empty string without crashing', () => {
      const idx = agentHue('')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(12)
    })

    it('should handle names with dashes and underscores', () => {
      const idx = agentHue('dev-front-vuejs_v2')
      expect(typeof idx).toBe('number')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(12)
    })

    it('should handle unicode characters without crashing', () => {
      const idx = agentHue('agent-🤖')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(12)
    })

    it('should be case-sensitive (uppercase ≠ lowercase)', () => {
      const idxUpper = agentHue('AGENT')
      const idxLower = agentHue('agent')
      expect(idxUpper).toBeGreaterThanOrEqual(0)
      expect(idxLower).toBeGreaterThanOrEqual(0)
      expect(idxUpper).not.toBe(idxLower)
    })

    it('should handle long names without crashing', () => {
      const longName = 'a'.repeat(200)
      const idx = agentHue(longName)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(12)
    })
  })

  describe('agentFg', () => {
    it('should return a valid hex color string', () => {
      const fg = agentFg('test')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('should return consistent value for same input', () => {
      expect(agentFg('test')).toBe(agentFg('test'))
    })

    it('should return light-mode color when dark class absent', () => {
      setDarkMode(false)
      const fg = agentFg('my-agent')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('should return dark-mode color when dark class present', () => {
      setDarkMode(true)
      const fg = agentFg('my-agent')
      expect(fg).toMatch(HEX_PATTERN)
    })

    it('dark and light values differ for same name', () => {
      setDarkMode(false)
      const lightFg = agentFg('my-agent')
      setDarkMode(true)
      const darkFg = agentFg('my-agent')
      expect(darkFg).not.toBe(lightFg)
    })
  })

  describe('agentBg', () => {
    it('should return a valid hex color string', () => {
      const bg = agentBg('test')
      expect(bg).toMatch(HEX_PATTERN)
    })

    it('agentBg dark and light values differ', () => {
      setDarkMode(false)
      const light = agentBg('test')
      setDarkMode(true)
      const dark = agentBg('test')
      expect(dark).not.toBe(light)
    })

    it('agentBg differs from agentFg for same name in dark mode', () => {
      setDarkMode(true)
      expect(agentBg('my-agent')).not.toBe(agentFg('my-agent'))
    })

    it('agentBg differs from agentFg for same name in light mode', () => {
      setDarkMode(false)
      expect(agentBg('my-agent')).not.toBe(agentFg('my-agent'))
    })
  })

  describe('agentBorder', () => {
    it('should return a valid hex color string', () => {
      const border = agentBorder('test')
      expect(border).toMatch(HEX_PATTERN)
    })

    it('agentBorder dark and light values differ', () => {
      setDarkMode(false)
      const light = agentBorder('test')
      setDarkMode(true)
      const dark = agentBorder('test')
      expect(dark).not.toBe(light)
    })
  })

  describe('setDarkMode reactivity (colorVersion)', () => {
    it('colorVersion increments on theme switch', () => {
      setDarkMode(false)
      const v0 = colorVersion.value
      setDarkMode(true)
      expect(colorVersion.value).toBe(v0 + 1)
      setDarkMode(false)
      expect(colorVersion.value).toBe(v0 + 2)
    })

    it('colorVersion does not increment when theme unchanged', () => {
      setDarkMode(false)
      const v0 = colorVersion.value
      setDarkMode(false)
      expect(colorVersion.value).toBe(v0)
    })

    it('agentFg returns different value after switching dark→light', () => {
      const name = 'test-agent-reactive'
      setDarkMode(true)
      const darkFg = agentFg(name)
      expect(darkFg).toMatch(HEX_PATTERN)
      setDarkMode(false)
      const lightFg = agentFg(name)
      expect(lightFg).toMatch(HEX_PATTERN)
      expect(lightFg).not.toBe(darkFg)
    })

    it('perimeterFg returns different value after switching dark→light', () => {
      // 'test-agent' → purple (idx=2): darken3 fails against lighten3 → dark=darken4, light=darken3
      const name = 'test-agent'
      setDarkMode(true)
      const darkFg = perimeterFg(name)
      expect(darkFg).toMatch(HEX_PATTERN)
      setDarkMode(false)
      const lightFg = perimeterFg(name)
      expect(lightFg).toMatch(HEX_PATTERN)
      expect(lightFg).not.toBe(darkFg)
    })
  })

  describe('color scheme coherence', () => {
    it('all agent functions return different colors for a given name in dark mode', () => {
      setDarkMode(true)
      const name = 'test-agent-123'
      const fg = agentFg(name)
      const bg = agentBg(name)
      const border = agentBorder(name)
      expect(fg).not.toBe(bg)
      expect(bg).not.toBe(border)
      expect(fg).not.toBe(border)
    })

    it('all agent functions return different colors for a given name in light mode', () => {
      setDarkMode(false)
      const name = 'test-agent-123'
      const fg = agentFg(name)
      const bg = agentBg(name)
      const border = agentBorder(name)
      expect(fg).not.toBe(bg)
      expect(bg).not.toBe(border)
      expect(fg).not.toBe(border)
    })

    it('same name → same color for all functions (determinism)', () => {
      const name = 'review-master'
      expect(agentFg(name)).toBe(agentFg(name))
      expect(agentBg(name)).toBe(agentBg(name))
      expect(agentBorder(name)).toBe(agentBorder(name))
    })
  })

  describe('hash function edge cases', () => {
    it('empty string returns palette index 0 (hash returns 0)', () => {
      // hash('') = 0, so idx = 0 % 15 = 0
      expect(agentHue('')).toBe(0)
    })

    it('different names produce different palette indices — multiplier h*31 matters', () => {
      // Single ASCII letters a-f produce indices 6,7,8,9,10,11 — all distinct
      const names = ['a', 'b', 'c', 'd', 'e', 'f']
      const indices = names.map(n => agentHue(n))
      const unique = new Set(indices)
      expect(unique.size).toBe(names.length)
    })

    it('single character produces non-zero palette index', () => {
      const idx = agentHue('a')
      expect(idx).toBeGreaterThan(0)
      expect(idx).toBeLessThan(12)
    })
  })

  describe('agentAccent (T1517)', () => {
    it('returns a valid hex color string in dark mode', () => {
      setDarkMode(true)
      expect(agentAccent('test-agent')).toMatch(HEX_PATTERN)
    })

    it('returns a valid hex color string in light mode', () => {
      setDarkMode(false)
      expect(agentAccent('test-agent')).toMatch(HEX_PATTERN)
    })

    it('dark and light values differ for same name', () => {
      setDarkMode(false)
      const light = agentAccent('test-agent')
      setDarkMode(true)
      const dark = agentAccent('test-agent')
      expect(dark).not.toBe(light)
    })

    it('is deterministic for same name and mode', () => {
      setDarkMode(true)
      expect(agentAccent('test-agent')).toBe(agentAccent('test-agent'))
    })

    it('cache is cleared when dark mode changes', () => {
      setDarkMode(true)
      const v0 = colorVersion.value
      agentAccent('cache-accent')
      setDarkMode(false)
      expect(colorVersion.value).toBe(v0 + 1)
      // After mode change, value should differ
      setDarkMode(true)
      const dark = agentAccent('cache-accent')
      setDarkMode(false)
      const light = agentAccent('cache-accent')
      expect(dark).not.toBe(light)
    })
  })
})
