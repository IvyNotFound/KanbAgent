/**
 * Fallback CLI adapter for KanbAgent.
 *
 * Used for any CLI not recognized in the registry.
 * Spawns the binary directly with no extra flags.
 * Output is wrapped as plain text StreamEvents — UX is degraded (no tool calls,
 * no session_id) but the user still sees CLI output in the session view.
 *
 * Adding a dedicated adapter improves UX without breaking this fallback.
 *
 * @module adapters/fallback
 */
import type {
  CliAdapter,
  LaunchOpts,
  SpawnSpec,
  SystemPromptResult,
  StreamEvent,
} from '../../shared/cli-types'

export const fallbackAdapter: CliAdapter = {
  cli: 'claude' as never,  // placeholder — getAdapter() overrides cli identity at call site
  binaries: [],

  buildCommand(opts: LaunchOpts): SpawnSpec {
    // Spawn the binary as-is with no extra flags
    const cmd = opts.customBinaryName ?? 'unknown-cli'
    return { command: cmd, args: [] }
  },

  async prepareSystemPrompt(_prompt: string, _tempDir: string): Promise<SystemPromptResult> {
    // Fallback: no system prompt injection — best-effort
    return {
      filePath: '',
      cleanup: async () => { /* nothing to clean up */ },
    }
  },

  parseLine(line: string): StreamEvent | null {
    if (!line.trim()) return null
    // Try JSON first; wrap as text if not parseable
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (typeof parsed.type === 'string') return parsed as unknown as StreamEvent
      return { type: 'text', text: line }
    } catch {
      return { type: 'text', text: line }
    }
  },
}
