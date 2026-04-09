/**
 * agents-generic.spec.ts — Targeted StringLiteral mutation kill tests
 *
 * Verifies that all language-specific GENERIC_AGENTS arrays contain
 * the expected agent entries with correct name, type, and scope values.
 * This kills uncovered StringLiteral mutants across all agents-*.ts files.
 *
 * Each generic agents array must contain: dev, review, test, doc, task-creator
 * with type and scope matching the expected protocol values.
 *
 * Framework: Vitest (node environment)
 */
import { describe, it, expect } from 'vitest'
import { GENERIC_AGENTS } from './agents-fr'
import { GENERIC_AGENTS_EN } from './agents-en'
import { GENERIC_AGENTS_DE } from './agents-de'
import { GENERIC_AGENTS_ES } from './agents-es'
import { GENERIC_AGENTS_PT } from './agents-pt'
import { GENERIC_AGENTS_PTBR } from './agents-pt-br'
import { GENERIC_AGENTS_IT } from './agents-it'
import { GENERIC_AGENTS_JA } from './agents-ja'
import { GENERIC_AGENTS_KO } from './agents-ko'
import { GENERIC_AGENTS_RU } from './agents-ru'
import { GENERIC_AGENTS_PL } from './agents-pl'
import { GENERIC_AGENTS_SV } from './agents-sv'
import { GENERIC_AGENTS_FI } from './agents-fi'
import { GENERIC_AGENTS_ZH_CN } from './agents-zh-cn'

type Agent = { name: string; type: string; scope: string | null }

function findAgent(agents: Agent[], name: string): Agent | undefined {
  return agents.find(a => a.name === name)
}

/** Validates that a generic agents array has the expected protocol structure. */
function validateGenericAgents(agents: Agent[], label: string) {
  describe(`${label} — agent names, types, scopes`, () => {
    it('contains 5 agents (dev, review, test, doc, task-creator)', () => {
      expect(agents).toHaveLength(5)
    })

    it('dev: name=dev, type=dev, scope=null', () => {
      const agent = findAgent(agents, 'dev')
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('dev')
      expect(agent!.type).toBe('dev')
      expect(agent!.scope).toBeNull()
    })

    it('review: name=review, type=review, scope=null', () => {
      const agent = findAgent(agents, 'review')
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('review')
      expect(agent!.type).toBe('review')
      expect(agent!.scope).toBeNull()
    })

    it('test: name=test, type=test, scope=null', () => {
      const agent = findAgent(agents, 'test')
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('test')
      expect(agent!.type).toBe('test')
      expect(agent!.scope).toBeNull()
    })

    it('doc: name=doc, type=doc, scope=null', () => {
      const agent = findAgent(agents, 'doc')
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('doc')
      expect(agent!.type).toBe('doc')
      expect(agent!.scope).toBeNull()
    })

    it('task-creator: name=task-creator, type=planner, scope=null', () => {
      const agent = findAgent(agents, 'task-creator')
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('task-creator')
      expect(agent!.type).toBe('planner')
      expect(agent!.scope).toBeNull()
    })

    it('all agents have non-empty system_prompt', () => {
      agents.forEach(agent => {
        expect(agent.system_prompt).toBeTruthy()
        expect(typeof agent.system_prompt).toBe('string')
        expect(agent.system_prompt.length).toBeGreaterThan(0)
      })
    })
  })
}

// ── All language variants ──────────────────────────────────────────────────────

validateGenericAgents(GENERIC_AGENTS as Agent[], 'GENERIC_AGENTS (fr)')
validateGenericAgents(GENERIC_AGENTS_EN as Agent[], 'GENERIC_AGENTS_EN')
validateGenericAgents(GENERIC_AGENTS_DE as Agent[], 'GENERIC_AGENTS_DE')
validateGenericAgents(GENERIC_AGENTS_ES as Agent[], 'GENERIC_AGENTS_ES')
validateGenericAgents(GENERIC_AGENTS_PT as Agent[], 'GENERIC_AGENTS_PT')
validateGenericAgents(GENERIC_AGENTS_PTBR as Agent[], 'GENERIC_AGENTS_PTBR')
validateGenericAgents(GENERIC_AGENTS_IT as Agent[], 'GENERIC_AGENTS_IT')
validateGenericAgents(GENERIC_AGENTS_JA as Agent[], 'GENERIC_AGENTS_JA')
validateGenericAgents(GENERIC_AGENTS_KO as Agent[], 'GENERIC_AGENTS_KO')
validateGenericAgents(GENERIC_AGENTS_RU as Agent[], 'GENERIC_AGENTS_RU')
validateGenericAgents(GENERIC_AGENTS_PL as Agent[], 'GENERIC_AGENTS_PL')
validateGenericAgents(GENERIC_AGENTS_SV as Agent[], 'GENERIC_AGENTS_SV')
validateGenericAgents(GENERIC_AGENTS_FI as Agent[], 'GENERIC_AGENTS_FI')
validateGenericAgents(GENERIC_AGENTS_ZH_CN as Agent[], 'GENERIC_AGENTS_ZH_CN')

// ── SHARED_SUFFIX (agents-fr.ts) — key content assertions ─────────────────────
import { SHARED_SUFFIX } from './agents-fr'

describe('SHARED_SUFFIX — protocol content', () => {
  it('is a non-empty string', () => {
    expect(SHARED_SUFFIX).toBeTruthy()
    expect(typeof SHARED_SUFFIX).toBe('string')
    expect(SHARED_SUFFIX.length).toBeGreaterThan(0)
  })

  it('contains DB schema reminder heading', () => {
    expect(SHARED_SUFFIX).toContain('Rappel schéma DB')
  })

  it('contains AGENT PROTOCOL REMINDER', () => {
    expect(SHARED_SUFFIX).toContain('AGENT PROTOCOL REMINDER')
  })

  it('contains TASK ISOLATION reference', () => {
    expect(SHARED_SUFFIX).toContain('TASK ISOLATION')
  })
})
