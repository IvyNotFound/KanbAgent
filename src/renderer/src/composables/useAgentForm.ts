import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentAccent } from '@renderer/utils/agentColor'
import { CLI_LABELS } from '@renderer/utils/cliCapabilities'
import type { Agent } from '@renderer/types'
import type { CliType } from '@shared/cli-types'
import type { CliModelDef } from '@shared/cli-models'

const SCOPED_TYPES = ['dev', 'test', 'ux']
export const ALL_AGENT_TYPES = ['dev', 'test', 'ux', 'review', 'review-master', 'arch', 'devops', 'doc', 'secu', 'perf', 'data', 'planner']
export const COMMON_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch', 'NotebookEdit']

interface AgentFormEmits {
  close(): void
  created(): void
  saved(): void
  toast(msg: string, type: 'success' | 'error'): void
}

/**
 * Encapsulates all reactive state, computed values, watchers, and async actions
 * for the CreateAgentModal form (both create and edit modes).
 */
export function useAgentForm(
  props: Readonly<{ mode?: 'create' | 'edit'; agent?: Agent }>,
  emits: AgentFormEmits,
) {
  const { t, te } = useI18n()
  const store = useTasksStore()
  const settingsStore = useSettingsStore()

  const isEditMode = computed(() => props.mode === 'edit' && props.agent != null)

  // ── Form fields ───────────────────────────────────────────────────────────────
  const name = ref('')
  const type = ref('dev')
  const perimetre = ref('')
  const systemPrompt = ref('')
  const systemPromptSuffix = ref('')
  const description = ref('')
  const permissionMode = ref<'default' | 'auto'>('default')
  const allToolsEnabled = ref(false)
  const allowedToolsList = ref<string[]>([])
  const autoLaunch = ref(true)
  const worktreeEnabled = ref<number | null>(props.agent?.worktree_enabled ?? null)
  // Empty string → -1 (unlimited) in DB
  const maxSessions = ref(props.agent?.max_sessions === -1 ? '' : String(props.agent?.max_sessions ?? 3))
  const preferredModel = ref('')
  const preferredCli = ref<string | null>(null)

  // ── Status ────────────────────────────────────────────────────────────────────
  const loading = ref(false)
  const deleting = ref(false)
  const deleteError = ref<string | null>(null)
  const nameError = ref('')

  // ── Computed ──────────────────────────────────────────────────────────────────
  const isScoped = computed(() => SCOPED_TYPES.includes(type.value))

  const maxSessionsInvalid = computed(() =>
    maxSessions.value !== '' && (!/^\d+$/.test(maxSessions.value) || parseInt(maxSessions.value) < 1)
  )
  const maxSessionsDbValue = computed(() =>
    maxSessions.value === '' ? -1 : parseInt(maxSessions.value)
  )

  const worktreeToggleValue = computed({
    get: () => worktreeEnabled.value === null ? 'inherit' : worktreeEnabled.value === 1 ? 'on' : 'off',
    set: (val: string) => {
      worktreeEnabled.value = val === 'inherit' ? null : val === 'on' ? 1 : 0
    },
  })

  const cliItems = computed(() => {
    const seen = new Set<string>()
    for (const inst of settingsStore.allCliInstances) {
      if (settingsStore.enabledClis.includes(inst.cli as CliType)) seen.add(inst.cli)
    }
    return Array.from(seen).map(cli => ({ title: CLI_LABELS[cli as CliType] ?? cli, value: cli }))
  })

  const effectiveCli = computed<CliType>(() =>
    (preferredCli.value as CliType) ?? settingsStore.primaryCli
  )

  const availableModels = computed(() => {
    const models: CliModelDef[] = settingsStore.cliModels[effectiveCli.value] ?? []
    return models.map(m => ({ title: m.label, value: m.modelId }))
  })

  const defaultModelLabel = computed(() => {
    const modelId = settingsStore.getDefaultModel(effectiveCli.value)
    if (!modelId) return null
    const models: CliModelDef[] = settingsStore.cliModels[effectiveCli.value] ?? []
    return models.find(m => m.modelId === modelId)?.label ?? modelId
  })

  const accentColor = computed(() =>
    isEditMode.value && props.agent ? agentAccent(props.agent.name) : undefined
  )

  const perimetreItems = computed(() =>
    store.perimetresData.map((p: { name: string }) => p.name)
  )

  // ── Watchers ──────────────────────────────────────────────────────────────────
  watch(type, () => {
    if (!isScoped.value) perimetre.value = ''
  })
  watch(name, () => { nameError.value = '' })

  const mounted = ref(false)
  watch(effectiveCli, () => {
    if (mounted.value) preferredModel.value = ''
  })

  function defaultDescription(agentType: string): string {
    const typeKey = agentType === 'review-master' ? 'reviewMaster' : agentType
    const key = `agent.typeDesc.${typeKey}`
    return te(key) ? t(key as never) : ''
  }

  watch(type, (newType) => {
    if (!isEditMode.value) {
      if (!description.value || description.value === defaultDescription(ALL_AGENT_TYPES.find(x => x !== newType) ?? '')) {
        description.value = defaultDescription(newType)
      }
    }
  }, { immediate: true })

  function onNameInput(value: string) {
    name.value = value.toLowerCase().replace(/ /g, '-')
  }

  // ── onMounted: load edit-mode data ────────────────────────────────────────────
  onMounted(async () => {
    if (settingsStore.allCliInstances.length === 0) {
      await settingsStore.refreshCliDetection()
    }
    if (Object.keys(settingsStore.cliModels).length === 0) {
      await settingsStore.loadCliModels()
    }

    if (isEditMode.value && props.agent) {
      const a = props.agent
      name.value = a.name
      type.value = ALL_AGENT_TYPES.includes(a.type) ? a.type : 'dev'
      perimetre.value = a.scope ?? ''
      maxSessions.value = a.max_sessions === -1 ? '' : String(a.max_sessions ?? 3)
      worktreeEnabled.value = a.worktree_enabled ?? null
      preferredModel.value = a.preferred_model ?? ''
      preferredCli.value = a.preferred_cli ?? null
      autoLaunch.value = a.auto_launch !== 0
      allToolsEnabled.value = !a.allowed_tools
      allowedToolsList.value = a.allowed_tools ? a.allowed_tools.split(',').map(s => s.trim()).filter(Boolean) : []
      permissionMode.value = a.permission_mode === 'auto' ? 'auto' : 'default'
      if (store.dbPath) {
        const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, a.id)
        if (result.success) {
          systemPrompt.value = result.systemPrompt ?? ''
          systemPromptSuffix.value = result.systemPromptSuffix ?? ''
          preferredModel.value = result.preferredModel ?? preferredModel.value
          preferredCli.value = result.preferredCli ?? preferredCli.value
          permissionMode.value = result.permissionMode === 'auto' ? 'auto' : 'default'
        }
      }
    }
    mounted.value = true
  })

  // ── Submit / Delete ───────────────────────────────────────────────────────────
  async function submit() {
    if (!store.dbPath) return

    const trimmed = name.value.trim()
    if (!trimmed) { nameError.value = t('agent.nameRequired'); return }
    if (!/^[a-z0-9-]+$/.test(trimmed)) { nameError.value = t('agent.nameFormat'); return }

    loading.value = true
    try {
      if (isEditMode.value && props.agent) {
        if (maxSessionsInvalid.value) return
        const result = await window.electronAPI.updateAgent(store.dbPath, props.agent.id, {
          name: trimmed,
          type: type.value,
          scope: isScoped.value && perimetre.value.trim() ? perimetre.value.trim() : null,
          thinkingMode: 'auto',
          systemPrompt: systemPrompt.value.trim() || null,
          systemPromptSuffix: systemPromptSuffix.value.trim() || null,
          maxSessions: maxSessionsDbValue.value,
          worktreeEnabled: worktreeEnabled.value === null ? null : worktreeEnabled.value === 1,
          preferredModel: preferredModel.value.trim() || null,
          preferredCli: preferredCli.value || null,
          allowedTools: allToolsEnabled.value ? null : (allowedToolsList.value.length > 0 ? allowedToolsList.value.join(',') : null),
          autoLaunch: autoLaunch.value,
          permissionMode: permissionMode.value,
        })
        if (!result.success) {
          emits.toast(result.error ?? t('agent.saveError'), 'error')
          return
        }
        emits.toast(t('agent.updated', { name: trimmed }), 'success')
        emits.saved()
        emits.close()
        return
      }

      if (!store.projectPath) return
      const result = await window.electronAPI.createAgent(store.dbPath, store.projectPath, {
        name: trimmed,
        type: type.value,
        scope: isScoped.value && perimetre.value.trim() ? perimetre.value.trim() : null,
        thinkingMode: 'auto',
        systemPrompt: systemPrompt.value.trim() || null,
        description: description.value.trim() || defaultDescription(type.value),
        preferredModel: preferredModel.value.trim() || null,
      })

      if (!result.success) {
        if (result.error?.includes('existe déjà')) nameError.value = result.error
        else emits.toast(result.error ?? t('agent.createError'), 'error')
        return
      }

      const hasExtras = (!allToolsEnabled.value && allowedToolsList.value.length > 0) || !autoLaunch.value || permissionMode.value !== 'default' || preferredCli.value
      if (hasExtras && result.agentId) {
        await window.electronAPI.updateAgent(store.dbPath, result.agentId, {
          allowedTools: allToolsEnabled.value ? null : (allowedToolsList.value.length > 0 ? allowedToolsList.value.join(',') : null),
          autoLaunch: autoLaunch.value,
          permissionMode: permissionMode.value,
          preferredCli: preferredCli.value || null,
        })
      }

      const msg = result.claudeMdUpdated
        ? t('agent.createdWithClaude', { name: trimmed })
        : t('agent.created', { name: trimmed })
      emits.toast(msg, 'success')
      emits.created()
      emits.close()
    } finally {
      loading.value = false
    }
  }

  async function deleteAgent() {
    if (!store.dbPath || !props.agent) return
    const confirmed = window.confirm(t('agent.deleteAgentConfirm', { name: props.agent.name }))
    if (!confirmed) return
    deleting.value = true
    deleteError.value = null
    try {
      const result = await window.electronAPI.deleteAgent(store.dbPath, props.agent.id)
      if (result.hasHistory) {
        deleteError.value = t('agent.deleteAgentHistoryError')
        return
      }
      if (!result.success) {
        deleteError.value = result.error ?? t('common.unknownError')
        return
      }
      await store.refresh()
      emits.close()
    } finally {
      deleting.value = false
    }
  }

  return {
    // Computed
    isEditMode, isScoped, maxSessionsInvalid, maxSessionsDbValue, worktreeToggleValue,
    cliItems, effectiveCli, availableModels, defaultModelLabel, accentColor, perimetreItems,
    // Form fields
    name, type, perimetre, systemPrompt, systemPromptSuffix, description,
    permissionMode, allToolsEnabled, allowedToolsList, autoLaunch,
    worktreeEnabled, maxSessions, preferredModel, preferredCli,
    // Status
    loading, deleting, deleteError, nameError,
    // Functions
    onNameInput, submit, deleteAgent,
    // Store refs needed in template
    store, settingsStore,
  }
}
