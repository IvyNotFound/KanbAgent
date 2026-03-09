/**
 * CLI adapter registry for KanbAgent.
 *
 * Maps CliType values to their CliAdapter implementations.
 * `getAdapter()` returns the appropriate adapter for a given CLI identifier,
 * falling back to `fallbackAdapter` for unrecognized values.
 *
 * @module adapters/index
 */
import type { CliAdapter } from '../../shared/cli-types'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { geminiAdapter } from './gemini'
import { opencodeAdapter } from './opencode'
import { aiderAdapter } from './aider'
import { gooseAdapter } from './goose'
import { fallbackAdapter } from './fallback'

const registry: Record<string, CliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter,
  aider: aiderAdapter,
  goose: gooseAdapter,
}

/**
 * Return the CliAdapter for the given CLI identifier.
 * Returns `fallbackAdapter` for any unrecognized value (future CLIs, typos).
 */
export function getAdapter(cli: string): CliAdapter {
  return registry[cli] ?? fallbackAdapter
}

export {
  claudeAdapter,
  codexAdapter,
  geminiAdapter,
  opencodeAdapter,
  aiderAdapter,
  gooseAdapter,
  fallbackAdapter,
}
