<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'
import { agentBg, agentFg, agentAccent } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const { t } = useI18n()
const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const store = useTasksStore()
const settingsStore = useSettingsStore()
const { confirm } = useConfirmDialog()

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

// Worktree toggle bridge: v-btn-toggle needs primitive string values
const worktreeToggleValue = computed({
  get: () => worktreeEnabled.value === null ? 'inherit' : worktreeEnabled.value === 1 ? 'on' : 'off',
  set: (val: string) => {
    worktreeEnabled.value = val === 'inherit' ? null : val === 'on' ? 1 : 0
  },
})

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
  const confirmed = await confirm({
    title: t('agent.deleteAgent'),
    message: t('agent.deleteAgentConfirm', { name: props.agent.name }),
    type: 'danger',
  })
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
        <div class="modal-header">
          <div class="d-flex align-center ga-3">
            <div class="agent-avatar" :style="{ background: agentBg(agent.name), color: agentFg(agent.name) }">
              {{ agent.name.slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <p class="text-caption" style="color: var(--content-muted); line-height: 1.2;">{{ t('agent.editTitle') }}</p>
              <h2 class="text-subtitle-1 font-weight-medium" style="color: var(--content-primary); line-height: 1.3;">{{ agent.name }}</h2>
            </div>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            data-testid="btn-close"
            :style="{ color: agentAccent(agent.name) }"
            @click="emit('close')"
          />
        </div>

        <!-- Body -->
        <div class="modal-body">

          <!-- Nom -->
          <v-text-field
            v-model="name"
            :label="t('sidebar.name')"
            placeholder="nom-de-l-agent"
            variant="outlined"
            :color="agentAccent(agent.name)"
            @keydown.enter="save"
            @keydown.esc="emit('close')"
          />

          <!-- Thinking mode -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('launch.thinkingMode') }}</div>
            <v-btn-toggle v-model="thinkingMode" mandatory :color="agentAccent(agent.name)" variant="outlined" density="compact" class="agent-toggle" :style="{ '--toggle-accent': agentAccent(agent.name) }">
              <v-btn value="auto">{{ t('launch.auto') }}</v-btn>
              <v-btn value="disabled">{{ t('launch.disabled') }}</v-btn>
            </v-btn-toggle>
            <p class="text-caption text-disabled mt-1">{{ t('launch.thinkingNote') }}</p>
          </div>

          <!-- Modèle préféré -->
          <v-text-field
            v-model="preferredModel"
            :label="t('agent.preferredModel')"
            placeholder="anthropic/claude-opus-4-5"
            :hint="t('agent.preferredModelNote')"
            persistent-hint
            variant="outlined"
            :color="agentAccent(agent.name)"
          />

          <!-- Tâches autorisées (--allowedTools) -->
          <v-textarea
            v-model="allowedTools"
            :label="t('agent.allowedTools')"
            rows="3"
            spellcheck="false"
            :hint="t('agent.allowedToolsNote')"
            persistent-hint
            variant="outlined"
            :color="agentAccent(agent.name)"
          />

          <!-- Auto-launch toggle -->
          <v-switch
            v-model="autoLaunch"
            :label="t('agent.autoLaunch')"
            :hint="t('agent.autoLaunchDesc')"
            persistent-hint
            :color="agentAccent(agent.name)"
            :style="{ '--switch-accent': agentAccent(agent.name) }"
            density="compact"
            inset
            class="agent-switch"
          />

          <!-- Max sessions parallèles -->
          <v-text-field
            v-model="maxSessions"
            :label="t('agent.maxSessions')"
            :placeholder="t('agent.maxSessionsUnlimited')"
            inputmode="numeric"
            :error-messages="maxSessionsInvalid ? t('agent.maxSessionsError') : ''"
            :hint="t('agent.maxSessionsNote')"
            persistent-hint
            variant="outlined"
            :color="agentAccent(agent.name)"
          />

          <!-- Permission mode -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('agent.permissionMode') }}</div>
            <v-btn-toggle v-model="permissionMode" mandatory :color="agentAccent(agent.name)" variant="outlined" density="compact" class="agent-toggle" :style="{ '--toggle-accent': agentAccent(agent.name) }">
              <v-btn value="default">{{ t('agent.permissionModeDefault') }}</v-btn>
              <v-btn value="auto">{{ t('agent.permissionModeAuto') }}</v-btn>
            </v-btn-toggle>
            <p v-if="permissionMode === 'auto'" class="text-caption text-error mt-1">
              <v-icon size="small" color="error">mdi-alert</v-icon> {{ t('agent.permissionModeWarning') }}
            </p>
          </div>

          <!-- Worktree isolation (T1143) -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('agent.worktreeEnabled') }}</div>
            <v-btn-toggle v-model="worktreeToggleValue" mandatory :color="agentAccent(agent.name)" variant="outlined" density="compact" class="agent-toggle" :style="{ '--toggle-accent': agentAccent(agent.name) }">
              <v-btn value="inherit">{{ t('agent.worktreeInherit') }}</v-btn>
              <v-btn value="on">{{ t('agent.worktreeOn') }}</v-btn>
              <v-btn value="off">{{ t('agent.worktreeOff') }}</v-btn>
            </v-btn-toggle>
            <p v-if="worktreeEnabled === null" class="text-caption text-medium-emphasis mt-1">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="text-caption text-disabled mt-1">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- Périmètres -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('agent.perimeter') }}</div>
            <div v-if="store.perimetresData.length === 0" class="text-caption text-disabled mb-2" style="font-style: italic;">{{ t('agent.noPerimetre') }}</div>
            <div v-else class="d-flex flex-wrap ga-1 mb-2">
              <v-chip v-for="p in store.perimetresData" :key="p.id" size="small" label>{{ p.name }}</v-chip>
            </div>
            <div class="d-flex ga-2">
              <v-text-field
                v-model="newPerimetreName"
                :placeholder="t('agent.newPerimetrePlaceholder')"
                density="compact"
                variant="outlined"
                hide-details
                :color="agentAccent(agent.name)"
                class="flex-grow-1"
                @keydown.enter="addPerimetre"
                @keydown.esc="newPerimetreName = ''"
              />
              <v-btn
                :disabled="addingPerimetre || !newPerimetreName.trim()"
                :color="agentAccent(agent.name)"
                size="small"
                variant="outlined"
                @click="addPerimetre"
              >{{ t('agent.newPerimetre') }}</v-btn>
            </div>
            <p v-if="perimètreError" class="text-caption text-error mt-1">{{ perimètreError }}</p>
          </div>

          <!-- Erreur -->
          <v-alert v-if="error" type="error" variant="tonal" density="compact">
            {{ error }}
          </v-alert>

        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <v-btn
            color="error"
            variant="outlined"
            :disabled="deleting || saving"
            @click="deleteAgent"
          >{{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}</v-btn>
          <div class="d-flex align-center ga-2">
            <v-btn variant="text" :style="{ color: agentAccent(agent.name) }" @click="emit('close')">{{ t('common.cancel') }}</v-btn>
            <v-btn
              data-testid="btn-save"
              :color="agentAccent(agent.name)"
              variant="outlined"
              :disabled="saving || deleting || !name.trim() || maxSessionsInvalid"
              @click="save"
            >{{ saving ? t('common.saving') : t('common.save') }}</v-btn>
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
  flex-shrink: 0;
}

/* Header avatar */
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

/* Field labels for toggle sections */
.field-label {
  font-size: 12px;
  color: var(--content-muted);
}

/* Input text color — force on-surface to override Vuetify :color tint in dark mode (T1684) */
.modal-body :deep(.v-field__input) {
  color: rgb(var(--v-theme-on-surface)) !important;
}

/* Switch track color — force agent hex in teleported dialog (Vuetify hex color doesn't cascade correctly) */
.agent-switch :deep(.v-selection-control--dirty .v-switch__track) {
  background-color: var(--switch-accent) !important;
}

/* btn-toggle active state — :color prop ineffective in teleported dialog (T1608) */
.agent-toggle :deep(.v-btn--active) {
  color: var(--toggle-accent) !important;
  border-color: var(--toggle-accent) !important;
}
</style>
