<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const { t } = useI18n()
const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const store = useTasksStore()
const settingsStore = useSettingsStore()

const name = ref(props.agent.name)
const thinkingMode = ref<'auto' | 'disabled'>(
  props.agent.thinking_mode === 'disabled' ? 'disabled' : 'auto'
)
const permissionMode = ref<'default' | 'auto'>(
  props.agent.permission_mode === 'auto' ? 'auto' : 'default'
)
const allowedTools = ref(props.agent.allowed_tools ?? '')
const autoLaunch = ref(props.agent.auto_launch !== 0)
const worktreeEnabled = ref<number | null>(props.agent.worktree_enabled ?? null)
// String to allow empty value (empty → -1 = unlimited in DB)
const maxSessions = ref(props.agent.max_sessions === -1 ? '' : String(props.agent.max_sessions ?? 3))
const maxSessionsInvalid = computed(() => maxSessions.value !== '' && (!/^\d+$/.test(maxSessions.value) || parseInt(maxSessions.value) < 1))
const maxSessionsDbValue = computed(() => maxSessions.value === '' ? -1 : parseInt(maxSessions.value))
// Model identifier passed as --model to OpenCode (e.g. 'anthropic/claude-opus-4-5'). Trimmed on save; empty string stored as null in DB.
const preferredModel = ref(props.agent.preferred_model ?? '')
const saving = ref(false)
const deleting = ref(false)
const error = ref<string | null>(null)
const newPerimetreName = ref('')
const addingPerimetre = ref(false)
const perimètreError = ref<string | null>(null)

onMounted(async () => {
  if (store.dbPath) {
    const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, props.agent.id)
    if (result.success) {
      thinkingMode.value = result.thinkingMode === 'disabled' ? 'disabled' : 'auto'
      permissionMode.value = result.permissionMode === 'auto' ? 'auto' : 'default'
      preferredModel.value = result.preferredModel ?? preferredModel.value
    }
  }
})

async function deleteAgent() {
  if (!store.dbPath) return
  const confirmed = window.confirm(t('agent.deleteAgentConfirm', { name: props.agent.name }))
  if (!confirmed) return
  deleting.value = true
  error.value = null
  try {
    const result = await window.electronAPI.deleteAgent(store.dbPath, props.agent.id)
    if (result.hasHistory) {
      error.value = t('agent.deleteAgentHistoryError')
      return
    }
    if (!result.success) {
      error.value = result.error ?? 'Erreur inconnue'
      return
    }
    await store.refresh()
    emit('saved')
    emit('close')
  } finally {
    deleting.value = false
  }
}

async function addPerimetre() {
  if (!store.dbPath || !newPerimetreName.value.trim()) return
  addingPerimetre.value = true
  perimètreError.value = null
  try {
    const result = await window.electronAPI.addPerimetre(store.dbPath, newPerimetreName.value.trim())
    if (!result.success) {
      perimètreError.value = result.error ?? 'Erreur inconnue'
      return
    }
    newPerimetreName.value = ''
    await store.refresh()
  } finally {
    addingPerimetre.value = false
  }
}

async function save() {
  if (!store.dbPath || !name.value.trim()) return
  saving.value = true
  error.value = null
  try {
    const result = await window.electronAPI.updateAgent(store.dbPath, props.agent.id, {
      name: name.value.trim(),
      thinkingMode: thinkingMode.value,
      allowedTools: allowedTools.value.trim() || null,
      autoLaunch: autoLaunch.value,
      permissionMode: permissionMode.value,
      maxSessions: maxSessionsDbValue.value,
      worktreeEnabled: worktreeEnabled.value === null ? null : worktreeEnabled.value === 1,
      preferredModel: preferredModel.value.trim() || null,
    })
    if (!result.success) {
      error.value = result.error ?? 'Erreur inconnue'
      return
    }
    await store.refresh()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog model-value max-width="750" scrollable @update:model-value="emit('close')">
    <div data-testid="agent-edit-backdrop" @click.self="emit('close')">
    <v-card class="d-flex flex-column" style="max-height: 85vh;">

        <!-- Header -->
        <div
          class="modal-header"
          :style="{ borderLeftColor: agentFg(agent.name), borderLeftWidth: '3px' }"
        >
          <div>
            <p class="section-label mb-1">{{ t('agent.editTitle') }}</p>
            <p class="agent-title" :style="{ color: agentFg(agent.name) }">
              {{ agent.name }}
            </p>
          </div>
          <button class="btn-close" @click="emit('close')">✕</button>
        </div>

        <!-- Body -->
        <div class="modal-body">

          <!-- Nom -->
          <div>
            <label class="field-label">{{ t('sidebar.name') }}</label>
            <input
              v-model="name"
              class="form-input"
              placeholder="nom-de-l-agent"
              @keydown.enter="save"
              @keydown.esc="emit('close')"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="field-label">{{ t('launch.thinkingMode') }}</label>
            <div class="toggle-group">
              <button
                :class="['toggle-btn', thinkingMode === 'auto' ? 'toggle-btn--active-violet' : '']"
                @click="thinkingMode = 'auto'"
              >{{ t('launch.auto') }}</button>
              <button
                :class="['toggle-btn', thinkingMode === 'disabled' ? 'toggle-btn--active-amber' : '']"
                @click="thinkingMode = 'disabled'"
              >{{ t('launch.disabled') }}</button>
            </div>
            <p class="field-hint">{{ t('launch.thinkingNote') }}</p>
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

          <!-- Tâches autorisées (--allowedTools) -->
          <div>
            <label class="field-label">
              {{ t('agent.allowedTools') }}
              <span class="field-label-note">(--allowedTools)</span>
            </label>
            <textarea
              v-model="allowedTools"
              rows="3"
              spellcheck="false"
              placeholder="Bash,Edit,Read,Write,Glob,Grep&#10;Laisser vide = tous les outils autorisés"
              class="form-textarea"
            />
            <p class="field-hint">{{ t('agent.allowedToolsNote') }}</p>
          </div>

          <!-- Auto-launch toggle -->
          <div class="toggle-row">
            <div>
              <p class="field-label mb-0">{{ t('agent.autoLaunch') }}</p>
              <p class="field-hint mt-1">{{ t('agent.autoLaunchDesc') }}</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="autoLaunch"
              class="switch-track"
              :class="autoLaunch ? 'switch-track--on' : ''"
              @click="autoLaunch = !autoLaunch"
            >
              <span class="switch-thumb" :class="autoLaunch ? 'switch-thumb--on' : ''" />
            </button>
          </div>

          <!-- Max sessions parallèles -->
          <div>
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

          <!-- Permission mode -->
          <div>
            <label class="field-label">{{ t('agent.permissionMode') }}</label>
            <div class="toggle-group">
              <button
                :class="['toggle-btn', permissionMode === 'default' ? 'toggle-btn--active-violet' : '']"
                @click="permissionMode = 'default'"
              >{{ t('agent.permissionModeDefault') }}</button>
              <button
                :class="['toggle-btn', permissionMode === 'auto' ? 'toggle-btn--active-red' : '']"
                @click="permissionMode = 'auto'"
              >{{ t('agent.permissionModeAuto') }}</button>
            </div>
            <p v-if="permissionMode === 'auto'" class="field-hint field-hint--warn">⚠ {{ t('agent.permissionModeWarning') }}</p>
          </div>

          <!-- Worktree isolation (T1143) -->
          <div>
            <label class="field-label">{{ t('agent.worktreeEnabled') }}</label>
            <div class="toggle-group">
              <button
                :class="['toggle-btn', worktreeEnabled === null ? 'toggle-btn--active-violet' : '']"
                @click="worktreeEnabled = null"
              >
                {{ t('agent.worktreeInherit') }}
              </button>
              <button
                :class="['toggle-btn', worktreeEnabled === 1 ? 'toggle-btn--active-emerald' : '']"
                @click="worktreeEnabled = 1"
              >
                {{ t('agent.worktreeOn') }}
              </button>
              <button
                :class="['toggle-btn', worktreeEnabled === 0 ? 'toggle-btn--active-amber' : '']"
                @click="worktreeEnabled = 0"
              >
                {{ t('agent.worktreeOff') }}
              </button>
            </div>
            <p v-if="worktreeEnabled === null" class="field-hint">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="field-hint">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- Périmètres -->
          <div>
            <label class="field-label">{{ t('agent.perimeter') }}</label>
            <div v-if="store.perimetresData.length === 0" class="field-hint" style="font-style: italic; margin-bottom: 8px;">{{ t('agent.noPerimetre') }}</div>
            <div v-else class="chip-list mb-2">
              <span
                v-for="p in store.perimetresData"
                :key="p.id"
                class="chip"
              >{{ p.name }}</span>
            </div>
            <div class="d-flex ga-2">
              <input
                v-model="newPerimetreName"
                class="form-input flex-grow-1"
                :placeholder="t('agent.newPerimetrePlaceholder')"
                @keydown.enter="addPerimetre"
                @keydown.esc="newPerimetreName = ''"
              />
              <button
                class="btn-secondary"
                :disabled="addingPerimetre || !newPerimetreName.trim()"
                @click="addPerimetre"
              >{{ t('agent.newPerimetre') }}</button>
            </div>
            <div v-if="perimètreError" class="error-banner mt-2">
              <p class="error-text">{{ perimètreError }}</p>
            </div>
          </div>

          <!-- Erreur -->
          <div v-if="error" class="error-banner">
            <p class="error-text">{{ error }}</p>
          </div>

        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button
            class="btn-danger"
            :disabled="deleting || saving"
            @click="deleteAgent"
          >{{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}</button>
          <div class="d-flex align-center ga-2">
            <button
              class="btn-ghost"
              @click="emit('close')"
            >{{ t('common.cancel') }}</button>
            <button
              class="btn-save"
              :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name) }"
              :disabled="saving || deleting || !name.trim() || maxSessionsInvalid"
              @click="save"
            >{{ saving ? t('common.saving') : t('common.save') }}</button>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--edge-subtle);
  background: rgba(var(--v-theme-surface), 0.5);
  flex-shrink: 0;
}

/* Header typography */
.section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.agent-title {
  font-size: 16px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-weight: 600;
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
  font-size: 14px;
  transition: color 150ms, background 150ms;
}
.btn-close:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}

/* Field labels */
.field-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: var(--content-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.field-label-note {
  text-transform: none;
  font-weight: 400;
  color: var(--content-faint);
  margin-left: 4px;
}
.field-hint {
  font-size: 10px;
  color: var(--content-faint);
  margin-top: 6px;
}
.field-hint--error {
  color: #f87171;
}
.field-hint--warn {
  color: #f87171;
  font-weight: 500;
}

/* Form inputs */
.form-input {
  width: 100%;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 8px;
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
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-secondary);
  outline: none;
  transition: border-color 150ms;
  resize: none;
  line-height: 1.5;
  box-sizing: border-box;
}
.form-textarea:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6;
}
.form-textarea::placeholder {
  color: var(--content-faint);
}

/* Toggle buttons */
.toggle-group {
  display: flex;
  gap: 8px;
}
.toggle-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--edge-default);
  background: rgba(var(--v-theme-surface-variant, 39, 39, 42), 0.4);
  color: var(--content-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
}
.toggle-btn:hover {
  border-color: var(--content-faint);
}
.toggle-btn--active-violet {
  border-color: rgba(139, 92, 246, 0.6);
  background: rgba(109, 40, 217, 0.2);
  color: #c4b5fd;
}
.toggle-btn--active-amber {
  border-color: rgba(245, 158, 11, 0.6);
  background: rgba(120, 53, 15, 0.2);
  color: #fcd34d;
}
.toggle-btn--active-red {
  border-color: rgba(239, 68, 68, 0.6);
  background: rgba(127, 29, 29, 0.2);
  color: #fca5a5;
}
.toggle-btn--active-emerald {
  border-color: rgba(16, 185, 129, 0.6);
  background: rgba(2, 44, 34, 0.2);
  color: #6ee7b7;
}

/* Auto-launch toggle row */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.switch-track {
  position: relative;
  display: inline-flex;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 9999px;
  border: 2px solid transparent;
  background: var(--surface-secondary);
  outline: none;
  transition: background 200ms;
}
.switch-track--on {
  background: #8b5cf6;
}
.switch-track:focus {
  box-shadow: 0 0 0 2px #8b5cf6, 0 0 0 3px var(--surface-primary);
}
.switch-thumb {
  pointer-events: none;
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  transform: translateX(0);
  transition: transform 200ms;
}
.switch-thumb--on {
  transform: translateX(16px);
}

/* Chips */
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  color: var(--content-secondary);
}

/* Error banner */
.error-banner {
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
}
.error-text {
  font-size: 12px;
  color: #f87171;
}

/* Footer buttons */
.btn-danger {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 8px;
  background: none;
  cursor: pointer;
  transition: all 150ms;
}
.btn-danger:hover:not(:disabled) {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.6);
}
.btn-danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-ghost {
  padding: 8px 16px;
  font-size: 14px;
  color: var(--content-muted);
  border: none;
  background: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-ghost:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}
.btn-save {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  border-style: solid;
  border-width: 1px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-secondary {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--content-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 8px;
  background: var(--surface-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: all 150ms;
}
.btn-secondary:hover:not(:disabled) {
  border-color: #8b5cf6;
  color: #c4b5fd;
}
.btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
