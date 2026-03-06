/**
 * OpenAI Codex CLI adapter for agent-viewer.
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
    // Codex emits JSON events — attempt parse first, fallback to text wrapping.
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      // Normalize to StreamEvent shape (type field required)
      if (typeof parsed.type === 'string') {
        return parsed as unknown as StreamEvent
      }
      // JSON object without type — wrap as text
      return { type: 'text', text: line }
    } catch {
      // Plain text line — wrap as assistant text event
      return { type: 'text', text: line }
    }
  },

  // No stable session ID in Codex phase 1 — extractConvId not implemented.
}
