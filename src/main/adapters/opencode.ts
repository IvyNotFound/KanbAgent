/**
 * SST OpenCode CLI adapter for agent-viewer.
 *
 * OpenCode is a terminal-based coding agent from SST.
 * Headless mode: `opencode run --format json` emits JSONL events to stdout.
 * No TTY required — stdout is streamed line by line without a TUI.
 *
 * Limitations:
 * - System prompt injection is not supported via CLI flags; configure via opencode config.
 * - Initial prompt is delivered via piped stdin (opencode run reads stdin as the message).
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
} from '../../shared/cli-types'

/** Validates custom opencode binary names. */
export const OPENCODE_CMD_REGEX = /^opencode(-[a-z0-9-]+)?$/

export const opencodeAdapter: CliAdapter = {
  cli: 'opencode',
  binaries: ['opencode'],
  singleShotStdin: true,

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
        // Text and reasoning blocks — show as text output
        return { type: 'text', text: typeof parsed.text === 'string' ? parsed.text : line }
      }
      if (evType === 'error') {
        // Error events — prefer message field, fallback to text or raw line
        const msg = typeof parsed.message === 'string' ? parsed.message
          : typeof parsed.text === 'string' ? parsed.text
          : line
        return { type: 'error', text: msg }
      }
      // tool_use, step_start, step_finish — lifecycle metadata, not displayed
      return null
    } catch {
      // Non-JSON line (plain text or ANSI output) — surface as text
      return { type: 'text', text: line }
    }
  },
}
