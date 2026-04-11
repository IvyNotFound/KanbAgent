import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore, parseDefaultCliInstance } from '@renderer/stores/settings'
import { CLI_CAPABILITIES } from '@renderer/utils/cliCapabilities'
import type { Agent } from '@renderer/types'
import type { CliType, CliInstance, CliCapabilities } from '@shared/cli-types'
import type { CliModelDef } from '@shared/cli-models'

/**
 * Handles all initialization logic for LaunchSessionModal:
 * instance auto-selection, system prompt loading, last conv ID retrieval,
 * CLI model caching, worktree default resolution, and related watchers.
 */
export function useLaunchModalInit(props: Readonly<{ agent: Agent }>) {
  const { t } = useI18n()
  const tasksStore = useTasksStore()
  const settingsStore = useSettingsStore()

  const selectedInstance = ref<CliInstance | null>(null)
  const loading = ref(true)
  const systemPrompt = ref<string | null>(null)
  const systemPromptSuffix = ref<string | null>(null)
  const thinkingMode = ref<'auto' | 'disabled'>('auto')
  const lastConvId = ref<string | null>(null)
  const useResume = ref(false)
  const multiInstance = ref(true)
  const worktreeSource = ref<'global' | 'agent' | 'manual'>('global')
  const worktreeError = ref<string | null>(null)
  const selectedModel = ref<string | null>(null)

  const selectedCli = computed<CliType>(() =>
    selectedInstance.value?.cli ?? settingsStore.primaryCli
  )

  const caps = computed<CliCapabilities>(() => CLI_CAPABILITIES[selectedCli.value])

  const allAvailableInstances = computed(() =>
    settingsStore.allCliInstances.filter(i => settingsStore.enabledClis.includes(i.cli as CliType))
  )

  const noInstanceText = computed(() => {
    const p = window.electronAPI.platform
    if (p === 'darwin') return t('launch.noInstanceMac')
    if (p === 'linux') return t('launch.noInstanceLinux')
    return t('launch.noInstanceWin')
  })

  const availableModels = computed(() => {
    const models: CliModelDef[] = settingsStore.cliModels[selectedCli.value] ?? []
    return models.map(m => ({ title: m.label, value: m.modelId }))
  })

  const defaultModelLabel = computed(() => {
    const modelId = settingsStore.getDefaultModel(selectedCli.value)
    if (!modelId) return null
    const models: CliModelDef[] = settingsStore.cliModels[selectedCli.value] ?? []
    return models.find(m => m.modelId === modelId)?.label ?? modelId
  })

  const fullSystemPrompt = computed(() => {
    const parts: string[] = []
    if (systemPrompt.value) parts.push(systemPrompt.value)
    if (systemPromptSuffix.value) parts.push(systemPromptSuffix.value)
    if (settingsStore.maxFileLinesEnabled) {
      parts.push(`Always produce and maintain files of maximum ${settingsStore.maxFileLinesCount} lines. Split files that exceed this limit into logical modules.`)
    }
    return parts.join('\n\n')
  })

  // Track manual override of worktree toggle (T1143)
  watch(multiInstance, () => {
    if (!loading.value) worktreeSource.value = 'manual'
  })

  // Reset model selection when CLI changes — models are CLI-specific (T1805)
  watch(selectedCli, () => {
    if (!loading.value) selectedModel.value = null
  })

  onMounted(async () => {
    try {
      if (settingsStore.allCliInstances.length === 0) {
        await settingsStore.refreshCliDetection()
      }

      const instances = allAvailableInstances.value
      if (instances.length > 0) {
        let picked: CliInstance | null = null

        // 1. Agent preferred CLI
        if (props.agent.preferred_cli) {
          const cliInstances = instances.filter(i => i.cli === props.agent.preferred_cli)
          if (cliInstances.length > 0) {
            picked = cliInstances.find(i => i.isDefault) ?? cliInstances[0]
          }
        }

        // 2. Global stored preference
        if (!picked) {
          const stored = settingsStore.defaultCliInstance
          const parsed = parseDefaultCliInstance(stored)
          picked =
            (stored
              ? instances.find(i =>
                  i.distro === parsed.distro &&
                  (parsed.cli === null || i.cli === parsed.cli)
                )
              : undefined)
            ?? instances.find(i => i.isDefault)
            ?? instances[0]
            ?? null
        }

        selectedInstance.value = picked
      }

      if (tasksStore.dbPath) {
        const [promptResult, sessionRows] = await Promise.all([
          window.electronAPI.getAgentSystemPrompt(tasksStore.dbPath, props.agent.id),
          window.electronAPI.queryDb(
            tasksStore.dbPath,
            `SELECT conv_id FROM sessions
             WHERE agent_id = ? AND conv_id IS NOT NULL
             ORDER BY id DESC LIMIT 1`,
            [props.agent.id]
          ) as Promise<Array<{ conv_id: string }>>
        ])
        if (promptResult.success) {
          systemPrompt.value = promptResult.systemPrompt
          systemPromptSuffix.value = promptResult.systemPromptSuffix
          thinkingMode.value = (promptResult.thinkingMode as 'auto' | 'disabled') ?? 'auto'
        }
        if (sessionRows.length > 0 && sessionRows[0].conv_id) {
          lastConvId.value = sessionRows[0].conv_id
          useResume.value = false
        }
      }

      if (Object.keys(settingsStore.cliModels).length === 0) {
        await settingsStore.loadCliModels()
      }

      selectedModel.value = props.agent.preferred_model ?? null

      const agentWorktree = props.agent.worktree_enabled
      if (agentWorktree !== null && agentWorktree !== undefined) {
        multiInstance.value = agentWorktree === 1
        worktreeSource.value = 'agent'
      } else {
        multiInstance.value = settingsStore.worktreeDefault
        worktreeSource.value = 'global'
      }
    } catch (err) {
      console.error('[LaunchSessionModal] init failed:', err)
    } finally {
      loading.value = false
    }
  })

  return {
    selectedInstance, loading, systemPrompt, systemPromptSuffix, thinkingMode,
    lastConvId, useResume, multiInstance, worktreeSource, worktreeError,
    selectedModel, selectedCli, caps, allAvailableInstances, noInstanceText,
    availableModels, defaultModelLabel, fullSystemPrompt,
  }
}
