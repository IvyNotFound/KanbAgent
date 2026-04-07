/**
 * Language color palette — MD3-harmonized tonal palette for code telemetry.
 *
 * Colors are defined per-theme (dark/light) using MD3 tonal values:
 * dark tones ~68–75 for good contrast on dark surfaces,
 * light tones ~30–42 for legibility on light surfaces.
 *
 * Unlisted languages receive a deterministic HSL color derived from a
 * djb2-style hash of the language name:
 *   dark:  hsl(hue, 60%, 72%) — good contrast on dark surfaces
 *   light: hsl(hue, 70%, 32%) — readable on light surfaces
 *
 * Usage:
 *   import { getLangColor } from '@renderer/utils/lang-colors'
 *   import { useSettingsStore } from '@renderer/stores/settings'
 *   const settings = useSettingsStore()
 *   // in template: :style="{ backgroundColor: getLangColor(lang.name, settings.theme === 'dark') }"
 */

const LANG_COLORS: Record<string, { light: string; dark: string }> = {
  // Core web / scripting
  TypeScript:  { dark: '#7cacf8', light: '#1a56db' },
  Vue:         { dark: '#6edba7', light: '#1a8a5a' },
  JavaScript:  { dark: '#f0c060', light: '#7a4f00' },
  CSS:         { dark: '#c084fc', light: '#6d28d9' },
  HTML:        { dark: '#f97066', light: '#b91c1c' },
  // Systems / backend
  Python:      { dark: '#60a5fa', light: '#1d4ed8' },
  Go:          { dark: '#67e8f9', light: '#0e7490' },
  Rust:        { dark: '#fdba74', light: '#9a3412' },
  Java:        { dark: '#fcd34d', light: '#78350f' },
  // Data / config / docs
  JSON:        { dark: '#a3a3a3', light: '#404040' },
  Markdown:    { dark: '#86efac', light: '#15803d' },
  Shell:       { dark: '#bef264', light: '#3f6212' },
  SQL:         { dark: '#fda4af', light: '#be123c' },
  // Extended — common languages not in the original list
  'C':         { dark: '#93c5fd', light: '#1e40af' },
  'C++':       { dark: '#a5b4fc', light: '#3730a3' },
  'C#':        { dark: '#818cf8', light: '#4338ca' },
  Ruby:        { dark: '#fca5a5', light: '#991b1b' },
  PHP:         { dark: '#c4b5fd', light: '#5b21b6' },
  Swift:       { dark: '#fb923c', light: '#9a3412' },
  Kotlin:      { dark: '#a78bfa', light: '#5b21b6' },
  YAML:        { dark: '#d1d5db', light: '#374151' },
  TOML:        { dark: '#fbbf24', light: '#92400e' },
  Dockerfile:  { dark: '#38bdf8', light: '#075985' },
  Svelte:      { dark: '#fb7185', light: '#9f1239' },
  SCSS:        { dark: '#f9a8d4', light: '#9d174d' },
  // Additional systems / compiled
  Scala:          { dark: '#f87171', light: '#991b1b' },
  Haskell:        { dark: '#a78bfa', light: '#4c1d95' },
  Dart:           { dark: '#67e8f9', light: '#0c4a6e' },
  Zig:            { dark: '#f6ad55', light: '#7c3c00' },
  Nim:            { dark: '#fde68a', light: '#78350f' },
  Lua:            { dark: '#93c5fd', light: '#1e3a8a' },
  Perl:           { dark: '#c084fc', light: '#581c87' },
  'Objective-C':  { dark: '#94a3b8', light: '#334155' },
  Elixir:         { dark: '#d8b4fe', light: '#6b21a8' },
  Julia:          { dark: '#a5f3fc', light: '#155e75' },
  // Config / infra / templating
  HCL:            { dark: '#c084fc', light: '#7e22ce' },
  Makefile:       { dark: '#86efac', light: '#166534' },
  XML:            { dark: '#fca5a5', light: '#9b1c1c' },
  GraphQL:        { dark: '#f472b6', light: '#9d174d' },
  SASS:           { dark: '#f9a8d4', light: '#831843' },
  Less:           { dark: '#818cf8', light: '#312e81' },
  Astro:          { dark: '#fb923c', light: '#7c2d12' },
  // Shells / scripting
  PowerShell:     { dark: '#38bdf8', light: '#0369a1' },
  Bash:           { dark: '#bef264', light: '#365314' },
  Fish:           { dark: '#6ee7b7', light: '#065f46' },
  // Data / notebook
  R:              { dark: '#60a5fa', light: '#1e40af' },
  Jupyter:        { dark: '#f97316', light: '#9a3412' },
  // Functional / exotic
  Clojure:        { dark: '#6ee7b7', light: '#134e4a' },
  Erlang:         { dark: '#fda4af', light: '#9f1239' },
  OCaml:          { dark: '#fb923c', light: '#7c2d12' },
  'F#':           { dark: '#93c5fd', light: '#1e40af' },
}

/**
 * Deterministic hash of a language name (djb2-style).
 * Returns a stable non-negative 32-bit integer.
 */
function hashLangName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  }
  return h
}

/** Return the MD3-harmonized color for a language name, adapted to the current theme. */
export function getLangColor(name: string, isDark: boolean): string {
  const entry = LANG_COLORS[name]
  if (entry) return isDark ? entry.dark : entry.light
  const hue = hashLangName(name) % 360
  return isDark
    ? `hsl(${hue}, 60%, 72%)`
    : `hsl(${hue}, 70%, 32%)`
}
