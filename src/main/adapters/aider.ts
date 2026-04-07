/**
 * Aider CLI adapter for KanbAgent.
 *
 * Aider (Paul Gauthier) is a multi-LLM coding assistant with headless support.
 * Headless mode: `aider --no-auto-commits --yes-always` (non-interactive).
 * System prompt: injected via `--read <file>` (file is prepended to context).
 *
 * TODO: Confirm if `--system-prompt` flag exists; `--read` is the safest fallback.
 * Note: Aider output is plain text; no stable session ID in phase 1.
 *
 * @module adapters/aider
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

/** Validates custom aider binary names. */
export const AIDER_CMD_REGEX = /^aider(-[a-z0-9-]+)?$/

export const aiderAdapter: CliAdapter = {
  cli: 'aider',
  binaries: ['aider'],

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.binaryName && AIDER_CMD_REGEX.test(opts.binaryName))
      ? opts.binaryName
      : 'aider'

    const args: string[] = [
      '--no-auto-commits',  // never auto-commit — KanbAgent manages git state
      '--yes-always',       // non-interactive: answer yes to prompts automatically
    ]

    if (opts.systemPromptFile) {
      // --read prepends the file as context before the conversation
      args.push('--read', opts.systemPromptFile)
    }

    return { command: cmd, args }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult> {
    const filePath = join(tempDir, `aider-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    // Aider output is plain text — wrap as assistant text event.
    // ask_user: N/A — --yes-always suppresses all interactive prompts automatically. (T1708)
    return { type: 'text', text: line }
  },

  /**
   * Extract token usage from an Aider plain-text event.
   *
   * Source: text lines matching Aider's summary format:
   *   `"Tokens: X sent, Y received. Cost: $Z session, ..."`
   * Fields extracted: sent count → tokensIn, received count → tokensOut, session cost → costUsd.
   * Commas in large numbers (e.g. `"1,234"`) are stripped before parseInt.
   * Defensive: returns null for any event whose text does not match the summary pattern.
   *
   * @param event - Parsed stream event from parseLine.
   * @returns Partial token counts to accumulate, or null if the event carries no usage data.
   */
  extractTokenUsage(event: StreamEvent): Partial<TokenCounts> | null {
    // Aider emits "Tokens: X sent, Y received. Cost: $Z session, ..." as a plain-text line
    const text = event.text
    if (!text) return null
    try {
      const m = text.match(/Tokens:\s*([\d,]+)\s*sent,\s*([\d,]+)\s*received/)
      if (!m) return null
      const costMatch = text.match(/Cost:\s*\$([0-9.]+)\s*session/)
      return {
        tokensIn: parseInt(m[1].replace(/,/g, ''), 10),
        tokensOut: parseInt(m[2].replace(/,/g, ''), 10),
        costUsd: costMatch ? parseFloat(costMatch[1]) : undefined,
      }
    } catch {
      return null
    }
  },
}
