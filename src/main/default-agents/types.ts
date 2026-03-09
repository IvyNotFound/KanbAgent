/**
 * Language for generic agent prompts.
 * Used by GENERIC_AGENTS_BY_LANG and the create-project-db IPC handler.
 * New language entries fall back to 'en' until translation tickets are completed.
 */
export type AgentLanguage =
  | 'fr'
  | 'en'
  | 'es'
  | 'pt'
  | 'pt-BR'
  | 'de'
  | 'no'
  | 'it'
  | 'ar'
  | 'ru'
  | 'pl'
  | 'sv'
  | 'fi'
  | 'da'
  | 'tr'
  | 'zh-CN'
  | 'ko'
  | 'ja'

/**
 * Describes a Claude agent definition to be seeded into a project.db.
 * Used by both GENERIC_AGENTS (any project) and DEFAULT_AGENTS (KanbAgent).
 */
export interface DefaultAgent {
  /** Unique agent name — used as the lookup key in agents table. */
  name: string
  /** Agent role category (dev, review, test, doc, devops, arch, ux, secu, perf, data). */
  type: string
  /** Target scope (front-vuejs, back-electron, global) or null for generic agents. */
  scope: string | null
  /** Main system prompt injected at session start. Null means no dedicated prompt. */
  system_prompt: string | null
  /** Suffix appended after system_prompt — typically contains DB schema and SQL reminders. */
  system_prompt_suffix: string | null
}
