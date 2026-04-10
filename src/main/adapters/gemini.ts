/**
 * Google Gemini CLI adapter for KanbAgent.
 *
 * Headless mode: `gemini -p "<prompt>" --output-format stream-json` emits JSONL events to stdout.
 * No TTY required — stdout is streamed line by line.
 * System prompt injection is not supported via CLI flags; configure via GEMINI.md in project root.
 * Initial prompt is delivered via `-p` positional flag at spawn time.
 * Multi-turn follow-ups require re-spawning with a new `-p` value (not currently supported).
 *
 * @module adapters/gemini
 */
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type {
  CliAdapter,
  LaunchOpts,
  SpawnSpec,
  SystemPromptResult,
  StreamEvent,
  TokenCounts,
} from '../../shared/cli-types'

/** Validates custom gemini binary names. */
export const GEMINI_CMD_REGEX = /^gemini(-[a-z0-9-]+)?$/

export const geminiAdapter: CliAdapter = {
  cli: 'gemini',
  binaries: ['gemini'],
  singleShotStdin: true,

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.customBinaryName && GEMINI_CMD_REGEX.test(opts.customBinaryName))
      ? opts.customBinaryName
      : 'gemini'

    const args: string[] = []

    if (opts.convId) {
      args.push('--resume', opts.convId)
    }

    const effectiveModel = opts.modelId || opts.model
    if (effectiveModel) {
      args.push('-m', effectiveModel)
    }

    if (opts.initialMessage) {
      // Headless mode: stream JSONL events to stdout line by line.
      args.push('--output-format', 'stream-json')
      // -p enters non-interactive mode; required for headless operation (no TTY).
      args.push('-p', opts.initialMessage)
    }

    // Note: gemini CLI has no --system-prompt flag.
    // Configure system prompt via GEMINI.md in the project root instead.

    return { command: cmd, args }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult> {
    const filePath = join(tempDir, `gemini-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  extractConvId(event: StreamEvent): string | null {
    if (
      event.type === 'system' &&
      event.subtype === 'init' &&
      typeof event.session_id === 'string'
    ) {
      return event.session_id
    }
    return null
  },

  /**
   * Extract token usage from a Gemini stream event.
   *
   * Source: `result:success` JSONL events, surfaced internally as `system:stats` by parseLine.
   * Fields extracted: `stats.inputTokenCount` → tokensIn, `stats.outputTokenCount` → tokensOut.
   * Fallback: older Gemini CLI versions only expose `stats.total_tokens` → mapped to tokensOut.
   * Defensive: returns null for any event that is not a stats event or if stats is absent.
   *
   * @param event - Parsed stream event from parseLine.
   * @returns Partial token counts to accumulate, or null if the event carries no usage data.
   */
  extractTokenUsage(event: StreamEvent): Partial<TokenCounts> | null {
    // Only system:stats events (emitted from result:success) carry token data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((event as any).subtype !== 'stats') return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = (event as any).stats
    if (!stats) return null
    try {
      const tokensIn = (stats.inputTokenCount ?? 0) as number
      const tokensOut = (stats.outputTokenCount ?? 0) as number
      // Fallback: older Gemini CLI versions only expose total_tokens
      if (tokensIn === 0 && tokensOut === 0 && stats.total_tokens) {
        return { tokensIn: 0, tokensOut: stats.total_tokens as number }
      }
      return { tokensIn, tokensOut }
    } catch {
      return null
    }
  },

  formatStdinMessage(text: string): string {
    // Gemini CLI interactive mode expects plain text input, not Claude JSONL format.
    return text + '\n'
  },

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const evType = parsed.type

      if (evType === 'init') {
        // Emit system:init so extractConvId can capture the session UUID.
        const sid = typeof parsed.session_id === 'string' ? parsed.session_id : undefined
        return sid ? { type: 'system', subtype: 'init', session_id: sid } : null
      }

      if (evType === 'message') {
        if (parsed.role === 'user') return null  // echo of user input, not displayed
        if (parsed.role === 'assistant') {
          // Both delta (streaming chunks) and non-delta (final) assistant messages
          const content = typeof parsed.content === 'string' ? parsed.content : ''
          if (!content) return null
          return { type: 'text', text: content }
        }
        return null
      }

      if (evType === 'result') {
        if (parsed.status === 'success') {
          // Return as system event so extractTokenUsage can access stats; not displayed by renderer
          return { type: 'system', subtype: 'stats', stats: parsed.stats ?? null } as unknown as StreamEvent
        }
        // Error result
        const errMsg = typeof parsed.error === 'string'
          ? parsed.error
          : `Process exited with status: ${String(parsed.status)}`
        return { type: 'error', text: errMsg }
      }

      if (evType === 'tool_use') {
        // Render tool calls as assistant content blocks (natively displayed by StreamToolBlock.vue)
        return {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              name: typeof parsed.name === 'string' ? parsed.name : 'unknown',
              input: (typeof parsed.input === 'object' && parsed.input !== null)
                ? parsed.input as Record<string, unknown> : {},
              tool_use_id: typeof parsed.id === 'string' ? parsed.id : undefined,
            }],
          },
        } as StreamEvent
      }
      // ask_user: N/A — Gemini CLI runs in single-shot mode (-p flag): one prompt → one response,
      // then exits. Multi-turn pauses for user input cannot occur. No ask_user event emitted. (T1708)
      // Unknown type — ignore lifecycle metadata
      return null
    } catch {
      // Non-JSON line (e.g. "Loaded cached credentials.") — surface as text
      return { type: 'text', text: line }
    }
  },
}
