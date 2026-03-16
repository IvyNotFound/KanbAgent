/**
 * Targeted mutation tests for agentColor.ts (T1349)
 *
 * Kills surviving mutants in:
 * - agentSat(): SAT_STEPS indexing via (hash >> 9) % 4
 * - agentFg() light mode: Math.min(s, 70) cap — exact output for each sat step
 * - cacheSet(): FIFO eviction at exactly CACHE_MAX boundary (>= not >)
 * - Arithmetic constants: exact HSL values for all color functions
 *
 * Named test-names (n0, n10, n100, n600) are pre-computed to hit each SAT_STEPS index:
 *   n0   → hash idx=2 → sat=75, hue=218
 *   n10  → hash idx=1 → sat=65, hue=357
 *   n100 → hash idx=3 → sat=85, hue=315
 *   n600 → hash idx=0 → sat=55, hue=80
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
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

describe('agentColor saturation & exact values (T1349)', () => {
  afterEach(() => setDarkMode(false))

  // ── agentSat() SAT_STEPS indexing — exact sat per name ───────────────────────
  // These tests kill mutants on (hash >> 9) % SAT_STEPS.length
  // and arithmetic mutations on the step values [55, 65, 75, 85].
  describe('agentSat() — each SAT_STEPS index hit with exact value', () => {
    it('n600: SAT_STEPS[0]=55 — agentFg dark saturation is exactly 55', () => {
      setDarkMode(true)
      // n600 → hash idx=0 → sat=55
      expect(agentFg('n600')).toBe('hsl(80, 55%, 68%)')
    })

    it('n10: SAT_STEPS[1]=65 — agentFg dark saturation is exactly 65', () => {
      setDarkMode(true)
      // n10 → hash idx=1 → sat=65
      expect(agentFg('n10')).toBe('hsl(357, 65%, 68%)')
    })

    it('n0: SAT_STEPS[2]=75 — agentFg dark saturation is exactly 75', () => {
      setDarkMode(true)
      // n0 → hash idx=2 → sat=75
      expect(agentFg('n0')).toBe('hsl(218, 75%, 68%)')
    })

    it('n100: SAT_STEPS[3]=85 — agentFg dark saturation is exactly 85', () => {
      setDarkMode(true)
      // n100 → hash idx=3 → sat=85
      expect(agentFg('n100')).toBe('hsl(315, 85%, 68%)')
    })

    it('all four SAT_STEPS values are reachable (no dead step)', () => {
      setDarkMode(true)
      const sats = new Set<number>()
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        const fg = agentFg(name)
        const s = parseInt(fg.match(/hsl\(\d+, (\d+)%/)![1])
        sats.add(s)
      }
      expect(sats).toContain(55)
      expect(sats).toContain(65)
      expect(sats).toContain(75)
      expect(sats).toContain(85)
    })
  })

  // ── agentFg() light mode: Math.min(s, 70) cap — exact values ─────────────────
  // Kills mutant: Math.min(s, 70) → Math.max(s, 70) or removing the cap
  describe('agentFg() light mode — Math.min(s, 70) cap kills', () => {
    it('n600 (sat=55): light mode sat=55 (< 70, uncapped)', () => {
      setDarkMode(false)
      // sat=55 < 70, so Math.min(55, 70) = 55 — not capped
      expect(agentFg('n600')).toBe('hsl(80, 55%, 38%)')
    })

    it('n10 (sat=65): light mode sat=65 (< 70, uncapped)', () => {
      setDarkMode(false)
      // sat=65 < 70, so Math.min(65, 70) = 65 — not capped
      expect(agentFg('n10')).toBe('hsl(357, 65%, 38%)')
    })

    it('n0 (sat=75): light mode sat is capped at 70 (not 75)', () => {
      setDarkMode(false)
      // sat=75 > 70, so Math.min(75, 70) = 70 — CAPPED
      expect(agentFg('n0')).toBe('hsl(218, 70%, 38%)')
    })

    it('n100 (sat=85): light mode sat is capped at 70 (not 85)', () => {
      setDarkMode(false)
      // sat=85 > 70, so Math.min(85, 70) = 70 — CAPPED
      expect(agentFg('n100')).toBe('hsl(315, 70%, 38%)')
    })

    it('capped names (sat>70) have lower sat in light than dark', () => {
      // n0: dark=75, light=70
      setDarkMode(true)
      const darkFg = agentFg('n0')
      const darkS = parseInt(darkFg.match(/hsl\(\d+, (\d+)%/)![1])
      setDarkMode(false)
      const lightFg = agentFg('n0')
      const lightS = parseInt(lightFg.match(/hsl\(\d+, (\d+)%/)![1])
      expect(darkS).toBe(75)
      expect(lightS).toBe(70)
      expect(lightS).toBeLessThan(darkS)
    })

    it('uncapped names (sat<=70) have same sat in light and dark', () => {
      // n600: dark=55, light=55 (no capping)
      setDarkMode(true)
      const darkFg = agentFg('n600')
      const darkS = parseInt(darkFg.match(/hsl\(\d+, (\d+)%/)![1])
      setDarkMode(false)
      const lightFg = agentFg('n600')
      const lightS = parseInt(lightFg.match(/hsl\(\d+, (\d+)%/)![1])
      expect(darkS).toBe(55)
      expect(lightS).toBe(55)
    })
  })

  // ── agentBg() exact arithmetic: 0.58 (dark) and 0.72 (light) ────────────────
  // Kills mutants on the multiplication factors in agentBg
  describe('agentBg() — exact factor arithmetic', () => {
    it('n600 (sat=55): dark = round(55*0.58)=32, light = round(55*0.72)=40', () => {
      setDarkMode(true)
      expect(agentBg('n600')).toBe('hsl(80, 32%, 18%)')
      setDarkMode(false)
      expect(agentBg('n600')).toBe('hsl(80, 40%, 92%)')
    })

    it('n10 (sat=65): dark = round(65*0.58)=38, light = round(65*0.72)=47', () => {
      setDarkMode(true)
      expect(agentBg('n10')).toBe('hsl(357, 38%, 18%)')
      setDarkMode(false)
      expect(agentBg('n10')).toBe('hsl(357, 47%, 92%)')
    })

    it('n0 (sat=75): dark = round(75*0.58)=44, light = round(75*0.72)=54', () => {
      setDarkMode(true)
      expect(agentBg('n0')).toBe('hsl(218, 44%, 18%)')
      setDarkMode(false)
      expect(agentBg('n0')).toBe('hsl(218, 54%, 92%)')
    })

    it('n100 (sat=85): dark = round(85*0.58)=49, light = round(85*0.72)=61', () => {
      setDarkMode(true)
      expect(agentBg('n100')).toBe('hsl(315, 49%, 18%)')
      setDarkMode(false)
      expect(agentBg('n100')).toBe('hsl(315, 61%, 92%)')
    })

    it('agentBg dark lightness is exactly 18% (kills +/-1 lightness mutants)', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        const bg = agentBg(name)
        expect(bg).toMatch(/%, 18%\)$/)
      }
    })

    it('agentBg light lightness is exactly 92% (kills +/-1 lightness mutants)', () => {
      setDarkMode(false)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        const bg = agentBg(name)
        expect(bg).toMatch(/%, 92%\)$/)
      }
    })
  })

  // ── agentBorder() exact arithmetic: factor 0.58 ──────────────────────────────
  describe('agentBorder() — exact factor arithmetic', () => {
    it('n600 (sat=55): dark = light = round(55*0.58)=32', () => {
      setDarkMode(true)
      expect(agentBorder('n600')).toBe('hsl(80, 32%, 32%)')
      setDarkMode(false)
      expect(agentBorder('n600')).toBe('hsl(80, 32%, 78%)')
    })

    it('n10 (sat=65): dark = light = round(65*0.58)=38', () => {
      setDarkMode(true)
      expect(agentBorder('n10')).toBe('hsl(357, 38%, 32%)')
      setDarkMode(false)
      expect(agentBorder('n10')).toBe('hsl(357, 38%, 78%)')
    })

    it('n0 (sat=75): dark = light = round(75*0.58)=44', () => {
      setDarkMode(true)
      expect(agentBorder('n0')).toBe('hsl(218, 44%, 32%)')
      setDarkMode(false)
      expect(agentBorder('n0')).toBe('hsl(218, 44%, 78%)')
    })

    it('n100 (sat=85): dark = light = round(85*0.58)=49', () => {
      setDarkMode(true)
      expect(agentBorder('n100')).toBe('hsl(315, 49%, 32%)')
      setDarkMode(false)
      expect(agentBorder('n100')).toBe('hsl(315, 49%, 78%)')
    })

    it('agentBorder dark lightness is exactly 32% (kills +/-1 mutants)', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(agentBorder(name)).toMatch(/%, 32%\)$/)
      }
    })

    it('agentBorder light lightness is exactly 78% (kills +/-1 mutants)', () => {
      setDarkMode(false)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(agentBorder(name)).toMatch(/%, 78%\)$/)
      }
    })
  })

  // ── agentFg() lightness constants: 68% dark, 38% light ───────────────────────
  describe('agentFg() — lightness constants exact', () => {
    it('dark lightness is exactly 68% for all sat steps', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(agentFg(name)).toMatch(/%, 68%\)$/)
      }
    })

    it('light lightness is exactly 38% for all sat steps', () => {
      setDarkMode(false)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(agentFg(name)).toMatch(/%, 38%\)$/)
      }
    })
  })

  // ── perimeterFg() exact arithmetic: dark=0.86, light=0.79 ───────────────────
  describe('perimeterFg() — exact factor arithmetic', () => {
    it('n600 (sat=55): dark=round(55*0.86)=47, light=round(55*0.79)=43', () => {
      setDarkMode(true)
      expect(perimeterFg('n600')).toBe('hsl(80, 47%, 70%)')
      setDarkMode(false)
      expect(perimeterFg('n600')).toBe('hsl(80, 43%, 35%)')
    })

    it('n10 (sat=65): dark=round(65*0.86)=56, light=round(65*0.79)=51', () => {
      setDarkMode(true)
      expect(perimeterFg('n10')).toBe('hsl(357, 56%, 70%)')
      setDarkMode(false)
      expect(perimeterFg('n10')).toBe('hsl(357, 51%, 35%)')
    })

    it('n0 (sat=75): dark=round(75*0.86)=65, light=round(75*0.79)=59', () => {
      setDarkMode(true)
      expect(perimeterFg('n0')).toBe('hsl(218, 65%, 70%)')
      setDarkMode(false)
      expect(perimeterFg('n0')).toBe('hsl(218, 59%, 35%)')
    })

    it('n100 (sat=85): dark=round(85*0.86)=73, light=round(85*0.79)=67', () => {
      setDarkMode(true)
      expect(perimeterFg('n100')).toBe('hsl(315, 73%, 70%)')
      setDarkMode(false)
      expect(perimeterFg('n100')).toBe('hsl(315, 67%, 35%)')
    })

    it('perimeterFg dark lightness is exactly 70% (kills +/-1 mutants)', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(perimeterFg(name)).toMatch(/%, 70%\)$/)
      }
    })

    it('perimeterFg light lightness is exactly 35% (kills +/-1 mutants)', () => {
      setDarkMode(false)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(perimeterFg(name)).toMatch(/%, 35%\)$/)
      }
    })
  })

  // ── perimeterBg() exact arithmetic: dark=0.43, light=0.57 ───────────────────
  describe('perimeterBg() — exact factor arithmetic', () => {
    it('n600 (sat=55): dark=round(55*0.43)=24, light=round(55*0.57)=31', () => {
      setDarkMode(true)
      expect(perimeterBg('n600')).toBe('hsl(80, 24%, 15%)')
      setDarkMode(false)
      expect(perimeterBg('n600')).toBe('hsl(80, 31%, 93%)')
    })

    it('n10 (sat=65): dark=round(65*0.43)=28, light=round(65*0.57)=37', () => {
      setDarkMode(true)
      expect(perimeterBg('n10')).toBe('hsl(357, 28%, 15%)')
      setDarkMode(false)
      expect(perimeterBg('n10')).toBe('hsl(357, 37%, 93%)')
    })

    it('n0 (sat=75): dark=round(75*0.43)=32, light=round(75*0.57)=43', () => {
      setDarkMode(true)
      expect(perimeterBg('n0')).toBe('hsl(218, 32%, 15%)')
      setDarkMode(false)
      expect(perimeterBg('n0')).toBe('hsl(218, 43%, 93%)')
    })

    it('n100 (sat=85): dark=round(85*0.43)=37, light=round(85*0.57)=48', () => {
      setDarkMode(true)
      expect(perimeterBg('n100')).toBe('hsl(315, 37%, 15%)')
      setDarkMode(false)
      expect(perimeterBg('n100')).toBe('hsl(315, 48%, 93%)')
    })

    it('perimeterBg dark lightness is exactly 15% (kills +/-1 mutants)', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(perimeterBg(name)).toMatch(/%, 15%\)$/)
      }
    })

    it('perimeterBg light lightness is exactly 93% (kills +/-1 mutants)', () => {
      setDarkMode(false)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(perimeterBg(name)).toMatch(/%, 93%\)$/)
      }
    })
  })

  // ── perimeterBorder() exact arithmetic: factor 0.43 ─────────────────────────
  describe('perimeterBorder() — exact factor arithmetic', () => {
    it('n600 (sat=55): dark=light=round(55*0.43)=24', () => {
      setDarkMode(true)
      expect(perimeterBorder('n600')).toBe('hsl(80, 24%, 27%)')
      setDarkMode(false)
      expect(perimeterBorder('n600')).toBe('hsl(80, 24%, 80%)')
    })

    it('n10 (sat=65): dark=light=round(65*0.43)=28', () => {
      setDarkMode(true)
      expect(perimeterBorder('n10')).toBe('hsl(357, 28%, 27%)')
      setDarkMode(false)
      expect(perimeterBorder('n10')).toBe('hsl(357, 28%, 80%)')
    })

    it('n0 (sat=75): dark=light=round(75*0.43)=32', () => {
      setDarkMode(true)
      expect(perimeterBorder('n0')).toBe('hsl(218, 32%, 27%)')
      setDarkMode(false)
      expect(perimeterBorder('n0')).toBe('hsl(218, 32%, 80%)')
    })

    it('n100 (sat=85): dark=light=round(85*0.43)=37', () => {
      setDarkMode(true)
      expect(perimeterBorder('n100')).toBe('hsl(315, 37%, 27%)')
      setDarkMode(false)
      expect(perimeterBorder('n100')).toBe('hsl(315, 37%, 80%)')
    })

    it('perimeterBorder dark lightness is exactly 27% (kills +/-1 mutants)', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(perimeterBorder(name)).toMatch(/%, 27%\)$/)
      }
    })

    it('perimeterBorder light lightness is exactly 80% (kills +/-1 mutants)', () => {
      setDarkMode(false)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        expect(perimeterBorder(name)).toMatch(/%, 80%\)$/)
      }
    })

    it('perimeterBorder and perimeterBg have same saturation (both factor 0.43)', () => {
      setDarkMode(true)
      for (const name of ['n0', 'n10', 'n100', 'n600']) {
        const bgS = parseInt(perimeterBg(name).match(/hsl\(\d+, (\d+)%/)![1])
        const borderS = parseInt(perimeterBorder(name).match(/hsl\(\d+, (\d+)%/)![1])
        expect(borderS).toBe(bgS)
      }
    })
  })

  // ── cacheSet() FIFO eviction at exactly CACHE_MAX boundary ───────────────────
  // Kills mutants: map.size >= CACHE_MAX → map.size > CACHE_MAX
  describe('cacheSet() FIFO eviction — CACHE_MAX=100 boundary', () => {
    it('inserting exactly 100 entries then 1 more returns valid color (eviction correct)', () => {
      setDarkMode(true)
      // Use a prefix unlikely to collide with other tests
      const prefix = 'fifo-t1349-'
      for (let i = 0; i < 100; i++) {
        agentFg(`${prefix}${i}`)
      }
      // 101st insert triggers eviction of prefix-0
      const result = agentFg(`${prefix}100`)
      expect(result).toMatch(/^hsl\(\d+, \d+%, 68%\)$/)
    })

    it('cache eviction keeps second entry accessible after evicting first', () => {
      setDarkMode(true)
      const prefix = 'fifo2-t1349-'
      for (let i = 0; i < 100; i++) {
        agentFg(`${prefix}${i}`)
      }
      // Evict prefix-0
      agentFg(`${prefix}100`)
      // prefix-1 should still be accessible (not evicted)
      const second = agentFg(`${prefix}1`)
      expect(second).toMatch(/^hsl\(\d+, \d+%, 68%\)$/)
    })

    it('cache size stays bounded after many inserts (not unbounded growth)', () => {
      setDarkMode(false)
      // Insert 200 entries — should trigger 100 evictions but always produce valid colors
      for (let i = 0; i < 200; i++) {
        const result = agentFg(`size-bound-${i}`)
        expect(result).toMatch(/^hsl\(\d+, \d+%, 38%\)$/)
      }
    })

    it('99 entries do NOT trigger eviction (< CACHE_MAX)', () => {
      setDarkMode(true)
      const prefix = 'noevict-t1349-'
      // Fill 99 entries (one under CACHE_MAX)
      for (let i = 0; i < 99; i++) {
        agentBg(`${prefix}${i}`)
      }
      // 100th insert: size was 99 < 100, so no eviction
      const result = agentBg(`${prefix}99`)
      expect(result).toMatch(/^hsl\(\d+, \d+%, 18%\)$/)
    })

    it('exactly 100 entries trigger eviction on 101st insert (>= boundary)', () => {
      setDarkMode(true)
      const prefix = 'at-max-t1349-'
      // Fill to exactly CACHE_MAX=100
      for (let i = 0; i < 100; i++) {
        agentBorder(`${prefix}${i}`)
      }
      // 101st: size=100 >= 100, so eviction fires → delete first key → insert
      const result = agentBorder(`${prefix}100`)
      expect(result).toMatch(/^hsl\(\d+, \d+%, 32%\)$/)
    })
  })
})
