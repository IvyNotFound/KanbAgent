/**
 * CLI model registry for KanbAgent (T1802).
 *
 * Defines available models per CLI tool as a static registry.
 * Used by the `cli:get-models` IPC handler and LaunchSessionModal.
 *
 * OpenCode models are populated dynamically via config file detection —
 * the static list here is empty for OpenCode.
 *
 * Pricing (T1924): standard real-time rates in USD per 1M tokens.
 * Sources: https://www.anthropic.com/pricing · https://openai.com/pricing · https://ai.google.dev/pricing
 * Last checked: 2026-04-16
 *
 * @module shared/cli-models
 */
import type { CliType } from './cli-types'

/** USD pricing per 1M tokens for a given model. */
export interface ModelPricing {
  /** $ per 1M input tokens */
  input: number
  /** $ per 1M output tokens */
  output: number
  /** $ per 1M cache-read tokens (prompt cache hit) */
  cacheRead?: number
  /** $ per 1M cache-write tokens (prompt cache creation) */
  cacheWrite?: number
}

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
  /** Standard real-time pricing. Absent = unknown / free tier. */
  pricing?: ModelPricing
}

/**
 * Static model lists per CLI.
 *
 * Only CLIs with known, stable model flags are included.
 * OpenCode models are detected at runtime from config files.
 */
export const CLI_STATIC_MODELS: Partial<Record<CliType, CliModelDef[]>> = {
  claude: [
    { id: 'sonnet', label: 'Sonnet', modelId: 'sonnet',
      pricing: { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 } },
    { id: 'opus', label: 'Opus', modelId: 'claude-opus-4-7',
      pricing: { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 } },
    { id: 'haiku', label: 'Haiku', modelId: 'haiku',
      pricing: { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 } },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', modelId: 'gemini-2.5-pro',
      pricing: { input: 1.25, output: 10.00 } },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash',
      pricing: { input: 0.15, output: 0.60 } },
  ],
  aider: [
    { id: 'sonnet', label: 'Claude Sonnet', modelId: 'claude-sonnet-4-6',
      pricing: { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 } },
    { id: 'opus', label: 'Claude Opus', modelId: 'claude-opus-4-7',
      pricing: { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 } },
    { id: 'gpt-4o', label: 'GPT-4o', modelId: 'gpt-4o',
      pricing: { input: 2.50, output: 10.00 } },
    { id: 'o3', label: 'o3', modelId: 'o3',
      pricing: { input: 10.00, output: 40.00 } },
  ],
  codex: [
    { id: 'o3', label: 'o3', modelId: 'o3',
      pricing: { input: 10.00, output: 40.00 } },
    { id: 'o4-mini', label: 'o4 Mini', modelId: 'o4-mini',
      pricing: { input: 1.10, output: 4.40 } },
    { id: 'gpt-4.1', label: 'GPT-4.1', modelId: 'gpt-4.1',
      pricing: { input: 2.00, output: 8.00 } },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', modelId: 'gpt-4.1-mini',
      pricing: { input: 0.40, output: 1.60 } },
  ],
  goose: [
    { id: 'gpt-4.1', label: 'GPT-4.1', modelId: 'gpt-4.1',
      pricing: { input: 2.00, output: 8.00 } },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', modelId: 'claude-sonnet-4-6',
      pricing: { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 } },
    { id: 'claude-opus-4-7', label: 'Claude Opus', modelId: 'claude-opus-4-7',
      pricing: { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 } },
  ],
  opencode: [], // populated dynamically via cli:get-models
}

/**
 * Look up pricing for a given modelId (the value stored in sessions.model_used).
 *
 * Searches all CLIs (or a specific one when `cli` is provided) and matches by
 * `modelId` field. Returns the first match found, or `null` if unknown.
 *
 * @param modelId - The model identifier as stored in sessions.model_used (e.g. 'sonnet', 'claude-sonnet-4-6', 'gpt-4o')
 * @param cli     - Optional CLI type to restrict the search
 */
export function getModelPricing(modelId: string, cli?: CliType): ModelPricing | null {
  for (const [cliKey, models] of Object.entries(CLI_STATIC_MODELS)) {
    if (cli != null && cliKey !== cli) continue
    const found = (models as CliModelDef[]).find(m => m.modelId === modelId)
    if (found?.pricing) return found.pricing
  }
  return null
}
