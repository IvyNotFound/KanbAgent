/**
 * OpenAI Codex CLI adapter for KanbAgent.
 *
 * Codex runs in headless mode via `--approval-mode full-auto`.
 * System prompt is injected via `--instructions <file>` (file path, no shell interpolation).
 * Output format: JSON events — currently treated as text for phase 1 (T1012).
 *
 * @module adapters/codex
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

/** Validates custom codex binary names. */
export const CODEX_CMD_REGEX = /^codex(-[a-z0-9-]+)?$/

export const codexAdapter: CliAdapter = {
  cli: 'codex',
  binaries: ['codex'],

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.binaryName && CODEX_CMD_REGEX.test(opts.binaryName))
      ? opts.binaryName
      : 'codex'

    const args: string[] = ['--approval-mode', 'full-auto']

    if (opts.systemPromptFile) {
      // Codex accepts a file path for instructions — no shell interpolation needed.
      args.push('--instructions', opts.systemPromptFile)
    }

    if (opts.modelId) {
      args.push('--model', opts.modelId)
    }

    // Note: Codex does not expose a stable conversation ID (no --resume in phase 1).
    // Note: thinkingMode and permissionMode are Claude-specific — ignored here.

    return { command: cmd, args }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult> {
    const filePath = join(tempDir, `codex-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    // Codex emits OpenAI-compatible JSON events — attempt parse first, fallback to text wrapping.
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (typeof parsed.type !== 'string') {
        // JSON object without type — wrap as text
        return { type: 'text', text: line }
      }
      // Handle OpenAI response.* events
      if (parsed.type.startsWith('response.')) {
        // response.output_item.added with function_call → tool_use block
        if (parsed.type === 'response.output_item.added') {
          const item = parsed.item as Record<string, unknown> | undefined
          if (item?.type === 'function_call') {
            let input: Record<string, unknown> = {}
            try {
              input = JSON.parse(typeof item.arguments === 'string' ? item.arguments : '{}') as Record<string, unknown>
            } catch { /* malformed arguments — fall back to empty */ }
            return {
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [{
                  type: 'tool_use',
                  name: typeof item.name === 'string' ? item.name : 'unknown',
                  input,
                  tool_use_id: typeof item.call_id === 'string' ? item.call_id : undefined,
                }],
              },
            } as StreamEvent
          }
        }
        // response.completed and other lifecycle events — not displayed
        return null
      }
      // Non-response events — pass through as-is (e.g. future Codex event types)
      return parsed as unknown as StreamEvent
    } catch {
      // Plain text line — wrap as assistant text event
      return { type: 'text', text: line }
    }
    // ask_user: N/A — --approval-mode full-auto suppresses all interactive prompts. (T1708)
  },

  /**
   * Extract token usage from a Codex stream event.
   *
   * Source: OpenAI-compatible JSON events (e.g. `response.completed` or similar).
   * Fields extracted (multiple aliases checked):
   *   - tokensIn:  `usage.input_tokens` | `usage.prompt_tokens`
   *   - tokensOut: `usage.output_tokens` | `usage.completion_tokens`
   * Codex does not report session cost in its events — costUsd is not populated.
   * Defensive: returns null for any event without a usage object.
   *
   * @param event - Parsed stream event from parseLine.
   * @returns Partial token counts to accumulate, or null if the event carries no usage data.
   */
  extractTokenUsage(event: StreamEvent): Partial<TokenCounts> | null {
    // Codex emits OpenAI-compatible JSON events; usage may appear in response.completed or similar
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = (event as any).usage
    if (!usage) return null
    try {
      return {
        tokensIn: (usage.input_tokens ?? usage.prompt_tokens ?? 0) as number,
        tokensOut: (usage.output_tokens ?? usage.completion_tokens ?? 0) as number,
      }
    } catch {
      return null
    }
  },

  // No stable session ID in Codex phase 1 — extractConvId not implemented.
}
