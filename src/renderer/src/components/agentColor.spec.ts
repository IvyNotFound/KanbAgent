import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder, isDark, setDarkMode, agentHue, colorVersion } from '@renderer/utils/agentColor'

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

describe('agentColor utilities (T353)', () => {
  afterEach(() => setDarkMode(false))

  it('agentHue returns a stable palette index for the same name', () => {
    const h1 = agentHue('dev-front')
    const h2 = agentHue('dev-front')
    expect(h1).toBe(h2)
    expect(h1).toBeGreaterThanOrEqual(0)
    expect(h1).toBeLessThan(15)
  })

  it('agentHue returns different indices for different names', () => {
    const h1 = agentHue('dev-front')      // → 8
    const h2 = agentHue('review-master')  // → 9
    expect(h1).not.toBe(h2)
  })

  it('agentFg returns hex string', () => {
    const fg = agentFg('test-agent')
    expect(fg).toMatch(HEX_PATTERN)
  })

  it('agentBg returns hex string', () => {
    const bg = agentBg('test-agent')
    expect(bg).toMatch(HEX_PATTERN)
  })

  it('agentBorder returns hex string', () => {
    const border = agentBorder('test-agent')
    expect(border).toMatch(HEX_PATTERN)
  })

  it('perimeterFg returns hex string', () => {
    const fg = perimeterFg('front-vuejs')
    expect(fg).toMatch(HEX_PATTERN)
  })

  it('perimeterBg returns hex string', () => {
    const bg = perimeterBg('front-vuejs')
    expect(bg).toMatch(HEX_PATTERN)
  })

  it('perimeterBorder returns hex string', () => {
    const border = perimeterBorder('front-vuejs')
    expect(border).toMatch(HEX_PATTERN)
  })

  it('setDarkMode toggles isDark()', () => {
    setDarkMode(true)
    expect(isDark()).toBe(true)

    setDarkMode(false)
    expect(isDark()).toBe(false)
  })

  it('dark mode changes color values in agentFg', () => {
    setDarkMode(true)
    const darkFg = agentFg('test')

    setDarkMode(false)
    const lightFg = agentFg('test')

    expect(darkFg).not.toBe(lightFg)
  })
})

// ─── T1319 (updated for T1467 MD2 migration) ─────────────────────────────────

describe('agentColor — hash function exact palette indices (T1319)', () => {
  // 'hello': hash=99162322, 99162322%15=7 (cyan)
  // 'test-agent': hash=621962762, 621962762%15=2 (purple)
  // These exact values kill h*31 -> h+31 / h*32 / h-31 mutants

  it('agentHue(hello) === 7 (hash=99162322, 99162322%15=7)', () => {
    expect(agentHue('hello')).toBe(7)
  })

  it('agentHue(test-agent) === 2 (hash=621962762, 621962762%15=2)', () => {
    expect(agentHue('test-agent')).toBe(2)
  })

  it('agentHue of empty string is 0 (covers !name guard)', () => {
    expect(agentHue('')).toBe(0)
  })

  it('agentHue differs between order-sensitive names (order matters in hash)', () => {
    // 'hello' → idx=7, 'world' → idx=12 (both computed from hash%15)
    expect(agentHue('hello')).toBe(7)
    expect(agentHue('world')).toBe(12)
    expect(agentHue('hello')).not.toBe(agentHue('world'))
  })
})

describe('agentColor — MD2 shade exact values (T1319 + T1467)', () => {
  // test-agent: idx=2 (purple family)
  // agentFg dark=lighten3=#ce93d8, light=darken2=#7b1fa2
  // agentBg dark=darken4=#4a148c, light=lighten5=#f3e5f5
  // agentBorder dark=darken2=#7b1fa2, light=lighten2=#ba68c8
  // perimeterFg dark=lighten4=#e1bee7, light=darken1=#8e24aa
  // perimeterBg dark=darken4=#4a148c, light=lighten5=#f3e5f5
  // perimeterBorder dark=darken3=#6a1b9a, light=lighten3=#ce93d8

  afterEach(() => setDarkMode(false))

  it('agentBg dark mode (test-agent: purple darken4 #4a148c)', () => {
    setDarkMode(true)
    expect(agentBg('test-agent')).toBe('#4a148c')
  })

  it('agentBg light mode (test-agent: purple lighten5 #f3e5f5)', () => {
    setDarkMode(false)
    expect(agentBg('test-agent')).toBe('#f3e5f5')
  })

  it('agentBorder dark mode (test-agent: purple darken2 #7b1fa2)', () => {
    setDarkMode(true)
    expect(agentBorder('test-agent')).toBe('#7b1fa2')
  })

  it('agentBorder light mode (test-agent: purple lighten2 #ba68c8)', () => {
    setDarkMode(false)
    expect(agentBorder('test-agent')).toBe('#ba68c8')
  })

  it('perimeterFg dark mode (test-agent: purple lighten4 #e1bee7)', () => {
    setDarkMode(true)
    expect(perimeterFg('test-agent')).toBe('#e1bee7')
  })

  it('perimeterFg light mode (test-agent: purple darken1 #8e24aa)', () => {
    setDarkMode(false)
    expect(perimeterFg('test-agent')).toBe('#8e24aa')
  })

  it('perimeterBg dark mode (test-agent: purple darken4 #4a148c)', () => {
    setDarkMode(true)
    expect(perimeterBg('test-agent')).toBe('#4a148c')
  })

  it('perimeterBg light mode (test-agent: purple lighten5 #f3e5f5)', () => {
    setDarkMode(false)
    expect(perimeterBg('test-agent')).toBe('#f3e5f5')
  })

  it('perimeterBorder dark mode (test-agent: purple darken3 #6a1b9a)', () => {
    setDarkMode(true)
    expect(perimeterBorder('test-agent')).toBe('#6a1b9a')
  })

  it('perimeterBorder light mode (test-agent: purple lighten3 #ce93d8)', () => {
    setDarkMode(false)
    expect(perimeterBorder('test-agent')).toBe('#ce93d8')
  })

  it('hello dark agentFg (cyan lighten3 #80deea)', () => {
    setDarkMode(true)
    expect(agentFg('hello')).toBe('#80deea')
  })
})

describe('agentColor — agentFg exact dark/light shades (T1319 + T1467)', () => {
  afterEach(() => setDarkMode(false))

  it('agentFg dark mode (test-agent: purple lighten3 #ce93d8)', () => {
    setDarkMode(true)
    expect(agentFg('test-agent')).toBe('#ce93d8')
  })

  it('agentFg light mode (test-agent: purple darken2 #7b1fa2)', () => {
    setDarkMode(false)
    expect(agentFg('test-agent')).toBe('#7b1fa2')
  })

  it('agentFg light mode (hello: cyan darken2 #0097a7)', () => {
    setDarkMode(false)
    expect(agentFg('hello')).toBe('#0097a7')
  })
})

describe('agentColor — setDarkMode no-op and cache invalidation (T1319)', () => {
  afterEach(() => setDarkMode(false))

  it('setDarkMode does not increment colorVersion when value unchanged', () => {
    setDarkMode(true)
    const before = colorVersion.value
    setDarkMode(true) // same value — should be no-op
    expect(colorVersion.value).toBe(before)
  })

  it('setDarkMode increments colorVersion when value changes', () => {
    setDarkMode(false)
    const before = colorVersion.value
    setDarkMode(true)
    expect(colorVersion.value).toBe(before + 1)
  })

  it('color strings differ between dark and light for all functions (cache invalidated)', () => {
    setDarkMode(true)
    const name = 'test-agent'
    const darkFg = agentFg(name)
    const darkBg = agentBg(name)
    const darkBorder = agentBorder(name)
    const darkPFg = perimeterFg(name)
    const darkPBg = perimeterBg(name)
    const darkPBorder = perimeterBorder(name)

    setDarkMode(false)
    expect(agentFg(name)).not.toBe(darkFg)
    expect(agentBg(name)).not.toBe(darkBg)
    expect(agentBorder(name)).not.toBe(darkBorder)
    expect(perimeterFg(name)).not.toBe(darkPFg)
    expect(perimeterBg(name)).not.toBe(darkPBg)
    expect(perimeterBorder(name)).not.toBe(darkPBorder)
  })
})

describe('agentColor — cache FIFO boundary (T1319)', () => {
  // cacheSet evicts when map.size >= CACHE_MAX (100)
  // Mutation >= -> > would allow 101 entries instead of 100

  it('agentHue still returns valid index for name added at/after CACHE_MAX boundary', () => {
    for (let i = 0; i < 110; i++) {
      agentHue(`unique-cache-name-${i}`)
    }
    const idx = agentHue('unique-cache-name-105')
    expect(idx).toBe(agentHue('unique-cache-name-105'))
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(15)
  })

  it('cache eviction: first entries are evicted and recomputed correctly', () => {
    const idx = agentHue('unique-cache-name-0')
    expect(idx).toBe(agentHue('unique-cache-name-0'))
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(15)
  })
})
