/**
 * Google Gemini CLI adapter for agent-viewer.
 *
 * Gemini runs in headless mode via `--headless` (to be confirmed during testing).
 * System prompt injection via `--system-prompt <file>` (to be confirmed).
 * Output: plain text — wrapped as StreamEvent for phase 1 (T1012).
 *
 * TODO: Confirm exact flags for headless mode and system prompt injection when
 * testing with the actual gemini binary. Update buildCommand accordingly.
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
} from '../../shared/cli-types'

/** Validates custom gemini binary names. */
export const GEMINI_CMD_REGEX = /^gemini(-[a-z0-9-]+)?$/

export const geminiAdapter: CliAdapter = {
  cli: 'gemini',
  binaries: ['gemini'],

  buildCommand(opts: LaunchOpts): SpawnSpec {
    const cmd = (opts.binaryName && GEMINI_CMD_REGEX.test(opts.binaryName))
      ? opts.binaryName
      : 'gemini'

    const args: string[] = [
      '--headless',  // TODO: confirm flag name for non-interactive mode
    ]

    if (opts.systemPromptFile) {
      // TODO: confirm flag name — may be --system-prompt, --context, or --instructions
      args.push('--system-prompt', opts.systemPromptFile)
    }

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

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    // Attempt JSON parse; fallback to text wrapping.
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (typeof parsed.type === 'string') return parsed as unknown as StreamEvent
      return { type: 'text', text: line }
    } catch {
      return { type: 'text', text: line }
    }
  },
}
