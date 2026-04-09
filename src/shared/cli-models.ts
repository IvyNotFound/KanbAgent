/**
 * CLI model registry for KanbAgent (T1802).
 *
 * Defines available models per CLI tool as a static registry.
 * Used by the `cli:get-models` IPC handler and LaunchSessionModal.
 *
 * OpenCode models are populated dynamically via config file detection —
 * the static list here is empty for OpenCode.
 *
 * @module shared/cli-models
 */
import type { CliType } from './cli-types'

export interface CliModelDef {
  /** Short alias used as a key: 'sonnet', 'opus', 'gpt-4o'. */
  id: string
  /** Display label: 'Sonnet 4.6', 'Opus 4.6'. */
  label: string
  /** Value passed to the CLI --model flag: 'sonnet', 'opus'. */
  modelId: string
  /** Provider name: 'anthropic', 'openai', 'google'. */
  provider?: string
  /** Context window size in tokens. */
  contextLength?: number
  /** True if detected at runtime (vs static registry). */
  dynamic?: boolean
}

/**
 * Static model lists per CLI.
 *
 * Only CLIs with known, stable model flags are included.
 * OpenCode models are detected at runtime from config files.
 */
export const CLI_STATIC_MODELS: Partial<Record<CliType, CliModelDef[]>> = {
  claude: [
    { id: 'sonnet', label: 'Sonnet', modelId: 'sonnet' },
    { id: 'opus', label: 'Opus', modelId: 'opus' },
    { id: 'haiku', label: 'Haiku', modelId: 'haiku' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', modelId: 'gemini-2.5-pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash' },
  ],
  aider: [
    { id: 'sonnet', label: 'Claude Sonnet', modelId: 'claude-sonnet-4-6' },
    { id: 'opus', label: 'Claude Opus', modelId: 'claude-opus-4-6' },
    { id: 'gpt-4o', label: 'GPT-4o', modelId: 'gpt-4o' },
    { id: 'o3', label: 'o3', modelId: 'o3' },
  ],
  codex: [
    { id: 'o3', label: 'o3', modelId: 'o3' },
    { id: 'o4-mini', label: 'o4 Mini', modelId: 'o4-mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1', modelId: 'gpt-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', modelId: 'gpt-4.1-mini' },
  ],
  goose: [
    { id: 'gpt-4.1', label: 'GPT-4.1', modelId: 'gpt-4.1' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', modelId: 'claude-sonnet-4-6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus', modelId: 'claude-opus-4-6' },
  ],
  opencode: [], // populated dynamically via cli:get-models
}
