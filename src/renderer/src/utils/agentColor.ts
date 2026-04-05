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
 * Parses a CSS hex color string to its RGB components.
 * Supports 3-digit (#RGB) and 6-digit (#RRGGBB) formats.
 * @param hex - Hex color string (with or without leading #).
 * @returns Object with r, g, b in [0, 255], or null if unparseable.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace(/^#/, '')
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    return { r, g, b }
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    return { r, g, b }
  }
  return null
}

/**
 * Computes the WCAG relative luminance of a hex color.
 * @param hex - Hex color string.
 * @returns Luminance in [0, 1], or 0 if the color is unparseable.
 */
function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const linearize = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b)
}

/**
 * Returns the MD3 "on-color" for a given background hex color.
 * Uses WCAG relative luminance to pick between dark (#1C1B1F) and white (#FFFFFF)
 * so that text always meets the 4.5:1 contrast ratio requirement.
 * Threshold 0.18 ≈ the perceptual midpoint between pure black and pure white.
 * @param bgHex - Background hex color.
 * @returns '#1C1B1F' for light backgrounds, '#FFFFFF' for dark backgrounds.
 */
export function getOnColor(bgHex: string): string {
  return getRelativeLuminance(bgHex) > 0.18 ? '#1C1B1F' : '#FFFFFF'
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
 * Picks the first candidate that achieves at least `minContrast` against `bgHex`.
 * Returns the last candidate as ultimate fallback if none passes.
 *
 * Candidates are either ColorFamily shade keys ('lighten3', 'darken2', etc.)
 * or direct hex strings ('#FFFFFF'). Uses getRelativeLuminance() from this module.
 *
 * @param family - MD2 color family to resolve shade keys from.
 * @param candidates - Ordered shade keys or hex strings, tried in sequence.
 * @param bgHex - Background hex color to check contrast against.
 * @param minContrast - Minimum WCAG contrast ratio (default 4.5 for AA).
 * @returns First candidate hex meeting minContrast, or last candidate as fallback.
 */
function pickContrastingFg(
  family: ColorFamily,
  candidates: string[],
  bgHex: string,
  minContrast = 4.5
): string {
  const bgL = getRelativeLuminance(bgHex)
  const record = family as Record<string, string>
  for (const candidate of candidates) {
    const hex = candidate.startsWith('#') ? candidate : record[candidate]
    if (!hex) continue
    const fgL = getRelativeLuminance(hex)
    const lighter = Math.max(bgL, fgL)
    const darker = Math.min(bgL, fgL)
    if ((lighter + 0.05) / (darker + 0.05) >= minContrast) return hex
  }
  // Last candidate as ultimate fallback
  const last = candidates[candidates.length - 1]
  return last.startsWith('#') ? last : (record[last] ?? last)
}

/**
 * Primary foreground color for an agent (text, dots).
 * Uses shade escalation to guarantee WCAG AA (4.5:1) contrast against the badge background.
 * Dark bg (darken4): escalates lighten3 → lighten4 → lighten5 → #FFFFFF → #1C1B1F.
 * Light bg (lighten5): escalates darken2 → darken3 → darken4 → #000000.
 */
export function agentFg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentFgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    const bgHex = isDark() ? family.darken4 : family.lighten5
    const candidates = isDark()
      ? ['lighten3', 'lighten4', 'lighten5', '#FFFFFF', '#1C1B1F']
      : ['darken2', 'darken3', 'darken4', '#000000']
    v = pickContrastingFg(family, candidates, bgHex)
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
 * Foreground color for perimeter badge (softer visual hierarchy than agentFg).
 * Uses shade escalation to guarantee WCAG AA (4.5:1) contrast against the badge background.
 * Dark bg (darken4): escalates lighten4 → lighten3 → lighten5 → #FFFFFF → #1C1B1F.
 * Light bg (lighten5): escalates darken1 → darken2 → darken3 → darken4 → #000000.
 */
export function perimeterFg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterFgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    const bgHex = isDark() ? family.darken4 : family.lighten5
    const candidates = isDark()
      ? ['lighten4', 'lighten3', 'lighten5', '#FFFFFF', '#1C1B1F']
      : ['darken1', 'darken2', 'darken3', 'darken4', '#000000']
    v = pickContrastingFg(family, candidates, bgHex)
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
