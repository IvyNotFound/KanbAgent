/**
 * SST OpenCode CLI adapter for agent-viewer.
 *
 * OpenCode is a terminal-based coding agent from SST.
 * System prompt injection and headless flags to be confirmed during testing.
 * Output: plain text — wrapped as StreamEvent for phase 1 (T1012).
 *
 * TODO: Confirm flags for non-interactive mode and system prompt injection.
 * The opencode CLI is session-based; review `opencode run` vs `opencode session`.
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

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.binaryName && OPENCODE_CMD_REGEX.test(opts.binaryName))
      ? opts.binaryName
      : 'opencode'

    const args: string[] = [
      'run',  // TODO: confirm subcommand for headless/non-interactive mode
    ]

    if (opts.systemPromptFile) {
      // TODO: confirm flag — may be --message, --system-prompt, or config file
      args.push('--message', `@${opts.systemPromptFile}`)
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
      if (typeof parsed.type === 'string') return parsed as unknown as StreamEvent
      return { type: 'text', text: line }
    } catch {
      return { type: 'text', text: line }
    }
  },
}
