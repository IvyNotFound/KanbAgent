/**
 * Aider CLI adapter for agent-viewer.
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
      '--no-auto-commits',  // never auto-commit — agent-viewer manages git state
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
    // Aider output is plain text — wrap as assistant text event
    return { type: 'text', text: line }
  },
}
