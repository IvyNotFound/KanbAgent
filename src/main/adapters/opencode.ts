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
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'
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

  /**
   * Extract token usage from an OpenCode stream event.
   *
   * Source: `step_finish` JSONL events, surfaced internally as `system:step_finish` by parseLine.
   * Fields extracted (multiple aliases checked for cross-version compatibility):
   *   - tokensIn:  `usage.inputTokens` | `usage.input_tokens` | `usage.prompt_tokens`
   *   - tokensOut: `usage.outputTokens` | `usage.output_tokens` | `usage.completion_tokens`
   *   - costUsd:   `usage.cost_usd` (if present)
   * Defensive: returns null for any event without a usage object.
   *
   * @param event - Parsed stream event from parseLine.
   * @returns Partial token counts to accumulate, or null if the event carries no usage data.
   */
  extractTokenUsage(event: StreamEvent): Partial<TokenCounts> | null {
    // step_finish events may carry OpenAI-compatible usage data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const cmd = (opts.customBinaryName && OPENCODE_CMD_REGEX.test(opts.customBinaryName))
      ? opts.customBinaryName
      : 'opencode'

    const args: string[] = [
      'run',            // non-interactive subcommand (no TUI launched)
      '--format', 'json', // stream JSONL events to stdout line by line
    ]

    // Inject --model flag if a model ID is provided (T1356).
    if (opts.modelId) {
      args.push('--model', opts.modelId)
    }

    // System prompt injection (T1987):
    // - .jsonc extension: prepareSystemPrompt wrote opencode.jsonc in the worktree with
    //   an `instructions` field — OpenCode picks it up automatically via project config.
    //   Push initialMessage as-is; do not read the config file from here.
    // - .txt extension: no worktree config file was written; prepend the system prompt
    //   to the initial message between <system-instructions> tags.
    // - No systemPromptFile: push initialMessage as-is (unchanged behaviour).
    if (opts.systemPromptFile && opts.systemPromptFile.endsWith('.txt')) {
      const spContent = readFileSync(opts.systemPromptFile, 'utf-8')
      const msg = spContent
        ? `<system-instructions>\n${spContent}\n</system-instructions>\n\n${opts.initialMessage ?? ''}`.trim()
        : (opts.initialMessage ?? '')
      if (msg) args.push(msg)
    } else if (opts.initialMessage) {
      // Worktree mode (.jsonc) or no system prompt: push message as-is
      args.push(opts.initialMessage)
    }

    return { command: cmd, args }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string, cwd?: string): Promise<SystemPromptResult> {
    if (cwd) {
      // Worktree mode: write (or merge into) opencode.jsonc inside the isolated worktree.
      // The worktree is agent-specific so there is no race condition in multi-agent launches.
      const configPath = join(cwd, 'opencode.jsonc')
      let originalContent: string | null = null
      if (existsSync(configPath)) {
        originalContent = readFileSync(configPath, 'utf-8')
        try {
          const existing = JSON.parse(originalContent) as Record<string, unknown>
          existing.instructions = Array.isArray(existing.instructions)
            ? [prompt, ...existing.instructions as unknown[]]
            : [prompt]
          writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8')
        } catch {
          // Malformed JSON — overwrite entirely rather than corrupting the file further
          writeFileSync(configPath, JSON.stringify({ instructions: [prompt] }, null, 2), 'utf-8')
        }
      } else {
        writeFileSync(configPath, JSON.stringify({ instructions: [prompt] }, null, 2), 'utf-8')
      }
      return {
        filePath: configPath,
        cleanup: async () => {
          try {
            if (originalContent !== null) {
              writeFileSync(configPath, originalContent, 'utf-8')
            } else {
              unlinkSync(configPath)
            }
          } catch { /* best-effort */ }
        },
      }
    }

    // No worktree: write a plain .txt temp file.
    // buildCommand will read it and prepend its content to the initial message.
    const filePath = join(tempDir, `opencode-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  parseLine(line: string): StreamEvent | StreamEvent[] | null {
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
      // ask_user: N/A — OpenCode has no documented user-prompt mechanism in its JSONL protocol.
      // singleShotStdin: the process terminates after the first response, so interactive pauses
      // cannot occur. No ask_user event is emitted for this adapter. (T1708)

      if (evType === 'tool_use') {
        // Render tool calls as assistant content blocks (natively displayed by StreamToolBlock.vue)
        // Supported formats (in priority order):
        //   1. Official OpenCode SDK v2 format: part.tool, part.callID, part.state.input, part.state.output
        //   2. Legacy part-wrapped format (v1.3+): part.name, part.toolCallId, part.input
        //   3. Flat legacy format: name, toolCallId/id, input
        const tuPart = typeof parsed.part === 'object' && parsed.part !== null
          ? parsed.part as Record<string, unknown>
          : null
        // Tool name: part.tool (SDK v2) > part.name (v1.3+) > flat name
        const name = typeof tuPart?.tool === 'string' ? tuPart.tool
          : typeof tuPart?.name === 'string' ? tuPart.name
          : typeof parsed.name === 'string' ? parsed.name : 'unknown'
        if (name === 'unknown') {
          console.warn('[opencode] tool_use fallback to unknown:', line)
        }
        // State object (SDK v2): part.state carries input, output, status
        const stateObj = tuPart && typeof tuPart.state === 'object' && tuPart.state !== null
          ? tuPart.state as Record<string, unknown>
          : null
        // Input: part.input (v1.3+) > part.state.input (SDK v2) > flat input
        const input = (typeof tuPart?.input === 'object' && tuPart?.input !== null)
          ? tuPart.input as Record<string, unknown>
          : (stateObj && typeof stateObj.input === 'object' && stateObj.input !== null)
          ? stateObj.input as Record<string, unknown>
          : (typeof parsed.input === 'object' && parsed.input !== null)
          ? parsed.input as Record<string, unknown> : {}
        // Call ID: part.callID (SDK v2) > part.toolCallId (v1.3+) > flat toolCallId > part.id > flat id
        const tuId = typeof tuPart?.callID === 'string' ? tuPart.callID
          : typeof tuPart?.toolCallId === 'string' ? tuPart.toolCallId
          : typeof parsed.toolCallId === 'string' ? parsed.toolCallId
          : typeof tuPart?.id === 'string' ? tuPart.id
          : typeof parsed.id === 'string' ? parsed.id : undefined
        const toolUseEvent: StreamEvent = {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              name,
              input,
              tool_use_id: tuId,
            }],
          },
        }
        // SDK v2: tool result is inline in state.output — no separate tool_result event is emitted.
        // When state.output exists, emit tool_use + tool_result together as an array.
        if (stateObj && typeof stateObj.output === 'string') {
          const is_error = stateObj.status === 'error'
          const toolResultEvent: StreamEvent = {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_result',
                content: stateObj.output,
                tool_use_id: tuId,
                is_error,
              }],
            },
          }
          return [toolUseEvent, toolResultEvent]
        }
        return toolUseEvent
      }
      if (evType === 'tool_result') {
        // New format (v1.3+): fields are wrapped in a part object — same pattern as tool_use above.
        // Legacy format: fields are at the root of parsed.
        // Defensive field resolution: content > result > output > raw JSON (part fields take priority).
        const trPart = typeof parsed.part === 'object' && parsed.part !== null
          ? parsed.part as Record<string, unknown>
          : null
        const content = typeof trPart?.content === 'string' ? trPart.content
          : typeof parsed.content === 'string' ? parsed.content
          : typeof trPart?.result === 'string' ? trPart.result
          : typeof parsed.result === 'string' ? parsed.result
          : typeof trPart?.output === 'string' ? trPart.output
          : typeof parsed.output === 'string' ? parsed.output
          : JSON.stringify(parsed)
        const trId = typeof trPart?.toolCallId === 'string' ? trPart.toolCallId
          : typeof parsed.toolCallId === 'string' ? parsed.toolCallId
          : typeof trPart?.id === 'string' ? trPart.id
          : typeof parsed.id === 'string' ? parsed.id : undefined
        const is_error = trPart?.isError === true || parsed.isError === true
          || trPart?.is_error === true || parsed.is_error === true
        return {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_result',
              content,
              tool_use_id: trId,
              is_error,
            }],
          },
        } as StreamEvent
      }
      // step_start and other lifecycle metadata — not displayed
      return null
    } catch {
      // Non-JSON line (plain text or ANSI output) — surface as text
      return { type: 'text', text: line }
    }
  },
}
