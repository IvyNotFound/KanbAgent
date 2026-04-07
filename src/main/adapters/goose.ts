/**
 * Block Goose CLI adapter for KanbAgent.
 *
 * Goose is Block's AI agent with CLI + ACP (Agent Communication Protocol) support.
 * Non-interactive mode: `goose run` with `--with-builtin developer`.
 * System prompt: via ACP stdio protocol init or `--system-prompt <file>`.
 *
 * TODO: Confirm whether child_process.spawn + stdio:pipe is sufficient for ACP,
 * or if an ACP handshake framing is needed before the first message.
 * TODO: Confirm flag name for system prompt injection (`--system-prompt` vs `--context`).
 *
 * @module adapters/goose
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

/** Validates custom goose binary names. */
export const GOOSE_CMD_REGEX = /^goose(-[a-z0-9-]+)?$/

export const gooseAdapter: CliAdapter = {
  cli: 'goose',
  binaries: ['goose'],

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.binaryName && GOOSE_CMD_REGEX.test(opts.binaryName))
      ? opts.binaryName
      : 'goose'

    const args: string[] = [
      'run',                           // non-interactive session mode
      '--with-builtin', 'developer',   // developer tools extension
    ]

    if (opts.systemPromptFile) {
      // TODO: confirm flag — may be --system-prompt or ACP init message
      args.push('--system-prompt', opts.systemPromptFile)
    }

    return { command: cmd, args }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult> {
    const filePath = join(tempDir, `goose-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    // Goose may emit ACP JSON or plain text — attempt parse, fallback to text
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (typeof parsed.type === 'string') {
        // TODO(T1518): Goose ACP tool event format is not yet confirmed from a real run.
        // Once confirmed, add explicit tool_use / tool_result conversion here (same pattern
        // as opencode.ts). Until then, ACP events with a type field pass through as-is.
        // ask_user: Goose ACP protocol is not yet confirmed. If Goose exposes a user-prompt
        // mechanism, emit { type: 'ask_user', text: '...' } here once the ACP format is known.
        // Until confirmed: N/A. (T1708)
        return parsed as unknown as StreamEvent
      }
      return { type: 'text', text: line }
    } catch {
      return { type: 'text', text: line }
    }
  },

  /**
   * Extract token usage from a Goose ACP stream event.
   *
   * Source: ACP JSON events that carry a usage object (exact event type is ACP-version-dependent).
   * Fields extracted (both snake_case and camelCase checked for ACP version compatibility):
   *   - tokensIn:  `usage.input_tokens` | `usage.inputTokens`
   *   - tokensOut: `usage.output_tokens` | `usage.outputTokens`
   * Checks both `event.usage` and `event.token_usage` field names as a defensive measure.
   * Goose does not report session cost in its events — costUsd is not populated.
   * Defensive: returns null for any event without a usage or token_usage object.
   *
   * @param event - Parsed stream event from parseLine.
   * @returns Partial token counts to accumulate, or null if the event carries no usage data.
   */
  extractTokenUsage(event: StreamEvent): Partial<TokenCounts> | null {
    // Goose ACP format — defensive: check both 'usage' and 'token_usage' field names
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = event as any
    const usage = raw.usage ?? raw.token_usage
    if (!usage) return null
    try {
      return {
        tokensIn: (usage.input_tokens ?? usage.inputTokens ?? 0) as number,
        tokensOut: (usage.output_tokens ?? usage.outputTokens ?? 0) as number,
      }
    } catch {
      return null
    }
  },
}
