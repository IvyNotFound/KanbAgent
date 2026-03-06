/**
 * Block Goose CLI adapter for agent-viewer.
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
      if (typeof parsed.type === 'string') return parsed as unknown as StreamEvent
      return { type: 'text', text: line }
    } catch {
      return { type: 'text', text: line }
    }
  },
}
