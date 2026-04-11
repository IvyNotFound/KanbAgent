<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { agentAccent, agentBg, agentFg } from '@renderer/utils/agentColor'
import { useAgentForm, ALL_AGENT_TYPES, COMMON_TOOLS } from '@renderer/composables/useAgentForm'
import AgentSystemPromptSection from './AgentSystemPromptSection.vue'
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

const { t } = useI18n()

const {
  isEditMode, isScoped, maxSessionsInvalid, worktreeToggleValue,
  cliItems, availableModels, defaultModelLabel, accentColor, perimetreItems,
  name, type, perimetre, systemPrompt, systemPromptSuffix, description,
  permissionMode, allToolsEnabled, allowedToolsList, autoLaunch,
  worktreeEnabled, maxSessions, preferredModel, preferredCli,
  loading, deleting, deleteError, nameError,
  onNameInput, submit, deleteAgent,
  settingsStore,
} = useAgentForm(props, {
  close: () => emit('close'),
  created: () => emit('created'),
  saved: () => emit('saved'),
  toast: (msg, type) => emit('toast', msg, type),
})

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
            :color="accentColor"
            :base-color="accentColor"
            @update:model-value="onNameInput"
          />

          <!-- Type -->
          <v-select
            v-model="type"
            :items="ALL_AGENT_TYPES"
            :label="t('agent.type')"
            variant="outlined"
            :color="accentColor ?? 'primary'"
            :base-color="accentColor"
            hide-details
          />

          <!-- Périmètre (scoped only) -->
          <v-combobox
            v-if="isScoped"
            v-model="perimetre"
            :items="perimetreItems"
            :label="t('agent.perimeter')"
            placeholder="front-vuejs"
            variant="outlined"
            density="compact"
            :color="accentColor ?? 'primary'"
            :base-color="accentColor"
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
            :color="accentColor ?? 'primary'"
            :base-color="accentColor"
          />

          <!-- Modèle préféré -->
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
            :color="accentColor ?? 'primary'"
            :base-color="accentColor"
          />
          <v-text-field
            v-else
            v-model="preferredModel"
            :label="t('launch.model')"
            placeholder="anthropic/claude-opus-4-5"
            :hint="t('agent.preferredModelNote')"
            persistent-hint
            variant="outlined"
            :color="accentColor"
            :base-color="accentColor"
          />

          <!-- Mode permissions -->
          <div>
            <div class="field-label text-label-medium mb-2">{{ t('agent.permissionMode') }}</div>
            <v-btn-toggle v-model="permissionMode" mandatory :color="accentColor ?? 'primary'" :style="accentColor ? { '--toggle-accent': accentColor } : undefined" variant="outlined" density="compact" rounded="lg" class="w-100 agent-toggle">
              <v-btn value="default" size="small" class="flex-1">{{ t('agent.permissionModeDefault') }}</v-btn>
              <v-btn value="auto" size="small" class="flex-1">{{ t('agent.permissionModeAuto') }}</v-btn>
            </v-btn-toggle>
            <p v-if="permissionMode === 'auto'" class="text-caption text-error mt-1">
              <v-icon size="small" color="error">mdi-alert</v-icon> {{ t('agent.permissionModeWarning') }}
            </p>
          </div>

          <!-- Outils autorisés -->
          <div>
            <v-switch
              v-model="allToolsEnabled"
              :label="t('agent.allTools')"
              hide-details
              density="compact"
              :color="accentColor ?? 'primary'"
              :style="accentColor ? { '--switch-accent': accentColor } : undefined"
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
              :color="accentColor ?? 'primary'"
              :base-color="accentColor"
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
            :color="accentColor ?? 'primary'"
            :style="accentColor ? { '--switch-accent': accentColor } : undefined"
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
            :color="accentColor"
            :base-color="accentColor"
          />

          <!-- Worktree isolation (edit mode uniquement) -->
          <div v-if="isEditMode">
            <div class="field-label text-label-medium mb-2">{{ t('agent.worktreeEnabled') }}</div>
            <v-btn-toggle v-model="worktreeToggleValue" mandatory :color="accentColor ?? 'primary'" :style="accentColor ? { '--toggle-accent': accentColor } : undefined" variant="outlined" density="compact" rounded="lg" class="w-100 agent-toggle">
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
          <AgentSystemPromptSection
            :system-prompt="systemPrompt"
            :system-prompt-suffix="systemPromptSuffix"
            :is-edit-mode="isEditMode"
            :accent-color="accentColor"
            @update:system-prompt="systemPrompt = $event"
            @update:system-prompt-suffix="systemPromptSuffix = $event"
          />
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <p v-if="deleteError" class="text-caption text-error">{{ deleteError }}</p>
          <div class="d-flex align-center justify-space-between">
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
            <div class="d-flex align-center ga-3">
              <span class="text-caption text-disabled">{{ isEditMode ? t('agent.saveShortcut') : t('agent.createShortcut') }}</span>
              <v-btn variant="text" :color="accentColor" @click="emit('close')">{{ t('common.cancel') }}</v-btn>
              <v-btn
                :color="accentColor ?? 'primary'"
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
  min-height: 0;
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

.field-label {
  font-size: 12px;
  color: var(--content-muted);
}

/* Input text color — force on-surface to override Vuetify :color tint in dark mode (T1684) */
.modal-body :deep(.v-field__input) {
  color: rgb(var(--v-theme-on-surface)) !important;
}

/* Switch label */
.agent-switch :deep(.v-label) {
  font-size: 14px;
  color: var(--content-secondary);
}

/* Switch track color — force agent hex in teleported dialog */
.agent-switch :deep(.v-selection-control--dirty .v-switch__track) {
  background-color: var(--switch-accent) !important;
}

/* Btn-toggle active state */
.agent-toggle :deep(.v-btn--active) {
  color: var(--toggle-accent) !important;
}

.field-hint {
  color: var(--content-muted);
  margin-top: 4px;
}

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
