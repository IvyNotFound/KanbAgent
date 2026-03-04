/**
 * Utilities for detecting stale in-progress tasks.
 *
 * A task is considered stale when it has been `in_progress` for longer than
 * the configured threshold without completing.
 */

/**
 * Returns true if the task's `started_at` timestamp is older than
 * `thresholdMinutes` from now. Returns false when `startedAt` is null/undefined.
 *
 * @param startedAt      - ISO 8601 UTC string from the `tasks.started_at` column, or null.
 * @param thresholdMinutes - Minutes before a task is considered stale (default 120).
 */
export function isStale(startedAt: string | null | undefined, thresholdMinutes = 120): boolean {
  if (!startedAt) return false
  const start = new Date(startedAt).getTime()
  if (isNaN(start)) return false
  return Date.now() - start > thresholdMinutes * 60 * 1000
}

/**
 * Returns a human-readable duration string for how long a task has been running.
 * e.g. "3h 15min" or "45min"
 */
export function staleDuration(startedAt: string | null | undefined): string {
  if (!startedAt) return ''
  const ms = Date.now() - new Date(startedAt).getTime()
  if (isNaN(ms) || ms <= 0) return ''
  const totalMin = Math.floor(ms / 60000)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}
