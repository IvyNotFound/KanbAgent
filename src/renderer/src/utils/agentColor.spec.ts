import { describe, it, expect } from 'vitest'
import { agentHue, agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

describe('agentColor', () => {
  describe('agentHue', () => {
    it('should return a number between 0 and 359', () => {
      const hue = agentHue('test-agent')
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    })

    it('should return consistent value for same input (determinism)', () => {
      expect(agentHue('test-agent')).toBe(agentHue('test-agent'))
    })

    it('should return same value on repeated calls (no randomness)', () => {
      const name = 'review-master'
      const hue1 = agentHue(name)
      const hue2 = agentHue(name)
      const hue3 = agentHue(name)
      expect(hue1).toBe(hue2)
      expect(hue2).toBe(hue3)
    })

    it('should return different values for different inputs', () => {
      expect(agentHue('agent-a')).not.toBe(agentHue('agent-b'))
    })

    it('should return integer (no decimals from modulo)', () => {
      const hue = agentHue('dev-front-vuejs')
      expect(Number.isInteger(hue)).toBe(true)
    })

    it('should handle empty string without crashing', () => {
      const hue = agentHue('')
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    })

    it('should handle names with dashes and underscores', () => {
      const hue = agentHue('dev-front-vuejs_v2')
      expect(typeof hue).toBe('number')
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    })

    it('should handle unicode characters without crashing', () => {
      const hue = agentHue('agent-🤖')
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    })

    it('should be case-sensitive (uppercase ≠ lowercase)', () => {
      // The hash function is case-sensitive by design
      const hueUpper = agentHue('AGENT')
      const hueLower = agentHue('agent')
      expect(hueUpper).toBeGreaterThanOrEqual(0)
      expect(hueLower).toBeGreaterThanOrEqual(0)
      expect(hueUpper).not.toBe(hueLower)
    })

    it('should handle long names without crashing', () => {
      const longName = 'a'.repeat(200)
      const hue = agentHue(longName)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    })
  })

  describe('agentFg', () => {
    it('should return a valid HSL color string', () => {
      const fg = agentFg('test')
      expect(fg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('should return consistent value for same input', () => {
      expect(agentFg('test')).toBe(agentFg('test'))
    })

    it('should have high lightness (readable on dark background)', () => {
      // agentFg uses 68% lightness — bright enough for dark mode
      const fg = agentFg('test')
      const match = fg.match(/(\d+)%\)$/)
      const lightness = match ? parseInt(match[1]) : 0
      expect(lightness).toBeGreaterThanOrEqual(60)
    })

    it('should use the exact hue from agentHue', () => {
      const name = 'my-agent'
      const hue = agentHue(name)
      expect(agentFg(name)).toBe(`hsl(${hue}, 70%, 68%)`)
    })

    it('should have fixed saturation of 70%', () => {
      const fg = agentFg('any-agent')
      expect(fg).toMatch(/hsl\(\d+, 70%, \d+%\)/)
    })
  })

  describe('agentBg', () => {
    it('should return a valid HSL color string', () => {
      const bg = agentBg('test')
      expect(bg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('should have low lightness (dark background for badge)', () => {
      // agentBg uses 18% lightness — dark enough for a subtle badge background
      const bg = agentBg('test')
      const match = bg.match(/(\d+)%\)$/)
      const lightness = match ? parseInt(match[1]) : 100
      expect(lightness).toBeLessThanOrEqual(25)
    })

    it('should use the exact hue from agentHue', () => {
      const name = 'my-agent'
      const hue = agentHue(name)
      expect(agentBg(name)).toBe(`hsl(${hue}, 40%, 18%)`)
    })

    it('should use lower saturation than agentFg (40% vs 70%)', () => {
      const name = 'test-agent'
      const bg = agentBg(name)
      const fg = agentFg(name)
      const bgSat = parseInt(bg.match(/, (\d+)%,/)![1])
      const fgSat = parseInt(fg.match(/, (\d+)%,/)![1])
      expect(bgSat).toBeLessThan(fgSat)
    })
  })

  describe('agentBorder', () => {
    it('should return a valid HSL color string', () => {
      const border = agentBorder('test')
      expect(border).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('should have higher lightness than agentBg (border is lighter than background)', () => {
      const name = 'dev-front'
      const bg = agentBg(name)
      const border = agentBorder(name)
      const bgLightness = parseInt(bg.match(/(\d+)%\)$/)![1])
      const borderLightness = parseInt(border.match(/(\d+)%\)$/)![1])
      expect(borderLightness).toBeGreaterThan(bgLightness)
    })

    it('should use the exact hue from agentHue', () => {
      const name = 'my-agent'
      const hue = agentHue(name)
      expect(agentBorder(name)).toBe(`hsl(${hue}, 40%, 32%)`)
    })

    it('should share saturation with agentBg (coherent color scheme)', () => {
      const name = 'test-agent'
      const bg = agentBg(name)
      const border = agentBorder(name)
      const bgSat = parseInt(bg.match(/, (\d+)%,/)![1])
      const borderSat = parseInt(border.match(/, (\d+)%,/)![1])
      expect(bgSat).toBe(borderSat)
    })
  })

  describe('color scheme coherence', () => {
    it('all four functions should use the same hue for a given name', () => {
      const name = 'test-agent-123'
      const hue = agentHue(name)
      expect(agentFg(name)).toContain(`hsl(${hue},`)
      expect(agentBg(name)).toContain(`hsl(${hue},`)
      expect(agentBorder(name)).toContain(`hsl(${hue},`)
    })

    it('lightness order: agentBg < agentBorder < agentFg', () => {
      const name = 'review-master'
      const bgL = parseInt(agentBg(name).match(/(\d+)%\)$/)![1])
      const borderL = parseInt(agentBorder(name).match(/(\d+)%\)$/)![1])
      const fgL = parseInt(agentFg(name).match(/(\d+)%\)$/)![1])
      expect(bgL).toBeLessThan(borderL)
      expect(borderL).toBeLessThan(fgL)
    })
  })
})
