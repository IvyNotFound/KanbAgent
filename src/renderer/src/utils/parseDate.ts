/**
 * Parse a SQLite CURRENT_TIMESTAMP string as UTC.
 *
 * SQLite stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" (UTC, no suffix).
 * Chromium/V8 interprets this space-separated format as *local* time, causing
 * a +N hours offset for users outside UTC (T624).
 *
 * Fix: replace the space with 'T' and append 'Z' to force UTC parsing.
 * If the string already contains 'T' (ISO 8601) or 'Z', it is returned as-is.
 */
export function parseUtcDate(sqliteTs: string): Date {
  if (!sqliteTs) return new Date(NaN)
  // Already ISO 8601 with T or has timezone info — pass through unchanged
  if (sqliteTs.includes('T') || sqliteTs.endsWith('Z') || sqliteTs.includes('+')) {
    return new Date(sqliteTs)
  }
  return new Date(sqliteTs.replace(' ', 'T') + 'Z')
}
