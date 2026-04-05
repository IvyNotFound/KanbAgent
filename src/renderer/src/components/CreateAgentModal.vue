<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentAccent, agentBorder } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

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
const ALL_TYPES = ['dev', 'test', 'ux', 'review', 'review-master', 'arch', 'devops', 'doc', 'secu', 'perf', 'data']

const name = ref('')
const type = ref('dev')
const perimetre = ref('')
const thinkingMode = ref<'auto' | 'disabled'>('auto')
const systemPrompt = ref('')
const systemPromptSuffix = ref('')
const description = ref('')
const worktreeEnabled = ref<number | null>(props.agent?.worktree_enabled ?? null)
// String to allow empty value (empty → -1 = unlimited in DB)
const maxSessions = ref(props.agent?.max_sessions === -1 ? '' : String(props.agent?.max_sessions ?? 3))
const maxSessionsInvalid = computed(() => maxSessions.value !== '' && (!/^\d+$/.test(maxSessions.value) || parseInt(maxSessions.value) < 1))
const maxSessionsDbValue = computed(() => maxSessions.value === '' ? -1 : parseInt(maxSessions.value))
// Model identifier passed as --model to OpenCode (e.g. 'anthropic/claude-opus-4-5'). Trimmed on submit; empty string stored as null in DB.
const preferredModel = ref('')
const showPrompt = ref(false)
const loading = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const nameError = ref('')

const isScoped = computed(() => SCOPED_TYPES.includes(type.value))

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
  if (isEditMode.value && props.agent) {
    const a = props.agent
    name.value = a.name
    type.value = ALL_TYPES.includes(a.type) ? a.type : 'dev'
    perimetre.value = a.scope ?? ''
    thinkingMode.value = a.thinking_mode === 'disabled' ? 'disabled' : 'auto'
    maxSessions.value = a.max_sessions === -1 ? '' : String(a.max_sessions ?? 3)
    worktreeEnabled.value = a.worktree_enabled ?? null
    preferredModel.value = a.preferred_model ?? ''
    // Load system_prompt and system_prompt_suffix from DB (may be more up-to-date than agent prop)
    if (store.dbPath) {
      const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, a.id)
      if (result.success) {
        systemPrompt.value = result.systemPrompt ?? ''
        systemPromptSuffix.value = result.systemPromptSuffix ?? ''
        thinkingMode.value = result.thinkingMode === 'disabled' ? 'disabled' : 'auto'
        preferredModel.value = result.preferredModel ?? preferredModel.value
        // showPrompt stays false — always collapsed on open, even if content exists
      }
    }
  }
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
        thinkingMode: thinkingMode.value,
        systemPrompt: systemPrompt.value.trim() || null,
        systemPromptSuffix: systemPromptSuffix.value.trim() || null,
        maxSessions: maxSessionsDbValue.value,
        worktreeEnabled: worktreeEnabled.value === null ? null : worktreeEnabled.value === 1,
        preferredModel: preferredModel.value.trim() || null,
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
      thinkingMode: thinkingMode.value,
      systemPrompt: systemPrompt.value.trim() || null,
      description: description.value.trim() || defaultDescription(type.value),
      preferredModel: preferredModel.value.trim() || null,
    })

    if (!result.success) {
      if (result.error?.includes('existe déjà')) nameError.value = result.error
      else emit('toast', result.error ?? t('agent.createError'), 'error')
      return
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
        <div
          class="modal-header"
          :style="isEditMode && agent ? { borderLeftColor: agentBorder(agent.name), borderLeftWidth: '3px', borderLeftStyle: 'solid' } : {}"
        >
          <h2 class="text-body-1 font-weight-medium" style="color: var(--content-primary)">{{ isEditMode ? t('agent.editTitle') : t('agent.newTitle') }}</h2>
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

          <!-- Thinking mode -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('launch.thinkingMode') }}</div>
            <v-btn-toggle v-model="thinkingMode" mandatory :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'" variant="outlined" density="compact">
              <v-btn value="auto">{{ t('launch.auto') }}</v-btn>
              <v-btn value="disabled">{{ t('launch.disabled') }}</v-btn>
            </v-btn-toggle>
          </div>

          <!-- Modèle préféré -->
          <v-text-field
            v-model="preferredModel"
            :label="t('agent.preferredModel')"
            placeholder="anthropic/claude-opus-4-5"
            :hint="t('agent.preferredModelNote')"
            persistent-hint
            variant="outlined"
            :color="isEditMode && agent ? agentAccent(agent.name) : undefined"
            :base-color="isEditMode && agent ? agentAccent(agent.name) : undefined"
          />

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
            <v-btn-toggle v-model="worktreeToggleValue" mandatory :color="isEditMode && agent ? agentAccent(agent.name) : 'primary'" variant="outlined" density="compact">
              <v-btn value="inherit">{{ t('agent.worktreeInherit') }}</v-btn>
              <v-btn value="on">{{ t('agent.worktreeOn') }}</v-btn>
              <v-btn value="off">{{ t('agent.worktreeOff') }}</v-btn>
            </v-btn-toggle>
            <p v-if="worktreeEnabled === null" class="text-caption text-medium-emphasis mt-1">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="text-caption text-disabled mt-1">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- System prompt (optionnel, collapsible) -->
          <div class="prompt-section">
            <div
              class="prompt-header"
              role="button"
              tabindex="0"
              @click="showPrompt = !showPrompt"
              @keydown.enter="showPrompt = !showPrompt"
              @keydown.space.prevent="showPrompt = !showPrompt"
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
                rows="14"
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
                  rows="12"
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
              >{{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}</v-btn>
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

/* System prompt section */
.prompt-section {
  border: 1px solid var(--edge-subtle);
  border-radius: 8px;
  overflow: hidden;
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
</style>
