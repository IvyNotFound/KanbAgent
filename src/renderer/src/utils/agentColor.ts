/**
 * Agent color utilities for KanbAgent.
 *
 * Generates deterministic Material Design 2 hex colors from agent names using a hash function.
 * Each agent always gets the same color family (0–14 palette index), ensuring consistent
 * visual identity across the UI (badges, borders, sidebar dots).
 *
 * Theme-aware: returns different MD2 shades for dark vs light mode.
 * Uses a Vue ref for reactivity — call setDarkMode() from the settings store
 * so that all computed styles update instantly on theme toggle.
 *
 * @module utils/agentColor
 */

import { ref } from 'vue'
import colors from 'vuetify/util/colors'

/** Material Design 2 palette — 15 color families, deterministically indexed. */
const MD_PALETTE = [
  colors.red,        // 0
  colors.pink,       // 1
  colors.purple,     // 2
  colors.deepPurple, // 3
  colors.indigo,     // 4
  colors.blue,       // 5
  colors.lightBlue,  // 6
  colors.cyan,       // 7
  colors.teal,       // 8
  colors.green,      // 9
  colors.lightGreen, // 10
  colors.lime,       // 11
  colors.amber,      // 12
  colors.orange,     // 13
  colors.deepOrange, // 14
]

type ColorFamily = (typeof MD_PALETTE)[number]

/**
 * Simple hash function for strings.
 * @param name - Agent name to hash.
 * @returns Non-negative integer hash value.
 */
function hash(name: string): number {
  if (!name) return 0
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffffffff
  return Math.abs(h)
}

/** Maximum entries per cache Map before FIFO eviction kicks in. */
const CACHE_MAX = 100

/** Insert into a bounded Map, evicting the oldest entry when at capacity. */
function cacheSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value as string)
  map.set(key, value)
}

const hueCache = new Map<string, number>()

// Color string caches — keyed by agent/perimeter name, invalidated on theme change.
const agentFgCache = new Map<string, string>()
const agentBgCache = new Map<string, string>()
const agentBorderCache = new Map<string, string>()
const perimeterFgCache = new Map<string, string>()
const perimeterBgCache = new Map<string, string>()
const perimeterBorderCache = new Map<string, string>()

/** Reactive dark mode flag — kept in sync by setDarkMode(). */
const darkMode = ref(document.documentElement.classList.contains('dark'))

/** Incremented on every theme change to force reactive invalidation of color bindings. */
export const colorVersion = ref(0)

/** Update the reactive dark mode flag. Call this from the settings store on theme change. */
export function setDarkMode(dark: boolean): void {
  if (darkMode.value === dark) return
  darkMode.value = dark
  colorVersion.value++
  // Invalidate color caches on theme change.
  agentFgCache.clear()
  agentBgCache.clear()
  agentBorderCache.clear()
  perimeterFgCache.clear()
  perimeterBgCache.clear()
  perimeterBorderCache.clear()
}

/** Returns true when the app is in dark mode. Reactive — reads from the darkMode ref. */
export function isDark(): boolean {
  return darkMode.value
}

/**
 * Returns a deterministic palette index (0–14) for a given agent name.
 * Results are cached for performance.
 * @param name - Agent name.
 * @returns Palette index (0 to MD_PALETTE.length - 1).
 */
export function agentHue(name: string): number {
  let idx = hueCache.get(name)
  if (idx === undefined) {
    idx = hash(name) % MD_PALETTE.length
    cacheSet(hueCache, name, idx)
  }
  return idx
}

/** Returns the MD2 color family for a given agent name. */
function agentFamily(name: string): ColorFamily {
  return MD_PALETTE[agentHue(name)]
}

/**
 * Primary foreground color for an agent (text, dots).
 * Dark: MD lighten3 (200 shade) · Light: MD darken2 (700 shade).
 */
export function agentFg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentFgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark() ? family.lighten3 : family.darken2
    cacheSet(agentFgCache, name, v)
  }
  return v
}

/**
 * Background color for agent badge.
 * Dark: MD darken4 (900 shade) · Light: MD lighten5 (50 shade).
 */
export function agentBg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentBgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark() ? family.darken4 : family.lighten5
    cacheSet(agentBgCache, name, v)
  }
  return v
}

/**
 * Border color for agent badge.
 * Dark: MD darken2 (700 shade) · Light: MD lighten2 (300 shade).
 */
export function agentBorder(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentBorderCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark() ? family.darken2 : family.lighten2
    cacheSet(agentBorderCache, name, v)
  }
  return v
}

/**
 * Foreground color for perimeter badge (softer variant of agentFg).
 * Dark: MD lighten4 (100 shade) · Light: MD darken1 (600 shade).
 */
export function perimeterFg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterFgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark() ? family.lighten4 : family.darken1
    cacheSet(perimeterFgCache, name, v)
  }
  return v
}

/**
 * Background color for perimeter badge.
 * Dark: MD darken4 (900 shade) · Light: MD lighten5 (50 shade).
 */
export function perimeterBg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterBgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark() ? family.darken4 : family.lighten5
    cacheSet(perimeterBgCache, name, v)
  }
  return v
}

/**
 * Border color for perimeter badge.
 * Dark: MD darken3 (800 shade) · Light: MD lighten3 (200 shade).
 */
export function perimeterBorder(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterBorderCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark() ? family.darken3 : family.lighten3
    cacheSet(perimeterBorderCache, name, v)
  }
  return v
}
