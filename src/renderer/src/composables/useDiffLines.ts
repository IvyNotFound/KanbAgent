/**
 * useDiffLines — LCS-based line + character diff utilities for ToolInputView.
 * Extracted to keep ToolInputView under 400 lines (T-refactor).
 */

export interface DiffLine {
  idx: number
  type: 'remove' | 'add' | 'context' | 'hunk'
  prefix: string
  text: string
  parts?: Array<{ text: string; highlight: boolean }>
}

const MAX_DIFF_LINES = 80

// LCS-based line diff — returns an array of {type, text} entries
function computeLineDiff(
  oldLines: string[],
  newLines: string[],
): Array<{ type: 'context' | 'remove' | 'add'; text: string }> {
  const m = oldLines.length
  const n = newLines.length
  if (m * n > 100_000) {
    return [
      ...oldLines.map((t) => ({ type: 'remove' as const, text: t })),
      ...newLines.map((t) => ({ type: 'add' as const, text: t })),
    ]
  }
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const result: Array<{ type: 'context' | 'remove' | 'add'; text: string }> = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', text: newLines[j - 1] })
      j--
    } else {
      result.unshift({ type: 'remove', text: oldLines[i - 1] })
      i--
    }
  }
  return result
}

// Retain only CONTEXT_SIZE lines around each change; insert hunk separators
function withContext(
  diff: Array<{ type: 'context' | 'remove' | 'add'; text: string }>,
  ctx = 3,
): DiffLine[] {
  const visible = new Set<number>()
  diff.forEach((l, i) => {
    if (l.type !== 'context') {
      for (let k = Math.max(0, i - ctx); k <= Math.min(diff.length - 1, i + ctx); k++) {
        visible.add(k)
      }
    }
  })
  if (visible.size === 0) return []
  const indices = Array.from(visible).sort((a, b) => a - b)
  const result: DiffLine[] = []
  let prev = -1
  let idx = 0
  for (const i of indices) {
    if (prev >= 0 && i > prev + 1) {
      result.push({ idx: idx++, type: 'hunk', prefix: '', text: '...' })
    }
    const l = diff[i]
    result.push({
      idx: idx++,
      type: l.type,
      prefix: l.type === 'remove' ? '-' : l.type === 'add' ? '+' : ' ',
      text: l.text,
    })
    prev = i
  }
  return result
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Int32Array(n + 1)
  for (let i = 1; i <= m; i++) {
    let prev = 0
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

// Character-level LCS diff — returns segments with/without highlight
function computeCharDiff(a: string, b: string): { parts: Array<{ text: string; highlight: boolean }> } | null {
  if (a.length * b.length > 10_000) return null
  const ratio = (2 * lcsLength(a, b)) / (a.length + b.length)
  if (ratio < 0.3) return null

  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const bParts: Array<{ text: string; highlight: boolean }> = []
  let i = m, j = n
  const ops: boolean[] = new Array(n).fill(true)
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops[j - 1] = false; i--; j--
    } else if (dp[i][j - 1] >= dp[i - 1][j]) {
      j--
    } else {
      i--
    }
  }
  let k = 0
  while (k < n) {
    const hl = ops[k]
    let seg = b[k]
    k++
    while (k < n && ops[k] === hl) { seg += b[k]; k++ }
    bParts.push({ text: seg, highlight: hl })
  }
  return { parts: bParts }
}

// Apply char-level diff to consecutive remove+add pairs
function applyCharHighlights(lines: DiffLine[]): void {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].type === 'remove' && lines[i + 1].type === 'add') {
      const res = computeCharDiff(lines[i].text, lines[i + 1].text)
      if (res) lines[i + 1].parts = res.parts
    }
  }
}

export function computeDiffLines(input: Record<string, unknown>): DiffLine[] {
  const oldStr = String(input.old_string ?? '')
  const newStr = String(input.new_string ?? '')

  if (!input.old_string && !input.new_string) return []
  if (!input.old_string) {
    const lines = newStr.split('\n')
    const limit = Math.min(lines.length, MAX_DIFF_LINES)
    const result: DiffLine[] = lines.slice(0, limit).map((text, i) => ({ idx: i, type: 'add' as const, prefix: '+', text }))
    if (lines.length > limit) result.push({ idx: limit, type: 'hunk', prefix: '', text: `(${lines.length - limit} more lines)` })
    return result
  }
  if (!input.new_string) {
    const lines = oldStr.split('\n')
    const limit = Math.min(lines.length, MAX_DIFF_LINES)
    const result: DiffLine[] = lines.slice(0, limit).map((text, i) => ({ idx: i, type: 'remove' as const, prefix: '-', text }))
    if (lines.length > limit) result.push({ idx: limit, type: 'hunk', prefix: '', text: `(${lines.length - limit} more lines)` })
    return result
  }

  const rawDiff = computeLineDiff(oldStr.split('\n'), newStr.split('\n'))
  let lines = withContext(rawDiff)

  if (lines.length > MAX_DIFF_LINES) {
    const remaining = lines.length - MAX_DIFF_LINES
    lines = lines.slice(0, MAX_DIFF_LINES)
    lines.push({ idx: MAX_DIFF_LINES, type: 'hunk', prefix: '', text: `(${remaining} more lines)` })
  }

  applyCharHighlights(lines)
  return lines
}

export function computeWriteLines(input: Record<string, unknown>): DiffLine[] {
  if (!input?.content) return []
  const lines = String(input.content).split('\n')
  const limit = Math.min(lines.length, 50)
  const result: DiffLine[] = lines.slice(0, limit).map((text, i) => ({ idx: i, type: 'add' as const, prefix: '+', text }))
  if (lines.length > limit) result.push({ idx: limit, type: 'add', prefix: '…', text: `(${lines.length - limit} more lines)` })
  return result
}
