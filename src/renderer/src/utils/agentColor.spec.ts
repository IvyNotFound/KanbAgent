import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { agentHue, agentFg, agentBg, agentBorder, perimeterFg, setDarkMode as setDarkModeReactive, colorVersion } from '@renderer/utils/agentColor'

/** Toggle dark mode on document.documentElement and reactive ref for testing */
function setDarkMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  setDarkModeReactive(enabled)
}

describe('agentColor', () => {
  afterEach(() => setDarkMode(false))

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

    it('should use the exact hue from agentHue', () => {
      const name = 'my-agent'
      const hue = agentHue(name)
      expect(agentFg(name)).toContain(`hsl(${hue},`)
    })

    it('should return light-mode values when dark class absent', () => {
      setDarkMode(false)
      const name = 'my-agent'
      const hue = agentHue(name)
      const fg = agentFg(name)
      // Lightness 38% in light mode; saturation is variable per name (T464)
      expect(fg).toMatch(/^hsl\(\d+, \d+%, 38%\)$/)
      expect(fg).toContain(`hsl(${hue},`)
    })

    it('should return dark-mode values when dark class present', () => {
      setDarkMode(true)
      const name = 'my-agent'
      const hue = agentHue(name)
      const fg = agentFg(name)
      // Lightness 68% in dark mode; saturation is variable per name (T464)
      expect(fg).toMatch(/^hsl\(\d+, \d+%, 68%\)$/)
      expect(fg).toContain(`hsl(${hue},`)
    })
  })

  describe('agentBg', () => {
    it('should return a valid HSL color string', () => {
      const bg = agentBg('test')
      expect(bg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('should return light-mode values (high lightness) when dark class absent', () => {
      setDarkMode(false)
      const bg = agentBg('test')
      const match = bg.match(/(\d+)%\)$/)
      const lightness = match ? parseInt(match[1]) : 0
      expect(lightness).toBeGreaterThanOrEqual(85)
    })

    it('should return dark-mode values (low lightness) when dark class present', () => {
      setDarkMode(true)
      const bg = agentBg('test')
      const match = bg.match(/(\d+)%\)$/)
      const lightness = match ? parseInt(match[1]) : 100
      expect(lightness).toBeLessThanOrEqual(25)
    })

    it('should use the exact hue from agentHue', () => {
      const name = 'my-agent'
      const hue = agentHue(name)
      expect(agentBg(name)).toContain(`hsl(${hue},`)
    })
  })

  describe('agentBorder', () => {
    it('should return a valid HSL color string', () => {
      const border = agentBorder('test')
      expect(border).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('should use the exact hue from agentHue', () => {
      const name = 'my-agent'
      const hue = agentHue(name)
      expect(agentBorder(name)).toContain(`hsl(${hue},`)
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

    it('agentFg returns light values after switching dark→light', () => {
      const name = 'test-agent-reactive'
      const hue = agentHue(name)
      setDarkMode(true)
      const darkFg = agentFg(name)
      // Dark: lightness 68%; saturation variable per name (T464)
      expect(darkFg).toMatch(/^hsl\(\d+, \d+%, 68%\)$/)
      expect(darkFg).toContain(`hsl(${hue},`)
      setDarkMode(false)
      const lightFg = agentFg(name)
      // Light: lightness 38%; saturation variable per name (T464)
      expect(lightFg).toMatch(/^hsl\(\d+, \d+%, 38%\)$/)
      expect(lightFg).toContain(`hsl(${hue},`)
      expect(lightFg).not.toBe(darkFg)
    })

    it('perimeterFg returns light values after switching dark→light', () => {
      const name = 'front-vuejs'
      const hue = agentHue(name)
      setDarkMode(true)
      const darkFg = perimeterFg(name)
      // Dark: lightness 70%; saturation variable per name (T464)
      expect(darkFg).toMatch(/^hsl\(\d+, \d+%, 70%\)$/)
      expect(darkFg).toContain(`hsl(${hue},`)
      setDarkMode(false)
      const lightFg = perimeterFg(name)
      // Light: lightness 35%; saturation variable per name (T464)
      expect(lightFg).toMatch(/^hsl\(\d+, \d+%, 35%\)$/)
      expect(lightFg).toContain(`hsl(${hue},`)
      expect(lightFg).not.toBe(darkFg)
    })
  })

  describe('color scheme coherence', () => {
    it('all three functions should use the same hue for a given name', () => {
      const name = 'test-agent-123'
      const hue = agentHue(name)
      expect(agentFg(name)).toContain(`hsl(${hue},`)
      expect(agentBg(name)).toContain(`hsl(${hue},`)
      expect(agentBorder(name)).toContain(`hsl(${hue},`)
    })

    it('dark mode: lightness order agentBg < agentBorder < agentFg', () => {
      setDarkMode(true)
      const name = 'review-master'
      const bgL = parseInt(agentBg(name).match(/(\d+)%\)$/)![1])
      const borderL = parseInt(agentBorder(name).match(/(\d+)%\)$/)![1])
      const fgL = parseInt(agentFg(name).match(/(\d+)%\)$/)![1])
      expect(bgL).toBeLessThan(borderL)
      expect(borderL).toBeLessThan(fgL)
    })

    it('light mode: lightness order agentFg < agentBorder < agentBg', () => {
      setDarkMode(false)
      const name = 'review-master'
      const fgL = parseInt(agentFg(name).match(/(\d+)%\)$/)![1])
      const borderL = parseInt(agentBorder(name).match(/(\d+)%\)$/)![1])
      const bgL = parseInt(agentBg(name).match(/(\d+)%\)$/)![1])
      expect(fgL).toBeLessThan(borderL)
      expect(borderL).toBeLessThan(bgL)
    })
  })
})
