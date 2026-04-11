<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { agentAccent, agentBg, agentFg } from '@renderer/utils/agentColor'
import { useModalEscape } from '@renderer/composables/useModalEscape'
import { useLaunchSession, MAX_AGENT_SESSIONS } from '@renderer/composables/useLaunchSession'
import { useLaunchModalInit } from '@renderer/composables/useLaunchModalInit'
import { useToast } from '@renderer/composables/useToast'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import LaunchInstanceSelector from './LaunchInstanceSelector.vue'
import LaunchSessionOptions from './LaunchSessionOptions.vue'
import type { Agent } from '@renderer/types'

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: [] }>()

useModalEscape(() => emit('close'))

const { t } = useI18n()
const { launchAgentTerminal } = useLaunchSession()
const toast = useToast()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

const {
  selectedInstance, loading,
  thinkingMode, lastConvId, useResume, multiInstance,
  worktreeSource, worktreeError, selectedModel,
  selectedCli, caps, allAvailableInstances, noInstanceText,
  availableModels, defaultModelLabel, fullSystemPrompt,
} = useLaunchModalInit(props)

const customPrompt = ref('')
const launching = ref(false)

async function launch() {
  launching.value = true
  worktreeError.value = null
  try {
    let workDir: string | undefined
    if (multiInstance.value && tasksStore.projectPath) {
      const sessionNonce = Date.now().toString()
      const result = await window.electronAPI.worktreeCreate(
        tasksStore.projectPath,
        sessionNonce,
        props.agent.name
      )
      if (!result.success) {
        worktreeError.value = result.error ?? 'unknown error'
        return
      }
      workDir = result.workDir
    }

    const convId = caps.value.convResume && useResume.value && lastConvId.value ? lastConvId.value : undefined
    const activeThinking = caps.value.thinkingMode ? thinkingMode.value : undefined
    const activeSystemPrompt = caps.value.systemPrompt ? fullSystemPrompt.value : undefined

    const result = await launchAgentTerminal(props.agent, undefined, {
      customPrompt: customPrompt.value,
      instance: selectedInstance.value,
      cli: selectedCli.value,
      convId,
      workDir,
      thinkingMode: activeThinking,
      systemPrompt: convId ? false : (activeSystemPrompt ?? ''),
      activate: true,
      modelId: selectedModel.value ?? undefined,
    })
    if (result === 'session-limit') {
      const max = props.agent.max_sessions ?? MAX_AGENT_SESSIONS
      toast.push(t('board.sessionLimitReached', { agent: props.agent.name, max }), 'warn')
      return
    }
    if (result === 'error') {
      toast.push(t('board.launchFailed', { agent: props.agent.name }), 'error')
      return
    }
    emit('close')
  } finally {
    launching.value = false
  }
}
</script>

<template>
  <v-dialog model-value max-width="560" scrollable @update:model-value="emit('close')">
    <div data-testid="launch-modal-backdrop" @click.self="emit('close')">
    <v-card elevation="3" class="d-flex flex-column" style="max-height: 85vh;">
        <!-- Header -->
        <div class="modal-header">
          <div class="d-flex align-center ga-3">
            <div class="agent-avatar" :style="{ background: agentBg(agent.name), color: agentFg(agent.name) }">
              {{ agent.name.slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <p class="text-caption" style="color: var(--content-muted); line-height: 1.2;">{{ t('launch.title') }}</p>
              <h2 class="text-subtitle-1 font-weight-medium" style="color: var(--content-primary); line-height: 1.3;">{{ agent.name }}</h2>
            </div>
          </div>
          <v-btn
            data-testid="btn-close"
            icon="mdi-close"
            size="small"
            variant="text"
            :color="agentAccent(agent.name)"
            @click="emit('close')"
          />
        </div>

        <!-- Loading bar -->
        <v-progress-linear v-if="loading" indeterminate :color="agentAccent(agent.name)" height="2" />

        <!-- Body -->
        <div class="modal-body">
          <LaunchInstanceSelector
            v-model="selectedInstance"
            :instances="allAvailableInstances"
            :loading="loading"
            :agent-name="agent.name"
            :no-instance-text="noInstanceText"
          />

          <LaunchSessionOptions
            :caps="caps"
            :available-models="availableModels"
            :default-model-label="defaultModelLabel"
            :last-conv-id="lastConvId"
            :worktree-source="worktreeSource"
            :worktree-error="worktreeError"
            :accent-color="agentAccent(agent.name)"
            :selected-model="selectedModel"
            :use-resume="useResume"
            :thinking-mode="thinkingMode"
            :custom-prompt="customPrompt"
            :multi-instance="multiInstance"
            @update:selected-model="selectedModel = $event"
            @update:use-resume="useResume = $event"
            @update:thinking-mode="thinkingMode = $event"
            @update:custom-prompt="customPrompt = $event"
            @update:multi-instance="multiInstance = $event"
          />
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <p v-if="!loading && allAvailableInstances.length === 0" data-testid="no-instance-warning" class="no-instance-warning text-caption text-right">
            {{ noInstanceText }}
          </p>
          <div class="d-flex align-center justify-space-between ga-2">
            <v-btn
              data-testid="btn-refresh"
              variant="text"
              :loading="settingsStore.detectingClis"
              :color="agentAccent(agent.name)"
              prepend-icon="mdi-refresh"
              @click="settingsStore.refreshCliDetection(true)"
            >
              {{ t('launch.refreshDetection') }}
            </v-btn>
            <div class="d-flex align-center ga-2">
              <v-btn
                data-testid="btn-cancel"
                variant="text"
                size="default"
                style="min-width: 80px;"
                :color="agentAccent(agent.name)"
                @click="emit('close')"
              >{{ t('launch.cancel') }}</v-btn>
              <v-btn
                data-testid="btn-launch"
                variant="tonal"
                :color="agentAccent(agent.name)"
                size="default"
                style="min-width: 80px;"
                :disabled="loading || launching || allAvailableInstances.length === 0"
                :loading="launching"
                @click="launch"
              >
                <v-icon size="14">mdi-play</v-icon>
                {{ t('launch.launch') }}
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

.field-hint {
  color: var(--content-muted);
  margin-top: 4px;
}
.no-instance-warning {
  color: rgb(var(--v-theme-warning));
  text-align: right;
}
</style>
