/**
 * Extract session/task context block from a launch prompt.
 * Returns { context, base } — context is null if no prefix detected.
 *
 * Extracted from StreamView.vue for reuse in useStreamEvents pre-rendering (T1864).
 */
export function parsePromptContext(text: string): { context: string | null; base: string } {
  const dashSep = '\n---\n'
  const dashIdx = text.indexOf(dashSep)
  if (dashIdx !== -1 && text.startsWith('=== IDENTIFIANTS ===')) {
    return { context: text.slice(0, dashIdx), base: text.slice(dashIdx + dashSep.length) }
  }
  const arrowIdx = text.indexOf(' -> ')
  if (arrowIdx !== -1) {
    const context = text.slice(0, arrowIdx)
    if (context.includes('Session préc.:') || context.includes('Tâches:')) {
      return { context, base: text.slice(arrowIdx + 4) }
    }
  }
  return { context: null, base: text }
}
