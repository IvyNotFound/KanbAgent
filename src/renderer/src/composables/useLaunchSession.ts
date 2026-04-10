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
import { useSettingsStore, parseDefaultCliInstance } from '@renderer/stores/settings'
import type { Task, Agent } from '@renderer/types'

export const MAX_AGENT_SESSIONS = 3

import type { CliType, CliInstance } from '@shared/cli-types'

/** Options to override defaults when launching from the modal (T1152). */
export interface LaunchOptions {
  /** Custom user prompt text (replaces default "T{taskId}") */
  customPrompt?: string
  /** Force a specific CLI instance (distro + cli) instead of auto-detection */
  instance?: CliInstance | null
  /** Force a specific CLI type */
  cli?: CliType
  /** Conversation ID for --resume */
  convId?: string
  /** Working directory (e.g. worktree path) */
  workDir?: string
  /** Override thinking mode */
  thinkingMode?: 'auto' | 'disabled'
  /** Override system prompt (false = skip system prompt entirely) */
  systemPrompt?: string | false
  /** Whether to activate the new tab (default: false for drag-drop, true for modal) */
  activate?: boolean
  /** Task ID to associate (default: task.id when task is provided) */
  taskId?: number
  /** Model ID to pass via --model flag (e.g. 'sonnet', 'opus') — T1805 */
  modelId?: string
}

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
   * Launch a terminal session for an agent, optionally on a specific task.
   * Returns 'ok' on success, 'session-limit' if max sessions reached, 'error' otherwise.
   *
   * The `opts` parameter allows callers (e.g. LaunchSessionModal) to override
   * defaults for CLI instance, prompt, resume, worktree, etc. (T1152)
   */
  async function launchAgentTerminal(agent: Agent, task?: Task, opts?: LaunchOptions): Promise<'ok' | 'session-limit' | 'error'> {
    const dbPath = tasksStore.dbPath
    if (!dbPath) return 'error'

    const maxSess = agent.max_sessions ?? MAX_AGENT_SESSIONS
    if (maxSess !== -1 && agentTerminalCount(agent.name) >= maxSess) {
      return 'session-limit'
    }

    try {
      const settingsStore = useSettingsStore()

      // --- CLI instance resolution ---
      let resolvedInstance: CliInstance | null
      let resolvedCli: CliType

      if (opts?.instance !== undefined) {
        // Caller provided an explicit instance (modal)
        resolvedInstance = opts.instance
        resolvedCli = opts.cli ?? resolvedInstance?.cli as CliType ?? settingsStore.primaryCli
      } else {
        // Auto-detect (drag-drop / relaunch path)
        const allInstances = await getCachedCliInstances()

        // Agent preferred CLI > first enabled CLI (T1804)
        let defaultCli = (agent.preferred_cli as CliType) ?? settingsStore.primaryCli
        let cliInstances = allInstances.filter(i => i.cli === defaultCli)
        if (cliInstances.length === 0) {
          // Preferred CLI not installed — fallback to enabled CLIs
          for (const cli of settingsStore.enabledClis) {
            if (cli === defaultCli) continue
            const candidates = allInstances.filter(i => i.cli === cli)
            if (candidates.length > 0) { defaultCli = cli; cliInstances = candidates; break }
          }
        }

        const storedDistro = settingsStore.defaultCliInstance
        const parsedDefault = parseDefaultCliInstance(storedDistro)

        resolvedInstance = cliInstances.length > 0
          ? ((storedDistro
                ? cliInstances.find(i =>
                    i.distro === parsedDefault.distro &&
                    (parsedDefault.cli === null || i.cli === parsedDefault.cli)
                  )
                : undefined)
              ?? cliInstances.find(i => i.isDefault)
              ?? cliInstances[0])
          : null
        resolvedCli = defaultCli as CliType
      }

      // --- System prompt resolution ---
      let fullSystemPrompt: string | undefined
      let resolvedThinking: string | undefined

      if (opts?.systemPrompt === false) {
        // Caller explicitly skipped system prompt (resume mode)
        fullSystemPrompt = undefined
        resolvedThinking = opts.thinkingMode
      } else if (opts?.systemPrompt !== undefined) {
        // Caller provided a pre-built system prompt (modal)
        fullSystemPrompt = opts.systemPrompt || undefined
        resolvedThinking = opts.thinkingMode
      } else {
        // Auto-build from DB (drag-drop / relaunch path)
        const promptResult = await window.electronAPI.getAgentSystemPrompt(dbPath, agent.id)
        if (!promptResult.success) return 'error'

        const parts: string[] = []
        if (promptResult.systemPrompt) parts.push(promptResult.systemPrompt)
        if (promptResult.systemPromptSuffix) parts.push(promptResult.systemPromptSuffix)
        if (settingsStore.maxFileLinesEnabled) {
          parts.push(`Always produce and maintain files of maximum ${settingsStore.maxFileLinesCount} lines. Split files that exceed this limit into logical modules.`)
        }
        fullSystemPrompt = parts.join('\n\n') || undefined
        resolvedThinking = (promptResult.thinkingMode as string) ?? 'auto'
      }

      // --- Prompt resolution ---
      let finalPrompt: string | undefined
      if (opts?.convId) {
        // Resume mode: no prompt
        finalPrompt = undefined
      } else {
        const userPrompt = opts?.customPrompt ?? (task ? `T${task.id}` : '')
        finalPrompt = await window.electronAPI.buildAgentPrompt(
          agent.name,
          userPrompt,
          dbPath,
          agent.id
        )
      }

      const resolvedTaskId = opts?.taskId ?? task?.id
      const activate = opts?.activate ?? false

      // Worktree cascade resolution — applies to drag-drop and relaunch paths (T1240)
      // When opts explicitly includes 'workDir' (even as undefined), the caller manages worktree.
      // Otherwise, resolve via agent setting → global default cascade.
      let resolvedWorkDir: string | undefined = opts?.workDir
      const workDirExplicit = opts !== undefined && 'workDir' in opts
      if (!workDirExplicit) {
        const agentWorktree = agent.worktree_enabled
        const useWorktree = agentWorktree !== null && agentWorktree !== undefined
          ? agentWorktree === 1
          : settingsStore.worktreeDefault

        if (useWorktree && tasksStore.projectPath) {
          const sessionNonce = Date.now().toString()
          const result = await window.electronAPI.worktreeCreate(
            tasksStore.projectPath,
            sessionNonce,
            agent.name
          )
          if (result.success) {
            resolvedWorkDir = result.workDir
          }
          // Non-fatal: if worktree creation fails, fall back to project root
        }
      }

      // Model resolution: explicit opts > agent preferred_model > backend default
      const resolvedModelId = opts?.modelId ?? agent.preferred_model ?? undefined

      tabsStore.addTerminal(
        agent.name,
        resolvedInstance?.distro,
        finalPrompt,
        fullSystemPrompt,
        resolvedThinking,
        undefined,
        opts?.convId,
        activate,
        resolvedTaskId,
        'stream',
        resolvedCli,
        resolvedWorkDir,
        resolvedModelId
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
      const parsedDefault = parseDefaultCliInstance(storedDistro)

      // Find first enabled CLI that has detected instances, fall back to enabledClis[0]
      let defaultCli = settingsStore.primaryCli
      let cliInstances = allInstances.filter(i => i.cli === defaultCli)
      if (cliInstances.length === 0) {
        for (const cli of settingsStore.enabledClis.slice(1)) {
          const candidates = allInstances.filter(i => i.cli === cli)
          if (candidates.length > 0) { defaultCli = cli; cliInstances = candidates; break }
        }
      }

      const instance = cliInstances.length > 0
        ? ((storedDistro
              ? cliInstances.find(i =>
                  i.distro === parsedDefault.distro &&
                  (parsedDefault.cli === null || i.cli === parsedDefault.cli)
                )
              : undefined)
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
