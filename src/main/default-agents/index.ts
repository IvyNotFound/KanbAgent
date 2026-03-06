// Default agents for create-project-db
// Source: .claude/project.db agents table
// Update this file when agent prompts change in DB
//
// ⚠️ SYNC NOTE: GENERIC_AGENTS_BY_LANG contains parallel versions of the same agents in each language.
// Whenever a prompt is updated in one language, the other languages MUST be updated too.

export type { AgentLanguage, DefaultAgent } from './types'

import type { AgentLanguage, DefaultAgent } from './types'
import { GENERIC_AGENTS } from './agents-fr'
import { GENERIC_AGENTS_EN } from './agents-en'
import { GENERIC_AGENTS_JA } from './agents-ja'
import { GENERIC_AGENTS_ES } from './agents-es'
import { GENERIC_AGENTS_PT } from './agents-pt'
import { GENERIC_AGENTS_DE } from './agents-de'
import { GENERIC_AGENTS_PTBR } from './agents-pt-br'
import { GENERIC_AGENTS_IT } from './agents-it'
import { GENERIC_AGENTS_SV } from './agents-sv'
import { GENERIC_AGENTS_RU } from './agents-ru'
import { DEFAULT_AGENTS_GLOBAL } from './agents-default'
import { DEFAULT_AGENTS_SCOPED } from './agents-default-scoped'

/**
 * Generic agents indexed by language.
 * Use this map when seeding a new project with a specific language preference.
 *
 * ⚠️ SYNC: Whenever a prompt changes in one language, update the other language too.
 */
export const GENERIC_AGENTS_BY_LANG: Record<AgentLanguage, DefaultAgent[]> = {
  fr: GENERIC_AGENTS,
  en: GENERIC_AGENTS_EN,
  // New locales — translation tickets pending, fallback to English agents
  es: GENERIC_AGENTS_ES,
  pt: GENERIC_AGENTS_PT,
  'pt-BR': GENERIC_AGENTS_PTBR,
  de: GENERIC_AGENTS_DE,
  no: GENERIC_AGENTS_EN,
  it: GENERIC_AGENTS_IT,
  ar: GENERIC_AGENTS_EN,
  ru: GENERIC_AGENTS_RU,
  pl: GENERIC_AGENTS_EN,
  sv: GENERIC_AGENTS_SV,
  fi: GENERIC_AGENTS_EN,
  da: GENERIC_AGENTS_EN,
  tr: GENERIC_AGENTS_EN,
  'zh-CN': GENERIC_AGENTS_EN,
  ko: GENERIC_AGENTS_EN,
  ja: GENERIC_AGENTS_JA,
}

/**
 * Project-specific agents for agent-viewer.
 * These agents are seeded during agent-viewer's own `create-project-db` initialisation
 * and reference agent-viewer's perimeters (front-vuejs, back-electron, global).
 * Not suitable for generic projects — use GENERIC_AGENTS for new projects.
 */
export const DEFAULT_AGENTS: DefaultAgent[] = [
  ...DEFAULT_AGENTS_GLOBAL,
  ...DEFAULT_AGENTS_SCOPED,
]

// Named re-exports for backward compatibility with spec imports
export { GENERIC_AGENTS }
