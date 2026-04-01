/**
 * SST OpenCode CLI adapter for KanbAgent.
 *
 * OpenCode is a terminal-based coding agent from SST.
 * Headless mode: `opencode run --format json` emits JSONL events to stdout.
 * No TTY required — stdout is streamed line by line without a TUI.
 *
 * Limitations:
 * - System prompt injection is not supported via CLI flags; configure via opencode config.
 * - Initial prompt is delivered as a positional argument: `opencode run "message" --format json`.
 *   Multi-turn follow-ups require re-spawning with --continue (not currently supported).
 *
 * @module adapters/opencode
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

/** Validates custom opencode binary names. */
export const OPENCODE_CMD_REGEX = /^opencode(-[a-z0-9-]+)?$/

export const opencodeAdapter: CliAdapter = {
  cli: 'opencode',
  binaries: ['opencode'],
  singleShotStdin: true,

  extractTokenUsage(event: StreamEvent): Partial<TokenCounts> | null {
    // step_finish events may carry OpenAI-compatible usage data
    const raw = event as any
    const usage = raw.usage
    if (!usage) return null
    try {
      return {
        tokensIn: (usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0) as number,
        tokensOut: (usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0) as number,
        costUsd: typeof usage.cost_usd === 'number' ? usage.cost_usd : undefined,
      }
    } catch {
      return null
    }
  },

  formatStdinMessage(text: string): string {
    // opencode run reads stdin as plain text until EOF — not Claude's JSONL format.
    return text + '\n'
  },

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.binaryName && OPENCODE_CMD_REGEX.test(opts.binaryName))
      ? opts.binaryName
      : 'opencode'

    const args: string[] = [
      'run',            // non-interactive subcommand (no TUI launched)
      '--format', 'json', // stream JSONL events to stdout line by line
    ]

    // Note: opencode does not expose a --system-prompt CLI flag.
    // opts.systemPromptFile is intentionally ignored here; configure system
    // prompt via opencode's project config file instead.

    // Inject --model flag if a model ID is provided (T1356).
    if (opts.modelId) {
      args.push('--model', opts.modelId)
    }

    // opencode run takes the prompt as a positional argument array (not via stdin).
    // Passing it here ensures opencode processes the message immediately on spawn.
    if (opts.initialMessage) {
      args.push(opts.initialMessage)
    }

    return { command: cmd, args }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult> {
    const filePath = join(tempDir, `opencode-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const evType = parsed.type

      if (evType === 'text' || evType === 'reasoning') {
        // Text and reasoning blocks — show as text output.
        // New format (v1.3+): text is wrapped in a part object: { type: 'text', part: { text: '...' } }
        // Legacy format: { type: 'text', text: '...' }
        const part = typeof parsed.part === 'object' && parsed.part !== null
          ? parsed.part as Record<string, unknown>
          : null
        const text = typeof part?.text === 'string' ? part.text
          : typeof parsed.text === 'string' ? parsed.text
          : null
        if (text === null) {
          // Unknown structure — surface raw line rather than silently dropping content.
          // Log to help diagnose future format changes.
          console.warn('[opencode] parseLine: text event with unknown structure, surfacing raw line')
          return { type: 'text', text: line }
        }
        return { type: 'text', text }
      }
      if (evType === 'error') {
        // Error events — handle both flat {message} and nested {error:{data:{message}}} formats (v1.2+)
        const errObj = typeof parsed.error === 'object' && parsed.error !== null
          ? parsed.error as Record<string, unknown>
          : null
        const errData = errObj && typeof errObj.data === 'object' && errObj.data !== null
          ? errObj.data as Record<string, unknown>
          : null
        const msg = typeof parsed.message === 'string' ? parsed.message
          : typeof parsed.text === 'string' ? parsed.text
          : typeof errData?.message === 'string' ? errData.message
          : line
        return { type: 'error', text: msg }
      }
      if (evType === 'step_finish') {
        // May carry usage data — return as system event so extractTokenUsage can access it
        return { type: 'system', subtype: 'step_finish', usage: (parsed.usage ?? null) } as unknown as StreamEvent
      }
      // tool_use, step_start, and other lifecycle metadata — not displayed
      return null
    } catch {
      // Non-JSON line (plain text or ANSI output) — surface as text
      return { type: 'text', text: line }
    }
  },
}
