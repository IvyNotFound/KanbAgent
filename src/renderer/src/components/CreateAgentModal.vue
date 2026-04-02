<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
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

watch(type, () => {
  if (!isScoped.value) perimetre.value = ''
})

watch(name, () => { nameError.value = '' })

/**
 * Normalizes the agent name on each keystroke: lowercase + spaces→hyphens.
 * Enforces the kebab-case convention used throughout the project (e.g. dev-front-vuejs).
 * Uses :value + @input instead of v-model to apply normalization before Vue sets the ref.
 */
function onNameInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  name.value = raw.toLowerCase().replace(/ /g, '-')
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
        if (systemPrompt.value || systemPromptSuffix.value) showPrompt.value = true
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
        <div class="modal-header">
          <h2 class="text-body-1 font-weight-medium" style="color: var(--content-primary)">{{ isEditMode ? t('agent.editTitle') : t('agent.newTitle') }}</h2>
          <button class="btn-close" @click="emit('close')">
            <svg viewBox="0 0 16 16" fill="currentColor" style="width: 14px; height: 14px;">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Form -->
        <div class="modal-body">

          <!-- Nom -->
          <div>
            <label class="field-label">{{ t('sidebar.name') }} <span style="color: #f87171;">*</span></label>
            <input
              :value="name"
              :class="['form-input', nameError ? 'form-input--error' : '']"
              type="text"
              autofocus
              placeholder="dev-back-api"
              @input="onNameInput"
            />
            <p v-if="nameError" class="field-hint field-hint--error">{{ nameError }}</p>
            <p v-else class="field-hint">{{ t('agent.nameFormatShort') }}</p>
          </div>

          <!-- Type -->
          <div>
            <label class="field-label">{{ t('agent.type') }}</label>
            <div class="type-grid">
              <button
                v-for="tp in ALL_TYPES"
                :key="tp"
                :class="['type-btn', type === tp ? 'type-btn--active' : '']"
                @click="type = tp"
              >{{ tp }}</button>
            </div>
          </div>

          <!-- Périmètre (scoped only) -->
          <div v-if="isScoped">
            <label class="field-label">{{ t('agent.perimeter') }}</label>
            <input
              v-model="perimetre"
              list="perimetres-list"
              type="text"
              placeholder="front-vuejs"
              class="form-input"
            />
            <datalist id="perimetres-list">
              <option v-for="p in store.perimetresData" :key="p.id" :value="p.name" />
            </datalist>
          </div>

          <!-- Description (pour CLAUDE.md) — create mode uniquement -->
          <div v-if="!isEditMode">
            <label class="field-label">{{ t('sidebar.description') }} <span class="field-label-note">(CLAUDE.md)</span></label>
            <input
              v-model="description"
              type="text"
              class="form-input"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="field-label">{{ t('launch.thinkingMode') }}</label>
            <div class="toggle-group">
              <button
                :class="['toggle-btn', thinkingMode === 'auto' ? 'toggle-btn--active' : '']"
                @click="thinkingMode = 'auto'"
              >{{ t('launch.auto') }}</button>
              <button
                :class="['toggle-btn', thinkingMode === 'disabled' ? 'toggle-btn--active' : '']"
                @click="thinkingMode = 'disabled'"
              >{{ t('launch.disabled') }}</button>
            </div>
          </div>

          <!-- Modèle préféré -->
          <div>
            <label class="field-label">{{ t('agent.preferredModel') }}</label>
            <input
              v-model="preferredModel"
              type="text"
              placeholder="anthropic/claude-opus-4-5"
              class="form-input"
            />
            <p class="field-hint">{{ t('agent.preferredModelNote') }}</p>
          </div>

          <!-- Sessions parallèles max (edit mode uniquement) -->
          <div v-if="isEditMode">
            <label class="field-label">{{ t('agent.maxSessions') }}</label>
            <input
              v-model="maxSessions"
              type="text"
              inputmode="numeric"
              :placeholder="t('agent.maxSessionsUnlimited')"
              class="form-input"
              :class="{ 'form-input--error': maxSessionsInvalid }"
            />
            <p class="field-hint">{{ t('agent.maxSessionsNote') }}</p>
            <p v-if="maxSessionsInvalid" class="field-hint field-hint--error">{{ t('agent.maxSessionsError') }}</p>
          </div>

          <!-- Worktree isolation (edit mode uniquement) -->
          <div v-if="isEditMode">
            <label class="field-label">{{ t('agent.worktreeEnabled') }}</label>
            <div class="toggle-group">
              <button
                :class="['toggle-btn', worktreeEnabled === null ? 'toggle-btn--active-violet' : '']"
                @click="worktreeEnabled = null"
              >{{ t('agent.worktreeInherit') }}</button>
              <button
                :class="['toggle-btn', worktreeEnabled === 1 ? 'toggle-btn--active-emerald' : '']"
                @click="worktreeEnabled = 1"
              >{{ t('agent.worktreeOn') }}</button>
              <button
                :class="['toggle-btn', worktreeEnabled === 0 ? 'toggle-btn--active-amber' : '']"
                @click="worktreeEnabled = 0"
              >{{ t('agent.worktreeOff') }}</button>
            </div>
            <p v-if="worktreeEnabled === null" class="field-hint">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="field-hint">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- System prompt (optionnel, collapsible) -->
          <div>
            <button
              class="prompt-toggle"
              @click="showPrompt = !showPrompt"
            >
              <svg :class="['prompt-arrow', showPrompt ? 'prompt-arrow--open' : '']" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 3.5l5 4.5-5 4.5V3.5z"/>
              </svg>
              System prompt {{ isEditMode ? '' : t('agent.systemPromptOptional') }}
            </button>
            <div v-if="showPrompt" class="d-flex flex-column ga-2 mt-2">
              <textarea
                v-model="systemPrompt"
                rows="14"
                spellcheck="true"
                :placeholder="t('agent.systemPromptPlaceholder')"
                class="form-textarea form-textarea--resizable"
              />
              <div v-if="isEditMode">
                <label class="field-label-subtle">{{ t('agent.hiddenSuffix') }} <span class="field-label-note">({{ t('agent.hiddenSuffixCode') }})</span></label>
                <textarea
                  v-model="systemPromptSuffix"
                  rows="12"
                  spellcheck="true"
                  :placeholder="t('agent.systemPromptSuffixPlaceholder')"
                  class="form-textarea form-textarea--resizable"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <p v-if="deleteError" class="field-hint field-hint--error">{{ deleteError }}</p>
          <div class="d-flex align-center justify-space-between">
            <!-- Left: destructive action isolated from primary actions -->
            <div>
              <button
                v-if="isEditMode"
                class="btn-danger"
                :disabled="deleting || loading"
                @click="deleteAgent"
              >{{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}</button>
            </div>
            <!-- Right: primary actions + shortcut hint near the submit button -->
            <div class="d-flex align-center ga-3">
              <span class="field-hint" style="margin-top: 0;">{{ isEditMode ? t('agent.saveShortcut') : t('agent.createShortcut') }}</span>
              <button
                class="btn-ghost"
                @click="emit('close')"
              >{{ t('common.cancel') }}</button>
              <button
                class="btn-primary"
                :disabled="loading || !name.trim() || (isEditMode && maxSessionsInvalid)"
                @click="submit"
              >
                {{ loading ? (isEditMode ? t('common.saving') : t('agent.creating')) : (isEditMode ? t('common.save') : t('agent.create')) }}
              </button>
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

/* Labels */
.field-label {
  display: block;
  font-size: 12px;
  color: var(--content-muted);
  margin-bottom: 4px;
}
.field-label-subtle {
  display: block;
  font-size: 12px;
  color: var(--content-subtle);
  margin-bottom: 4px;
}
.field-label-note {
  color: var(--content-faint);
  margin-left: 2px;
}
.field-hint {
  font-size: 12px;
  color: var(--content-faint);
  margin-top: 4px;
}
.field-hint--error {
  color: #f87171;
}

/* Form inputs */
.form-input {
  width: 100%;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-primary);
  outline: none;
  transition: border-color 150ms;
  box-sizing: border-box;
}
.form-input:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6;
}
.form-input--error {
  border-color: #ef4444;
}
.form-input--error:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 1px #ef4444;
}
.form-textarea {
  width: 100%;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-tertiary);
  outline: none;
  transition: border-color 150ms;
  resize: none;
  box-sizing: border-box;
}
.form-textarea--resizable {
  resize: vertical;
}
.form-textarea:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6;
}
.form-textarea::placeholder {
  color: var(--content-faint);
}

/* Type grid */
.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.type-btn {
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  border: none;
  background: var(--surface-secondary);
  color: var(--content-muted);
  cursor: pointer;
  transition: all 150ms;
}
.type-btn:hover {
  background: var(--surface-tertiary);
}
.type-btn--active {
  background: #7c3aed;
  color: white;
}

/* Toggle buttons */
.toggle-group {
  display: flex;
  gap: 8px;
}
.toggle-btn {
  flex: 1;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  border: none;
  background: var(--surface-secondary);
  color: var(--content-muted);
  cursor: pointer;
  transition: all 150ms;
}
.toggle-btn:hover {
  background: var(--surface-tertiary);
}
.toggle-btn--active {
  background: #7c3aed;
  color: white;
}
.toggle-btn--active-violet {
  border: 1px solid rgba(139, 92, 246, 0.6);
  background: rgba(109, 40, 217, 0.2);
  color: #c4b5fd;
}
.toggle-btn--active-emerald {
  border: 1px solid rgba(16, 185, 129, 0.6);
  background: rgba(2, 44, 34, 0.2);
  color: #6ee7b7;
}
.toggle-btn--active-amber {
  border: 1px solid rgba(245, 158, 11, 0.6);
  background: rgba(120, 53, 15, 0.2);
  color: #fcd34d;
}

/* System prompt toggle */
.prompt-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 150ms;
}
.prompt-toggle:hover {
  color: var(--content-tertiary);
}
.prompt-arrow {
  width: 12px;
  height: 12px;
  transition: transform 150ms;
}
.prompt-arrow--open {
  transform: rotate(90deg);
}

/* Close button */
.btn-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--content-subtle);
  cursor: pointer;
  transition: all 150ms;
}
.btn-close:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}

/* Footer buttons */
.btn-danger {
  padding: 6px 16px;
  font-size: 14px;
  background: #b91c1c;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms;
}
.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}
.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  padding: 6px 16px;
  font-size: 14px;
  color: var(--content-muted);
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-ghost:hover {
  color: var(--content-secondary);
}
.btn-primary {
  padding: 6px 16px;
  font-size: 14px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms;
}
.btn-primary:hover:not(:disabled) {
  background: #6d28d9;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
