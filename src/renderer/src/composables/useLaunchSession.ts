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
import { useSettingsStore } from '@renderer/stores/settings'
import type { Task, Agent } from '@renderer/types'

export const MAX_AGENT_SESSIONS = 3

import type { CliInstance } from '@shared/cli-types'

const CACHE_TTL_MS = 5 * 60 * 1000
let cachedInstances: CliInstance[] | null = null
let cacheTimestamp = 0

async function getCachedCliInstances(): Promise<CliInstance[]> {
  const now = Date.now()
  if (cachedInstances && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedInstances
  }
  const result = await window.electronAPI.getCliInstances() as CliInstance[]
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
      const allInstances = await getCachedCliInstances()

      const settingsStore = useSettingsStore()
      const storedDistro = settingsStore.defaultCliInstance

      // Find first enabled CLI that has detected instances, fall back to enabledClis[0]
      let defaultCli = settingsStore.enabledClis[0] ?? 'claude'
      let cliInstances = allInstances.filter(i => i.cli === defaultCli)
      if (cliInstances.length === 0) {
        for (const cli of settingsStore.enabledClis.slice(1)) {
          const candidates = allInstances.filter(i => i.cli === cli)
          if (candidates.length > 0) { defaultCli = cli; cliInstances = candidates; break }
        }
      }

      const instance = cliInstances.length > 0
        ? ((storedDistro ? cliInstances.find(i => i.distro === storedDistro) : undefined)
            ?? cliInstances.find(i => i.isDefault)
            ?? cliInstances[0])
        : null

      const promptResult = await window.electronAPI.getAgentSystemPrompt(dbPath, agent.id)
      if (!promptResult.success) return 'error'

      const userPrompt = `T${task.id}`
      const finalPrompt = await window.electronAPI.buildAgentPrompt(
        agent.name,
        userPrompt,
        dbPath,
        agent.id
      )

      const parts: string[] = []
      if (promptResult.systemPrompt) parts.push(promptResult.systemPrompt)
      if (promptResult.systemPromptSuffix) parts.push(promptResult.systemPromptSuffix)
      if (settingsStore.maxFileLinesEnabled) {
        parts.push(`Always produce and maintain files of maximum ${settingsStore.maxFileLinesCount} lines. Split files that exceed this limit into logical modules.`)
      }
      const fullSystemPrompt = parts.join('\n\n') || undefined

      const thinkingMode = (promptResult.thinkingMode as 'auto' | 'disabled') ?? 'auto'

      tabsStore.addTerminal(
        agent.name,
        instance?.distro,
        finalPrompt,
        fullSystemPrompt,
        thinkingMode,
        undefined,
        undefined,
        false,
        task.id,
        'stream',
        defaultCli
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
      const allInstances = await getCachedCliInstances()

      const settingsStore = useSettingsStore()
      const storedDistro = settingsStore.defaultCliInstance

      // Find first enabled CLI that has detected instances, fall back to enabledClis[0]
      let defaultCli = settingsStore.enabledClis[0] ?? 'claude'
      let cliInstances = allInstances.filter(i => i.cli === defaultCli)
      if (cliInstances.length === 0) {
        for (const cli of settingsStore.enabledClis.slice(1)) {
          const candidates = allInstances.filter(i => i.cli === cli)
          if (candidates.length > 0) { defaultCli = cli; cliInstances = candidates; break }
        }
      }

      const instance = cliInstances.length > 0
        ? ((storedDistro ? cliInstances.find(i => i.distro === storedDistro) : undefined)
            ?? cliInstances.find(i => i.isDefault)
            ?? cliInstances[0])
        : null

      const promptResult = await window.electronAPI.getAgentSystemPrompt(dbPath, agent.id)
      if (!promptResult.success) return false

      const taskList = doneTasks.map(t => `T${t.id} ${t.title}`).join(', ')
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
      if (settingsStore.maxFileLinesEnabled) {
        parts.push(`Always produce and maintain files of maximum ${settingsStore.maxFileLinesCount} lines. Split files that exceed this limit into logical modules.`)
      }
      const fullSystemPrompt = parts.join('\n\n') || undefined

      const thinkingMode = (promptResult.thinkingMode as 'auto' | 'disabled') ?? 'auto'

      if (tabsStore.hasAgentTerminal(agent.name)) return false

      tabsStore.addTerminal(
        agent.name,
        instance?.distro,
        finalPrompt,
        fullSystemPrompt,
        thinkingMode,
        undefined,
        undefined,
        false,
        undefined,
        'stream',
        defaultCli
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
