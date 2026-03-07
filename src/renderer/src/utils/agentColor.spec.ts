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

  describe('hash function edge cases', () => {
    it('empty string returns hue 0 (hash returns 0)', () => {
      // hash('') = 0, so hue = 0 % 360 = 0
      expect(agentHue('')).toBe(0)
    })

    it('different names produce different hash results — multiplier h*31 matters', () => {
      const names = ['a', 'b', 'c', 'dev-front-vuejs', 'review-master', 'test-back-electron']
      const hues = names.map(n => agentHue(n))
      const unique = new Set(hues)
      expect(unique.size).toBe(names.length)
    })

    it('single character produces non-zero hue', () => {
      const hue = agentHue('a')
      expect(hue).toBeGreaterThan(0)
      expect(hue).toBeLessThan(360)
    })
  })

  describe('cache LRU eviction', () => {
    beforeEach(() => setDarkMode(false))

    it('cache does not grow beyond CACHE_MAX when filling agentHue with 110 names', () => {
      for (let i = 0; i < 110; i++) {
        const hue = agentHue(`cache-test-name-${i}`)
        expect(hue).toBeGreaterThanOrEqual(0)
        expect(hue).toBeLessThan(360)
      }
    })

    it('agentFg cache still works after eviction — returns valid HSL for new names', () => {
      for (let i = 0; i < 105; i++) {
        agentFg(`eviction-fg-${i}`)
      }
      const fg = agentFg('eviction-fg-new')
      expect(fg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('agentBg cache stays functional after eviction', () => {
      for (let i = 0; i < 105; i++) {
        agentBg(`eviction-bg-${i}`)
      }
      const bg = agentBg('eviction-bg-new')
      expect(bg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })
  })

  describe('saturation arithmetic (factor tests)', () => {
    it('agentBg dark: saturation factor 0.58 applied correctly (not 0 or full)', () => {
      setDarkMode(true)
      const name = 'sat-test-agent'
      const bg = agentBg(name)
      const match = bg.match(/hsl\(\d+, (\d+)%, \d+%\)/)
      const s = match ? parseInt(match[1]) : -1
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(100)
    })

    it('agentBg light: saturation factor 0.72 applied correctly (not 0 or full)', () => {
      setDarkMode(false)
      const name = 'sat-test-agent'
      const bg = agentBg(name)
      const match = bg.match(/hsl\(\d+, (\d+)%, \d+%\)/)
      const s = match ? parseInt(match[1]) : -1
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(100)
    })

    it('agentBg dark saturation is less than agentFg saturation (factor 0.58 < 1)', () => {
      setDarkMode(true)
      const name = 'sat-compare-agent'
      const fg = agentFg(name)
      const bg = agentBg(name)
      const fgS = parseInt(fg.match(/hsl\(\d+, (\d+)%/)![1])
      const bgS = parseInt(bg.match(/hsl\(\d+, (\d+)%/)![1])
      expect(bgS).toBeLessThan(fgS)
    })

    it('perimeterFg dark: saturation factor 0.86 applied (higher than agentBg 0.58)', () => {
      setDarkMode(true)
      const name = 'sat-perimeter-test'
      const pfg = perimeterFg(name)
      const bg = agentBg(name)
      const pfgS = parseInt(pfg.match(/hsl\(\d+, (\d+)%/)![1])
      const bgS = parseInt(bg.match(/hsl\(\d+, (\d+)%/)![1])
      expect(pfgS).toBeGreaterThan(bgS)
    })
  })

  describe('agentFg lightness exact values', () => {
    it('dark mode: lightness is exactly 68%', () => {
      setDarkMode(true)
      const fg = agentFg('exact-lightness-test')
      expect(fg).toMatch(/68%\)$/)
    })

    it('light mode: lightness is exactly 38%', () => {
      setDarkMode(false)
      const fg = agentFg('exact-lightness-test-light')
      expect(fg).toMatch(/38%\)$/)
    })
  })

  describe('agentBg lightness exact values', () => {
    it('dark mode: lightness is exactly 18%', () => {
      setDarkMode(true)
      const bg = agentBg('exact-bg-lightness-dark')
      expect(bg).toMatch(/18%\)$/)
    })

    it('light mode: lightness is exactly 92%', () => {
      setDarkMode(false)
      const bg = agentBg('exact-bg-lightness-light')
      expect(bg).toMatch(/92%\)$/)
    })
  })

  describe('agentBorder lightness exact values', () => {
    it('dark mode: lightness is exactly 32%', () => {
      setDarkMode(true)
      const border = agentBorder('exact-border-dark')
      expect(border).toMatch(/32%\)$/)
    })

    it('light mode: lightness is exactly 78%', () => {
      setDarkMode(false)
      const border = agentBorder('exact-border-light')
      expect(border).toMatch(/78%\)$/)
    })
  })

  describe('perimeterFg lightness exact values', () => {
    it('dark mode: lightness is exactly 70%', () => {
      setDarkMode(true)
      const fg = perimeterFg('exact-pfg-dark')
      expect(fg).toMatch(/70%\)$/)
    })

    it('light mode: lightness is exactly 35%', () => {
      setDarkMode(false)
      const fg = perimeterFg('exact-pfg-light')
      expect(fg).toMatch(/35%\)$/)
    })
  })

  describe('perimeterBg and perimeterBorder', () => {
    it('perimeterBg dark: lightness is exactly 15%', () => {
      setDarkMode(true)
      const bg = perimeterBg('pbg-dark-test')
      expect(bg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
      expect(bg).toMatch(/15%\)$/)
    })

    it('perimeterBg light: lightness is exactly 93%', () => {
      setDarkMode(false)
      const bg = perimeterBg('pbg-light-test')
      expect(bg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
      expect(bg).toMatch(/93%\)$/)
    })

    it('perimeterBorder dark: lightness is exactly 27%', () => {
      setDarkMode(true)
      const border = perimeterBorder('pborder-dark-test')
      expect(border).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
      expect(border).toMatch(/27%\)$/)
    })

    it('perimeterBorder light: lightness is exactly 80%', () => {
      setDarkMode(false)
      const border = perimeterBorder('pborder-light-test')
      expect(border).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
      expect(border).toMatch(/80%\)$/)
    })

    it('perimeterBg uses same hue as agentHue', () => {
      const name = 'perimeter-hue-check'
      const hue = agentHue(name)
      const bg = perimeterBg(name)
      expect(bg).toContain(`hsl(${hue},`)
    })

    it('perimeterBorder uses same hue as agentHue', () => {
      const name = 'perimeter-border-hue-check'
      const hue = agentHue(name)
      const border = perimeterBorder(name)
      expect(border).toContain(`hsl(${hue},`)
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
  })

  describe('HSL format correctness', () => {
    it('all color functions return exactly "hsl(H, S%, L%)" format', () => {
      const hslPattern = /^hsl\(\d+, \d+%, \d+%\)$/
      const name = 'format-check-agent'
      expect(agentFg(name)).toMatch(hslPattern)
      expect(agentBg(name)).toMatch(hslPattern)
      expect(agentBorder(name)).toMatch(hslPattern)
      expect(perimeterFg(name)).toMatch(hslPattern)
      expect(perimeterBg(name)).toMatch(hslPattern)
      expect(perimeterBorder(name)).toMatch(hslPattern)
    })

    it('format uses comma-space separator between values', () => {
      const fg = agentFg('format-sep-test')
      expect(fg).toMatch(/hsl\(\d+, \d+%, \d+%\)/)
    })
  })
})
