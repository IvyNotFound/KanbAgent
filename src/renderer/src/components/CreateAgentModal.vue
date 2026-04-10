<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentAccent, agentBg, agentFg } from '@renderer/utils/agentColor'
import { CLI_LABELS } from '@renderer/utils/cliCapabilities'
import type { Agent } from '@renderer/types'
import type { CliType } from '@shared/cli-types'
import type { CliModelDef } from '@shared/cli-models'

const props = defineProps<{
  mode?: 'create' | 'edit'
  agent?: Agent
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created'): void
  (e: 'saved'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

const { t, te } = useI18n()
const isEditMode = computed(() => props.mode === 'edit' && props.agent != null)

const store = useTasksStore()
const settingsStore = useSettingsStore()

const SCOPED_TYPES = ['dev', 'test', 'ux']
const ALL_TYPES = ['dev', 'test', 'ux', 'review', 'review-master', 'arch', 'devops', 'doc', 'secu', 'perf', 'data', 'planner']

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

const COMMON_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch', 'NotebookEdit']
const worktreeEnabled = ref<number | null>(props.agent?.worktree_enabled ?? null)
// String to allow empty value (empty → -1 = unlimited in DB)
const maxSessions = ref(props.agent?.max_sessions === -1 ? '' : String(props.agent?.max_sessions ?? 3))
const maxSessionsInvalid = computed(() => maxSessions.value !== '' && (!/^\d+$/.test(maxSessions.value) || parseInt(maxSessions.value) < 1))
const maxSessionsDbValue = computed(() => maxSessions.value === '' ? -1 : parseInt(maxSessions.value))
// Model identifier passed as --model to OpenCode (e.g. 'anthropic/claude-opus-4-5'). Trimmed on submit; empty string stored as null in DB.
const preferredModel = ref('')
const preferredCli = ref<string | null>(null)
const showPrompt = ref(false)
const promptSectionEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const nameError = ref('')

const isScoped = computed(() => SCOPED_TYPES.includes(type.value))

/** CLI types available for selection — derived from enabled CLIs that have detected instances */
const cliItems = computed(() => {
  const seen = new Set<string>()
  for (const inst of settingsStore.allCliInstances) {
    if (settingsStore.enabledClis.includes(inst.cli as CliType)) seen.add(inst.cli)
  }
  return Array.from(seen).map(cli => ({ title: CLI_LABELS[cli as CliType] ?? cli, value: cli }))
})

/** Effective CLI for model lookup: preferredCli or first enabled CLI */
const effectiveCli = computed<CliType>(() =>
  (preferredCli.value as CliType) ?? settingsStore.primaryCli
)

/** Available models for the effective CLI */
const availableModels = computed(() => {
  const models: CliModelDef[] = settingsStore.cliModels[effectiveCli.value] ?? []
  return models.map(m => ({ title: m.label, value: m.modelId }))
})

/** Human-readable label for the default model configured in settings */
const defaultModelLabel = computed(() => {
  const modelId = settingsStore.getDefaultModel(effectiveCli.value)
  if (!modelId) return null
  const models: CliModelDef[] = settingsStore.cliModels[effectiveCli.value] ?? []
  return models.find(m => m.modelId === modelId)?.label ?? modelId
})

// Worktree toggle bridge: v-btn-toggle needs primitive string values
const worktreeToggleValue = computed({
  get: () => worktreeEnabled.value === null ? 'inherit' : worktreeEnabled.value === 1 ? 'on' : 'off',
  set: (val: string) => {
    worktreeEnabled.value = val === 'inherit' ? null : val === 'on' ? 1 : 0
  },
})

watch(type, () => {
  if (!isScoped.value) perimetre.value = ''
})

watch(name, () => { nameError.value = '' })

// Reset model selection when CLI changes — models are CLI-specific (skip during mount)
const mounted = ref(false)
watch(effectiveCli, () => {
  if (mounted.value) preferredModel.value = ''
})

/**
 * Normalizes the agent name on each keystroke: lowercase + spaces→hyphens.
 * Enforces the kebab-case convention used throughout the project (e.g. dev-front-vuejs).
 * Uses :model-value + @update:model-value instead of v-model to apply normalization before Vue sets the ref.
 */
function onNameInput(value: string) {
  name.value = value.toLowerCase().replace(/ /g, '-')
}

function defaultDescription(agentType: string): string {
  const typeKey = agentType === 'review-master' ? 'reviewMaster' : agentType
  const key = `agent.typeDesc.${typeKey}`
  return te(key) ? t(key as never) : ''
}

watch(type, (newType) => {
  if (!isEditMode.value) {
    if (!description.value || description.value === defaultDescription(ALL_TYPES.find(x => x !== newType) ?? '')) {
      description.value = defaultDescription(newType)
    }
  }
}, { immediate: true })

onMounted(async () => {
  // Ensure CLI instances are detected (same pattern as LaunchSessionModal)
  if (settingsStore.allCliInstances.length === 0) {
    await settingsStore.refreshCliDetection()
  }
  // Load CLI models if not already cached
  if (Object.keys(settingsStore.cliModels).length === 0) {
    await settingsStore.loadCliModels()
  }

  if (isEditMode.value && props.agent) {
    const a = props.agent
    name.value = a.name
    type.value = ALL_TYPES.includes(a.type) ? a.type : 'dev'
    perimetre.value = a.scope ?? ''
    maxSessions.value = a.max_sessions === -1 ? '' : String(a.max_sessions ?? 3)
    worktreeEnabled.value = a.worktree_enabled ?? null
    preferredModel.value = a.preferred_model ?? ''
    preferredCli.value = a.preferred_cli ?? null
    autoLaunch.value = a.auto_launch !== 0
    allToolsEnabled.value = !a.allowed_tools
    allowedToolsList.value = a.allowed_tools ? a.allowed_tools.split(',').map(s => s.trim()).filter(Boolean) : []
    permissionMode.value = a.permission_mode === 'auto' ? 'auto' : 'default'
    // Load system_prompt and system_prompt_suffix from DB (may be more up-to-date than agent prop)
    if (store.dbPath) {
      const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, a.id)
      if (result.success) {
        systemPrompt.value = result.systemPrompt ?? ''
        systemPromptSuffix.value = result.systemPromptSuffix ?? ''
        preferredModel.value = result.preferredModel ?? preferredModel.value
        preferredCli.value = result.preferredCli ?? preferredCli.value
        permissionMode.value = result.permissionMode === 'auto' ? 'auto' : 'default'
        // showPrompt stays false — always collapsed on open, even if content exists
      }
    }
  }
  mounted.value = true
})

async function submit() {
  if (!store.dbPath) return

  const trimmed = name.value.trim()
  if (!trimmed) { nameError.value = t('agent.nameRequired'); return }
  if (!/^[a-z0-9-]+$/.test(trimmed)) { nameError.value = t('agent.nameFormat'); return }

  loading.value = true
  try {
    // ── Edit mode ──────────────────────────────────────────────────────────
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
        emit('toast', result.error ?? t('agent.saveError'), 'error')
        return
      }
      emit('toast', t('agent.updated', { name: trimmed }), 'success')
      emit('saved')
      emit('close')
      return
    }

    // ── Create mode ────────────────────────────────────────────────────────
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
      else emit('toast', result.error ?? t('agent.createError'), 'error')
      return
    }

    // Apply extra fields not supported by createAgent IPC (allowedTools, autoLaunch, permissionMode, preferredCli)
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
    emit('toast', msg, 'success')
    emit('created')
    emit('close')
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
    emit('close')
  } finally {
    deleting.value = false
  }
}

function togglePrompt() {
  showPrompt.value = !showPrompt.value
  if (showPrompt.value) {
    nextTick(() => {
      promptSectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
}
</script>

<template>
  <v-dialog model-value max-width="750" scrollable @update:model-value="emit('close')">
    <div data-testid="create-agent-backdrop" @click.self="emit('close')">
    <v-card class="d-flex flex-column" style="max-height: 85vh;" @keydown="handleKeydown">
        <!-- Header -->
        <div class="modal-header">
          <template v-if="isEditMode && agent">
            <div class="d-flex align-center ga-3">
              <div class="agent-avatar" :style="{ background: agentBg(agent.name), color: agentFg(agent.name) }">
                {{ agent.name.slice(0, 1).toUpperCase() }}
              </div>
              <div>
                <p class="text-caption" style="color: var(--content-muted); line-height: 1.2;">{{ t('agent.editTitle') }}</p>
                <h2 class="text-subtitle-1 font-weight-medium" style="color: var(--content-primary); line-height: 1.3;">{{ agent.name }}</h2>
              </div>
            </div>
          </template>
          <template v-else>
            <h2 class="text-body-1 font-weight-medium" style="color: var(--content-primary)">{{ t('agent.newTitle') }}</h2>
          </template>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            data-testid="btn-close"
            :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            @click="emit('close')"
          />
        </div>

        <!-- Form -->
        <div class="modal-body">
          <!-- Nom -->
          <v-text-field
            :model-value="name"
            autofocus
            placeholder="dev-back-api"
            :label="`${t('sidebar.name')} *`"
            :error-messages="nameError"
            :hint="t('agent.nameFormatShort')"
            persistent-hint
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            @update:model-value="onNameInput"
          />

          <!-- Type -->
          <v-select
            v-model="type"
            :items="ALL_TYPES"
            :label="t('agent.type')"
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            hide-details
          />

          <!-- Périmètre (scoped only) -->
          <v-combobox
            v-if="isScoped"
            v-model="perimetre"
            :items="store.perimetresData.map(p => p.name)"
            :label="t('agent.perimeter')"
            placeholder="front-vuejs"
            variant="outlined"
            density="compact"
            :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            hide-details
          />

          <!-- Description (pour CLAUDE.md) — create mode uniquement -->
          <v-text-field
            v-if="!isEditMode"
            v-model="description"
            :label="`${t('sidebar.description')} (CLAUDE.md)`"
            variant="outlined"
          />

          <!-- Instance CLI préférée -->
          <v-select
            v-model="preferredCli"
            :items="cliItems"
            :label="t('launch.instance')"
            :placeholder="t('agent.globalDefault')"
            :hint="t('agent.preferredCliNote')"
            persistent-hint
            clearable
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
          />

          <!-- Modèle préféré — v-select dynamique ou fallback texte libre -->
          <v-select
            v-if="availableModels.length > 0"
            v-model="preferredModel"
            :items="availableModels"
            :label="t('launch.model')"
            clearable
            :placeholder="defaultModelLabel ? t('agent.settingsDefaultNamed', { model: defaultModelLabel }) : t('agent.settingsDefault')"
            :hint="t('agent.preferredModelNote')"
            persistent-hint
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
          />
          <v-text-field
            v-else
            v-model="preferredModel"
            :label="t('launch.model')"
            placeholder="anthropic/claude-opus-4-5"
            :hint="t('agent.preferredModelNote')"
            persistent-hint
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
          />

          <!-- Mode permissions -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('agent.permissionMode') }}</div>
            <v-btn-toggle v-model="permissionMode" mandatory :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'" :style="isEditMode && agent ? { '--toggle-accent': agentAccent(agent.name) } : undefined" variant="outlined" density="compact" rounded="lg" class="w-100 agent-toggle">
              <v-btn value="default" size="small" class="flex-1">{{ t('agent.permissionModeDefault') }}</v-btn>
              <v-btn value="auto" size="small" class="flex-1">{{ t('agent.permissionModeAuto') }}</v-btn>
            </v-btn-toggle>
            <p v-if="permissionMode === 'auto'" class="text-caption text-error mt-1">
              <v-icon size="small" color="error">mdi-alert</v-icon> {{ t('agent.permissionModeWarning') }}
            </p>
          </div>

          <!-- Outils autorisés (--allowedTools) -->
          <div>
            <v-switch
              v-model="allToolsEnabled"
              :label="t('agent.allTools')"
              hide-details
              density="compact"
              :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
              :style="isEditMode && agent ? { '--switch-accent': agentAccent(agent.name) } : undefined"
              class="agent-switch"
              inset
            />
            <p class="field-hint mt-1 text-caption">{{ t('agent.allToolsHint') }}</p>
            <v-combobox
              v-model="allowedToolsList"
              :items="COMMON_TOOLS"
              :label="t('agent.allowedTools')"
              :disabled="allToolsEnabled"
              multiple
              chips
              closable-chips
              :hint="t('agent.allowedToolsNote')"
              persistent-hint
              variant="outlined"
              density="compact"
              class="mt-2"
              :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
              :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            />
            <p v-if="permissionMode === 'auto'" class="text-caption text-warning mt-1">
              <v-icon size="small" color="warning">mdi-information</v-icon> {{ t('agent.permissionAutoToolsHint') }}
            </p>
          </div>

          <!-- Fermeture auto (auto_launch) -->
          <v-switch
            v-model="autoLaunch"
            :label="t('agent.autoLaunch')"
            hide-details
            :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
            :style="isEditMode && agent ? { '--switch-accent': agentAccent(agent.name) } : undefined"
            class="agent-switch"
            density="compact"
            inset
          />
          <p class="field-hint mt-1 text-caption">{{ t('agent.autoLaunchDesc') }}</p>

          <!-- Sessions parallèles max (edit mode uniquement) -->
          <v-text-field
            v-if="isEditMode"
            v-model="maxSessions"
            :label="t('agent.maxSessions')"
            :placeholder="t('agent.maxSessionsUnlimited')"
            inputmode="numeric"
            :error-messages="maxSessionsInvalid ? t('agent.maxSessionsError') : ''"
            :hint="t('agent.maxSessionsNote')"
            persistent-hint
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
          />

          <!-- Worktree isolation (edit mode uniquement) -->
          <div v-if="isEditMode">
            <div class="field-label text-label-medium mb-2">{{ t('agent.worktreeEnabled') }}</div>
            <v-btn-toggle v-model="worktreeToggleValue" mandatory :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'" :style="isEditMode && agent ? { '--toggle-accent': agentAccent(agent.name) } : undefined" variant="outlined" density="compact" rounded="lg" class="w-100 agent-toggle">
              <v-btn value="inherit" size="small" class="flex-1">{{ t('agent.worktreeInherit') }}</v-btn>
              <v-btn value="on" size="small" class="flex-1">{{ t('agent.worktreeOn') }}</v-btn>
              <v-btn value="off" size="small" class="flex-1">{{ t('agent.worktreeOff') }}</v-btn>
            </v-btn-toggle>
            <p v-if="worktreeEnabled === null" class="text-caption text-medium-emphasis mt-1">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="text-caption text-disabled mt-1">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- System prompt (optionnel, collapsible) -->
          <div ref="promptSectionEl" class="prompt-section">
            <div
              class="prompt-header"
              role="button"
              tabindex="0"
              @click="togglePrompt"
              @keydown.enter="togglePrompt"
              @keydown.space.prevent="togglePrompt"
            >
              <div class="d-flex align-center ga-2 flex-1 min-width-0">
                <v-icon :class="['prompt-arrow', showPrompt ? 'prompt-arrow--open' : '']" size="15">mdi-chevron-right</v-icon>
                <span class="prompt-title">System prompt</span>
                <span v-if="!isEditMode" class="prompt-optional">{{ t('agent.systemPromptOptional') }}</span>
              </div>
              <v-chip
                v-if="systemPrompt || systemPromptSuffix"
                size="x-small"
                variant="tonal"
                class="ml-auto flex-shrink-0"
              >
                {{ systemPrompt.length + systemPromptSuffix.length }} chars
              </v-chip>
            </div>
            <div v-if="!showPrompt && (systemPrompt || systemPromptSuffix)" class="prompt-preview-line">
              {{ (systemPrompt || systemPromptSuffix).slice(0, 100).trim() }}{{ (systemPrompt || systemPromptSuffix).length > 100 ? '…' : '' }}
            </div>
            <div v-if="showPrompt" class="prompt-expanded-body">
              <v-textarea
                v-model="systemPrompt"
                rows="8"
                spellcheck="true"
                :placeholder="t('agent.systemPromptPlaceholder')"
                hide-details
                variant="outlined"
                :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
                :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
              />
              <div v-if="isEditMode">
                <div class="field-label-subtle text-label-medium mb-1">
                  {{ t('agent.hiddenSuffix') }}
                  <span class="field-label-note">({{ t('agent.hiddenSuffixCode') }})</span>
                </div>
                <v-textarea
                  v-model="systemPromptSuffix"
                  rows="6"
                  spellcheck="true"
                  :placeholder="t('agent.systemPromptSuffixPlaceholder')"
                  hide-details
                  variant="outlined"
                  :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
                  :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <p v-if="deleteError" class="text-caption text-error">{{ deleteError }}</p>
          <div class="d-flex align-center justify-space-between">
            <!-- Left: destructive action isolated from primary actions -->
            <div>
              <v-btn
                v-if="isEditMode"
                color="error"
                variant="outlined"
                :disabled="deleting || loading"
                @click="deleteAgent"
              >
                {{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}
              </v-btn>
            </div>
            <!-- Right: primary actions + shortcut hint near the submit button -->
            <div class="d-flex align-center ga-3">
              <span class="text-caption text-disabled">{{ isEditMode ? t('agent.saveShortcut') : t('agent.createShortcut') }}</span>
              <v-btn variant="text" :color="isEditMode && agent ? agentAccent(agent.name) : undefined" @click="emit('close')">{{ t('common.cancel') }}</v-btn>
              <v-btn
                :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'"
                data-testid="btn-submit"
                :disabled="loading || !name.trim() || (isEditMode && maxSessionsInvalid)"
                @click="submit"
              >
                {{ loading ? (isEditMode ? t('common.saving') : t('agent.creating')) : (isEditMode ? t('common.save') : t('agent.create')) }}
              </v-btn>
            </div>
          </div>
        </div>
    </v-card>
    </div>
  </v-dialog>
</template>

<style scoped>
/* Card layout */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.modal-body {
  flex: 1;
  min-height: 0; /* allow flex item to shrink below content height so overflow-y: auto works */
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--edge-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

/* Labels for toggle sections */
.field-label {
  font-size: 12px;
  color: var(--content-muted);
}
.field-label-subtle {
  font-size: 12px;
  color: var(--content-subtle);
}
.field-label-note {
  color: var(--content-faint);
  margin-left: 4px;
}

/* Input text color — force on-surface to override Vuetify :color tint in dark mode (T1684) */
.modal-body :deep(.v-field__input) {
  color: rgb(var(--v-theme-on-surface)) !important;
}

/* System prompt section */
.prompt-section {
  border: 1px solid var(--edge-subtle);
  border-radius: 8px;
  overflow: clip;
}
.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  background: rgba(var(--v-theme-surface-variant), 0.25);
  gap: 8px;
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.prompt-header:hover {
  background: rgba(var(--v-theme-surface-variant), 0.45);
}
.prompt-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--content-secondary);
}
.prompt-optional {
  font-size: 11px;
  color: var(--content-muted);
}
.prompt-preview-line {
  padding: 4px 14px 8px 36px;
  font-size: 11px;
  color: var(--content-muted);
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(var(--v-theme-surface-variant), 0.1);
}
.prompt-arrow {
  color: var(--content-muted);
  flex-shrink: 0;
  transition: transform var(--md-duration-short3) var(--md-easing-standard);
}
.prompt-arrow--open {
  transform: rotate(90deg);
}
.prompt-expanded-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Switch label — match LaunchSessionModal MD3 pattern */
.agent-switch :deep(.v-label) {
  font-size: 14px;
  color: var(--content-secondary);
}

/* Switch track color — force agent hex in teleported dialog */
.agent-switch :deep(.v-selection-control--dirty .v-switch__track) {
  background-color: var(--switch-accent) !important;
}

/* Btn-toggle active state — force agent color in teleported dialog */
.agent-toggle :deep(.v-btn--active) {
  color: var(--toggle-accent) !important;
}

/* Hint text below switches and toggles — same as LaunchSessionModal */
.field-hint {
  color: var(--content-muted);
  margin-top: 4px;
}

/* Header avatar (edit mode) */
.agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}
</style>
