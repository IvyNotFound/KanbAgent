/**
 * Hook server — JSONL transcript parsing and token counting.
 *
 * Extracted from hookServer.ts (T1131) to keep file size under 400 lines.
 *
 * @module hookServer-tokens
 */
import { createReadStream } from 'fs'
import { createInterface } from 'readline'

// ── Token types ────────────────────────────────────────────────────────────────

export interface TokenCounts {
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
}

// ── JSONL parsing ─────────────────────────────────────────────────────────────

/**
 * Parse token usage from a Claude Code conversation JSONL file content.
 *
 * Only counts finalized assistant messages (stop_reason != null).
 * Each API call produces two JSONL entries with the same requestId:
 *   - streaming start (stop_reason: null, output_tokens ~1)
 *   - final message  (stop_reason set, full output_tokens)
 * Only the final entry is counted to avoid double-counting.
 *
 * @param content - Raw JSONL string (newline-separated JSON objects)
 * @returns Summed token counts
 */
export function parseTokensFromJSONL(content: string): TokenCounts {
  let tokensIn = 0
  let tokensOut = 0
  let cacheRead = 0
  let cacheWrite = 0

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = JSON.parse(trimmed) as any
      if (obj.type !== 'assistant') continue
      if (!obj.message?.usage || obj.message.stop_reason == null) continue
      const u = obj.message.usage
      tokensIn   += (u.input_tokens                 ?? 0)
      tokensOut  += (u.output_tokens                ?? 0)
      cacheRead  += (u.cache_read_input_tokens       ?? 0)
      cacheWrite += (u.cache_creation_input_tokens   ?? 0)
    } catch { /* malformed line — skip */ }
  }

  return { tokensIn, tokensOut, cacheRead, cacheWrite }
}

/**
 * Stream-based variant — reads the transcript file line by line without loading
 * the whole content into memory.  Used by handleStop to avoid OOM on large files.
 */
export function parseTokensFromJSONLStream(transcriptPath: string): Promise<TokenCounts> {
  return new Promise((resolve, reject) => {
    const counts: TokenCounts = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }
    const rl = createInterface({ input: createReadStream(transcriptPath), crlfDelay: Infinity })
    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = JSON.parse(trimmed) as any
        if (obj.type !== 'assistant') return
        if (!obj.message?.usage || obj.message.stop_reason == null) return
        const u = obj.message.usage
        counts.tokensIn    += (u.input_tokens                 ?? 0)
        counts.tokensOut   += (u.output_tokens                ?? 0)
        counts.cacheRead   += (u.cache_read_input_tokens       ?? 0)
        counts.cacheWrite  += (u.cache_creation_input_tokens   ?? 0)
      } catch { /* malformed line — skip */ }
    })
    rl.on('close', () => resolve(counts))
    rl.on('error', reject)
  })
}
