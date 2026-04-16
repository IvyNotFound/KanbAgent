/**
 * Tests for project-templates.ts (T1953).
 *
 * Covers:
 * - getProjectRules("en"): required sections present
 * - getProjectRules("fr"): French translations
 * - [project-name] placeholder is present and replaceable
 * - WORKFLOW_MD_TEMPLATE: non-empty markdown
 * - All AgentLanguage values produce non-empty output
 * - CLI_RULES_FILE_MAP: key mappings
 * - CLAUDE_MD_TEMPLATE backward-compat alias
 */

import { describe, it, expect } from 'vitest'
import {
  getProjectRules,
  WORKFLOW_MD_TEMPLATE,
  CLI_RULES_FILE_MAP,
  CLAUDE_MD_TEMPLATE,
} from './project-templates'

// ── getProjectRules("en") ─────────────────────────────────────────────────────

describe('getProjectRules("en")', () => {
  const output = getProjectRules('en')

  it('returns a non-empty string', () => {
    expect(output.length).toBeGreaterThan(0)
  })

  it('contains the Configuration section', () => {
    expect(output).toContain('Configuration')
  })

  it('contains MODE: solo', () => {
    expect(output).toContain('MODE: solo')
  })

  it('contains DB Access section', () => {
    expect(output).toContain('DB Access')
  })

  it('contains Ticket Workflow section', () => {
    expect(output).toContain('Ticket Workflow')
  })

  it('contains todo/in_progress/done/archived status flow', () => {
    expect(output).toContain('todo')
    expect(output).toContain('in_progress')
    expect(output).toContain('done')
    expect(output).toContain('archived')
  })

  it('references dbq.js and dbw.js', () => {
    expect(output).toContain('dbq.js')
    expect(output).toContain('dbw.js')
  })

  it('contains Agent Autonomy section', () => {
    expect(output).toContain('Agent Autonomy')
  })

  it('contains Agents section', () => {
    expect(output).toContain('Agents')
  })
})

// ── getProjectRules("fr") ─────────────────────────────────────────────────────

describe('getProjectRules("fr")', () => {
  const output = getProjectRules('fr')

  it('returns a non-empty string', () => {
    expect(output.length).toBeGreaterThan(0)
  })

  it('contains French configuration label', () => {
    expect(output).toContain('Configuration')
  })

  it('contains LANG_CONV in French', () => {
    expect(output).toContain('LANG_CONV: français')
  })

  it('contains French DB Access label', () => {
    expect(output).toContain('Accès DB')
  })

  it('contains French Ticket Workflow label', () => {
    expect(output).toContain('Workflow tickets')
  })

  it('contains French Agent Autonomy label', () => {
    expect(output).toContain('Autonomie des agents')
  })

  it('contains dbq.js and dbw.js (unchanged across langs)', () => {
    expect(output).toContain('dbq.js')
    expect(output).toContain('dbw.js')
  })
})

// ── [project-name] placeholder ────────────────────────────────────────────────

describe('getProjectRules — [project-name] placeholder', () => {
  it('contains [project-name] in English output', () => {
    expect(getProjectRules('en')).toContain('[project-name]')
  })

  it('contains [project-name] in French output', () => {
    expect(getProjectRules('fr')).toContain('[project-name]')
  })

  it('[project-name] can be replaced with a real project name', () => {
    const output = getProjectRules('en').replace(/\[project-name\]/g, 'MyApp')
    expect(output).toContain('MyApp')
    expect(output).not.toContain('[project-name]')
  })
})

// ── All AgentLanguage values ──────────────────────────────────────────────────

describe('getProjectRules — all supported languages produce non-empty output', () => {
  const langs = ['en', 'fr', 'es', 'pt', 'pt-BR', 'de', 'no', 'it', 'ar', 'ru', 'pl', 'sv', 'fi', 'da'] as const

  for (const lang of langs) {
    it(`lang="${lang}" returns non-empty string`, () => {
      expect(getProjectRules(lang).length).toBeGreaterThan(0)
    })
  }

  it('unknown lang falls back to English (contains "DB Access")', () => {
    // @ts-expect-error intentional unknown lang
    expect(getProjectRules('xx')).toContain('DB Access')
  })
})

// ── WORKFLOW_MD_TEMPLATE ──────────────────────────────────────────────────────

describe('WORKFLOW_MD_TEMPLATE', () => {
  it('is a non-empty string', () => {
    expect(typeof WORKFLOW_MD_TEMPLATE).toBe('string')
    expect(WORKFLOW_MD_TEMPLATE.length).toBeGreaterThan(0)
  })

  it('contains markdown heading', () => {
    expect(WORKFLOW_MD_TEMPLATE).toContain('# ')
  })

  it('contains status flow reference', () => {
    expect(WORKFLOW_MD_TEMPLATE).toContain('todo')
    expect(WORKFLOW_MD_TEMPLATE).toContain('in_progress')
  })

  it('contains schema section', () => {
    expect(WORKFLOW_MD_TEMPLATE).toContain('Schema')
  })
})

// ── CLI_RULES_FILE_MAP ────────────────────────────────────────────────────────

describe('CLI_RULES_FILE_MAP', () => {
  it('maps "claude" to "CLAUDE.md"', () => {
    expect(CLI_RULES_FILE_MAP['claude']).toBe('CLAUDE.md')
  })

  it('maps "gemini" to "GEMINI.md"', () => {
    expect(CLI_RULES_FILE_MAP['gemini']).toBe('GEMINI.md')
  })

  it('maps "codex" to ".codex/instructions.md"', () => {
    expect(CLI_RULES_FILE_MAP['codex']).toBe('.codex/instructions.md')
  })

  it('maps "aider" to ".aider/instructions.md"', () => {
    expect(CLI_RULES_FILE_MAP['aider']).toBe('.aider/instructions.md')
  })

  it('maps "cursor" to ".cursor/rules/instructions.md"', () => {
    expect(CLI_RULES_FILE_MAP['cursor']).toBe('.cursor/rules/instructions.md')
  })
})

// ── CLAUDE_MD_TEMPLATE backward-compat alias ──────────────────────────────────

describe('CLAUDE_MD_TEMPLATE', () => {
  it('equals getProjectRules("en")', () => {
    expect(CLAUDE_MD_TEMPLATE).toBe(getProjectRules('en'))
  })

  it('is a non-empty string', () => {
    expect(CLAUDE_MD_TEMPLATE.length).toBeGreaterThan(0)
  })
})
