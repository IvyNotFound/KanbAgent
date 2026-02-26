/**
 * Agent color utilities for agent-viewer.
 *
 * Generates deterministic HSL colors from agent names using a hash function.
 * Each agent always gets the same hue, ensuring consistent visual identity
 * across the UI (badges, borders, sidebar dots).
 *
 * Theme-aware: returns different lightness/saturation values for dark vs light mode.
 * Uses a Vue ref for reactivity — call setDarkMode() from the settings store
 * so that all computed styles update instantly on theme toggle.
 *
 * @module utils/agentColor
 */

import { ref } from 'vue'

/**
 * Simple hash function for strings.
 * @param name - Agent name to hash.
 * @returns Non-negative integer hash value.
 */
function hash(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffffffff
  return Math.abs(h)
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

/** Update the reactive dark mode flag. Call this from the settings store on theme change. */
export function setDarkMode(dark: boolean): void {
  if (darkMode.value === dark) return
  darkMode.value = dark
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
 * Returns a deterministic hue (0–359) for a given agent name.
 * Results are cached for performance.
 * @param name - Agent name.
 * @returns Hue value in degrees.
 */
export function agentHue(name: string): number {
  let hue = hueCache.get(name)
  if (hue === undefined) {
    hue = hash(name) % 360
    hueCache.set(name, hue)
  }
  return hue
}

/**
 * Primary foreground color for an agent (text, dots).
 * Dark: bright text (68% L) · Light: darker text (38% L) for contrast on white.
 */
export function agentFg(name: string): string {
  let v = agentFgCache.get(name)
  if (v === undefined) {
    const h = agentHue(name)
    v = isDark() ? `hsl(${h}, 70%, 68%)` : `hsl(${h}, 65%, 38%)`
    agentFgCache.set(name, v)
  }
  return v
}

/**
 * Background color for agent badge.
 * Dark: dark tinted bg (18% L) · Light: soft pastel bg (92% L).
 */
export function agentBg(name: string): string {
  let v = agentBgCache.get(name)
  if (v === undefined) {
    const h = agentHue(name)
    v = isDark() ? `hsl(${h}, 40%, 18%)` : `hsl(${h}, 50%, 92%)`
    agentBgCache.set(name, v)
  }
  return v
}

/**
 * Border color for agent badge.
 * Dark: medium border (32% L) · Light: subtle border (78% L).
 */
export function agentBorder(name: string): string {
  let v = agentBorderCache.get(name)
  if (v === undefined) {
    const h = agentHue(name)
    v = isDark() ? `hsl(${h}, 40%, 32%)` : `hsl(${h}, 40%, 78%)`
    agentBorderCache.set(name, v)
  }
  return v
}

/**
 * Foreground color for perimeter badge (softer than agentFg).
 * Dark: bright text (70% L) · Light: darker text (35% L).
 */
export function perimeterFg(name: string): string {
  let v = perimeterFgCache.get(name)
  if (v === undefined) {
    const h = agentHue(name)
    v = isDark() ? `hsl(${h}, 60%, 70%)` : `hsl(${h}, 55%, 35%)`
    perimeterFgCache.set(name, v)
  }
  return v
}

/**
 * Background color for perimeter badge.
 * Dark: very dark bg (15% L) · Light: soft pastel bg (93% L).
 */
export function perimeterBg(name: string): string {
  let v = perimeterBgCache.get(name)
  if (v === undefined) {
    const h = agentHue(name)
    v = isDark() ? `hsl(${h}, 30%, 15%)` : `hsl(${h}, 40%, 93%)`
    perimeterBgCache.set(name, v)
  }
  return v
}

/**
 * Border color for perimeter badge.
 * Dark: medium border (27% L) · Light: subtle border (80% L).
 */
export function perimeterBorder(name: string): string {
  let v = perimeterBorderCache.get(name)
  if (v === undefined) {
    const h = agentHue(name)
    v = isDark() ? `hsl(${h}, 30%, 27%)` : `hsl(${h}, 30%, 80%)`
    perimeterBorderCache.set(name, v)
  }
  return v
}
