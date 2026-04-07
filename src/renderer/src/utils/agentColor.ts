/**
 * Agent color utilities for KanbAgent.
 *
 * Maps agent names to deterministic colors from a 12-family Material Design 2 palette
 * (imported from `vuetify/util/colors`). Each agent always resolves to the same family
 * (index 0–11) via a string hash, ensuring a consistent visual identity across all
 * UI surfaces: badges, borders, sidebar dots, tab accents.
 *
 * Green families (teal, green, lightGreen, lime) and harsh warm families (orange,
 * deepOrange) are excluded. Orange and deepOrange produce visually aggressive badges
 * and have luminance values (~0.15–0.30) that make WCAG AA text contrast unreliable
 * in dark mode. Teal (blue-green, distinct from pure green) replaces them.
 *
 * Four public color functions cover all use cases:
 *   - `agentFg`     — text / icon color on badge background (WCAG AA contrast guaranteed)
 *   - `agentBg`     — badge background fill
 *   - `agentBorder` — badge border
 *   - `agentAccent` — standalone accent on neutral surface (dots, bars, spinners)
 *
 * All functions are theme-aware (dark / light) and reactive via `colorVersion`.
 * Call `setDarkMode()` from the settings store on theme toggle to invalidate caches
 * and propagate the change to all bound components immediately.
 *
 * @module utils/agentColor
 */

import { ref } from 'vue'
import colors from 'vuetify/util/colors'

/**
 * Material Design 2 palette — 12 color families, deterministically indexed.
 * Excluded families:
 * - Green families (teal excluded as a green lookalike — actually blue-green, so included;
 *   green, lightGreen, lime excluded for low-contrast issues in dark mode)
 * - orange (darken4 #E65100): extremely saturated, visually aggressive badge in dark mode;
 *   luminance ~0.23 makes WCAG AA text contrast unreliable
 * - deepOrange (darken4 #BF360C): same issue, even more violet-red
 * Teal replaces them: teal.darken4 (#004D40) is a calm blue-green, visually distinct.
 */
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
  colors.brown,      // 9
  colors.blueGrey,   // 10
  colors.amber,      // 11
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
const agentAccentCache = new Map<string, string>()
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
  agentAccentCache.clear()
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
 * Returns a deterministic palette index (0–11) for a given agent name.
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
 * Pastel approach: badge bg is always light (lighten3/lighten4), so text uses dark shades.
 * Dark bg (lighten3/200): escalates darken3 → darken4 → darken2 → #000000 for WCAG AA.
 * Light bg (lighten4/100): same escalation — darken3 often passes here while failing on lighten3,
 * which naturally produces different fg values between the two themes.
 */
export function agentFg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentFgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    const bgHex = isDark()
      ? (family.lighten3 ?? family.lighten2)
      : (family.lighten4 ?? family.lighten5)
    const candidates = ['darken3', 'darken4', 'darken2', '#000000']
    v = pickContrastingFg(family, candidates, bgHex)
    cacheSet(agentFgCache, name, v)
  }
  return v
}

/**
 * Background color for agent badge — pastel palette.
 * Dark: MD lighten3 (200 shade) — pastel, visible on dark surfaces.
 * Light: MD lighten4 (100 shade) — softer pastel on light surfaces.
 */
export function agentBg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentBgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark()
      ? (family.lighten3 ?? family.lighten2)
      : (family.lighten4 ?? family.lighten5)
    cacheSet(agentBgCache, name, v)
  }
  return v
}

/**
 * Border color for agent badge — one shade more saturated than the bg.
 * Dark: MD lighten2 (300 shade) — slightly richer than the lighten3 bg.
 * Light: MD lighten3 (200 shade) — slightly richer than the lighten4 bg.
 */
export function agentBorder(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentBorderCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark()
      ? (family.lighten2 ?? family.lighten3)
      : (family.lighten3 ?? family.lighten2)
    cacheSet(agentBorderCache, name, v)
  }
  return v
}

/**
 * Accent color for standalone colored elements (dots, bars, spinners)
 * on neutral sidebar backgrounds — NOT for text on badge backgrounds.
 * Dark: lighten2 (300 shade) — colorful and visible on dark bg.
 * Light: darken1 (600 shade) — colorful and visible on light bg.
 */
export function agentAccent(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = agentAccentCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark()
      ? (family.lighten2 ?? family.lighten1 ?? family.base)
      : (family.darken1 ?? family.base)
    cacheSet(agentAccentCache, name, v)
  }
  return v
}

/**
 * Foreground color for perimeter badge (softer visual hierarchy than agentFg).
 * Pastel approach: badge bg is always light (lighten3/lighten4), so text uses dark shades.
 * Uses same escalation as agentFg — naturally returns different values per theme since
 * darken3 contrast differs against lighten3 vs lighten4 backgrounds.
 */
export function perimeterFg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterFgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    const bgHex = isDark()
      ? (family.lighten3 ?? family.lighten2)
      : (family.lighten4 ?? family.lighten5)
    const candidates = ['darken3', 'darken4', 'darken2', '#000000']
    v = pickContrastingFg(family, candidates, bgHex)
    cacheSet(perimeterFgCache, name, v)
  }
  return v
}

/**
 * Background color for perimeter badge — pastel palette.
 * Dark: MD lighten3 (200 shade) — pastel, visible on dark surfaces.
 * Light: MD lighten4 (100 shade) — softer pastel on light surfaces.
 */
export function perimeterBg(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterBgCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark()
      ? (family.lighten3 ?? family.lighten2)
      : (family.lighten4 ?? family.lighten5)
    cacheSet(perimeterBgCache, name, v)
  }
  return v
}

/**
 * Border color for perimeter badge — one shade more saturated than the bg.
 * Dark: MD lighten2 (300 shade) — slightly richer than the lighten3 bg.
 * Light: MD lighten3 (200 shade) — slightly richer than the lighten4 bg.
 */
export function perimeterBorder(name: string): string {
  void colorVersion.value // track reactive dependency
  let v = perimeterBorderCache.get(name)
  if (v === undefined) {
    const family = agentFamily(name)
    v = isDark()
      ? (family.lighten2 ?? family.lighten3)
      : (family.lighten3 ?? family.lighten2)
    cacheSet(perimeterBorderCache, name, v)
  }
  return v
}
