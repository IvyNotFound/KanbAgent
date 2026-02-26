/**
 * Composable for launching agent terminal sessions.
 *
 * Extracted from useAutoLaunch to be reusable by board drag & drop
 * and other UI triggers (T345).
 *
 * @module composables/useLaunchSession
 */

import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'

export const MAX_AGENT_SESSIONS = 3

interface ClaudeInstance {
  distro: string
  version: string
  isDefault: boolean
  profiles: string[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
let cachedInstances: ClaudeInstance[] | null = null
let cacheTimestamp = 0

async function getCachedClaudeInstances(): Promise<ClaudeInstance[]> {
  const now = Date.now()
  if (cachedInstances && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedInstances
  }
  const result = await window.electronAPI.getClaudeInstances() as ClaudeInstance[]
  if (result.length > 0) {
    cachedInstances = result
    cacheTimestamp = now
  }
  return result
}

export function useLaunchSession() {
  const tabsStore = useTabsStore()
  const tasksStore = useTasksStore()

  /**
   * Count open terminal tabs for a given agent.
   */
  function agentTerminalCount(agentName: string): number {
    return tabsStore.tabs.filter(tab => tab.type === 'terminal' && tab.agentName === agentName).length
  }

  /**
   * Launch a terminal session for an agent working on a specific task.
   * Returns 'ok' on success, 'session-limit' if max sessions reached, 'error' otherwise.
   */
  async function launchAgentTerminal(agent: Agent, task: Task): Promise<'ok' | 'session-limit' | 'error'> {
    const dbPath = tasksStore.dbPath
    if (!dbPath) return 'error'

    const maxSess = agent.max_sessions ?? MAX_AGENT_SESSIONS
    if (maxSess !== -1 && agentTerminalCount(agent.name) >= maxSess) {
      return 'session-limit'
    }

    try {
      const instances = await getCachedClaudeInstances()
      if (instances.length === 0) return 'error'

      const instance = instances.find(i => i.isDefault) ?? instances[0]

      const promptResult = await window.electronAPI.getAgentSystemPrompt(dbPath, agent.id)
      if (!promptResult.success) return 'error'

      const userPrompt = `Tâches: #${task.id}[${task.statut}] -> Tu es agent ${agent.name}. Va voir ton prompt system dans la table agent.`
      const finalPrompt = await window.electronAPI.buildAgentPrompt(
        agent.name,
        userPrompt,
        dbPath,
        agent.id
      )

      const parts: string[] = []
      if (promptResult.systemPrompt) parts.push(promptResult.systemPrompt)
      if (promptResult.systemPromptSuffix) parts.push(promptResult.systemPromptSuffix)
      const fullSystemPrompt = parts.join('\n\n') || undefined

      const thinkingMode = (promptResult.thinkingMode as 'auto' | 'disabled') ?? 'auto'

      tabsStore.addTerminal(
        agent.name,
        instance.distro,
        finalPrompt,
        fullSystemPrompt,
        thinkingMode,
        undefined,
        undefined,
        false,
        task.id
      )

      return 'ok'
    } catch (err) {
      console.warn('[launchSession] Failed to launch terminal for agent', agent.name, err)
      return 'error'
    }
  }

  /**
   * Launch a review session for auditing done tasks.
   */
  async function launchReviewSession(agent: Agent, doneTasks: Task[]): Promise<boolean> {
    if (tabsStore.hasAgentTerminal(agent.name)) return false

    const dbPath = tasksStore.dbPath
    if (!dbPath) return false

    try {
      const instances = await getCachedClaudeInstances()
      if (instances.length === 0) return false

      const instance = instances.find(i => i.isDefault) ?? instances[0]

      const promptResult = await window.electronAPI.getAgentSystemPrompt(dbPath, agent.id)
      if (!promptResult.success) return false

      const taskList = doneTasks.map(t => `T${t.id} ${t.titre}`).join(', ')
      const userPrompt = `Audit les tâches terminées : ${taskList}. Valide ou rejette chacune.`
      const finalPrompt = await window.electronAPI.buildAgentPrompt(
        agent.name,
        userPrompt,
        dbPath,
        agent.id
      )

      const parts: string[] = []
      if (promptResult.systemPrompt) parts.push(promptResult.systemPrompt)
      if (promptResult.systemPromptSuffix) parts.push(promptResult.systemPromptSuffix)
      const fullSystemPrompt = parts.join('\n\n') || undefined

      const thinkingMode = (promptResult.thinkingMode as 'auto' | 'disabled') ?? 'auto'

      if (tabsStore.hasAgentTerminal(agent.name)) return false

      tabsStore.addTerminal(
        agent.name,
        instance.distro,
        finalPrompt,
        fullSystemPrompt,
        thinkingMode,
        undefined,
        undefined,
        false
      )

      return true
    } catch (err) {
      console.warn('[launchSession] Failed to launch review session', err)
      return false
    }
  }

  /**
   * Check whether a new session can be launched for the given agent.
   * Returns false if the agent has already reached its max_sessions limit.
   * Agents with max_sessions = -1 are unlimited.
   */
  function canLaunchSession(agent: Agent): boolean {
    const maxSess = agent.max_sessions ?? MAX_AGENT_SESSIONS
    if (maxSess === -1) return true
    return agentTerminalCount(agent.name) < maxSess
  }

  return { launchAgentTerminal, launchReviewSession, canLaunchSession }
}
