<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CliCapabilities } from '@shared/cli-types'

defineProps<{
  caps: CliCapabilities
  availableModels: { title: string; value: string }[]
  defaultModelLabel: string | null
  lastConvId: string | null
  worktreeSource: 'global' | 'agent' | 'manual'
  worktreeError: string | null
  accentColor: string
  selectedModel: string | null
  useResume: boolean
  thinkingMode: 'auto' | 'disabled'
  customPrompt: string
  multiInstance: boolean
}>()

const emit = defineEmits<{
  'update:selectedModel': [value: string | null]
  'update:useResume': [value: boolean]
  'update:thinkingMode': [value: 'auto' | 'disabled']
  'update:customPrompt': [value: string]
  'update:multiInstance': [value: boolean]
}>()

const { t } = useI18n()
</script>

<template>
  <!-- Model selection — modelSelection CLIs only (T1805) -->
  <Transition
    enter-active-class="expand-enter-active"
    enter-from-class="expand-enter-from"
    enter-to-class="expand-enter-to"
    leave-active-class="expand-leave-active"
    leave-from-class="expand-leave-from"
    leave-to-class="expand-leave-to"
  >
    <div v-if="caps.modelSelection && availableModels.length > 0">
      <p class="section-title mb-2 text-body-2">{{ t('launch.model') }}</p>
      <v-select
        :model-value="selectedModel"
        :items="availableModels"
        clearable
        :placeholder="defaultModelLabel ? t('launch.modelDefaultNamed', { model: defaultModelLabel }) : t('launch.modelDefault')"
        variant="outlined"
        density="compact"
        hide-details
        :base-color="accentColor"
        :color="accentColor"
        @update:model-value="emit('update:selectedModel', $event as string | null)"
      />
      <p class="field-hint mt-1 text-caption">{{ t('launch.modelNote') }}</p>
    </div>
  </Transition>

  <!-- Resume session — convResume CLIs only (Claude) (T1036) -->
  <Transition
    enter-active-class="expand-enter-active"
    enter-from-class="expand-enter-from"
    enter-to-class="expand-enter-to"
    leave-active-class="expand-leave-active"
    leave-from-class="expand-leave-from"
    leave-to-class="expand-leave-to"
  >
    <div v-if="caps.convResume && lastConvId">
      <p class="section-title mb-2 text-body-2">{{ t('launch.prevSession') }}</p>
      <v-switch
        :model-value="useResume"
        data-testid="switch-resume"
        density="compact"
        hide-details
        :color="accentColor"
        :style="{ '--switch-accent': accentColor }"
        :label="t('launch.resume', { resume: '--resume' })"
        class="launch-switch"
        @update:model-value="emit('update:useResume', $event as boolean)"
      />
      <p class="field-hint mt-1 text-caption">{{ t('launch.resumeNote') }}</p>
    </div>
  </Transition>

  <!-- Thinking mode — thinkingMode CLIs only (Claude) (T1036) -->
  <Transition
    enter-active-class="expand-enter-active"
    enter-from-class="expand-enter-from"
    enter-to-class="expand-enter-to"
    leave-active-class="expand-leave-active"
    leave-from-class="expand-leave-from"
    leave-to-class="expand-leave-to"
  >
    <div v-if="caps.thinkingMode">
      <p class="section-title mb-2 text-body-2">{{ t('launch.thinkingMode') }}</p>
      <v-btn-toggle
        :model-value="thinkingMode"
        mandatory
        :color="accentColor"
        :style="{ '--toggle-accent': accentColor }"
        variant="outlined"
        density="compact"
        rounded="lg"
        class="w-100 launch-toggle"
        @update:model-value="emit('update:thinkingMode', $event as 'auto' | 'disabled')"
      >
        <v-btn value="auto" size="small" class="flex-1">{{ t('launch.auto') }}</v-btn>
        <v-btn value="disabled" size="small" class="flex-1">{{ t('launch.disabled') }}</v-btn>
      </v-btn-toggle>
      <p class="field-hint mt-1 text-caption">{{ t('launch.thinkingNote') }}</p>
    </div>
  </Transition>

  <!-- Custom prompt -->
  <div>
    <v-textarea
      :model-value="customPrompt"
      :label="t('launch.startPrompt')"
      :placeholder="t('launch.startPromptPlaceholder')"
      rows="3"
      auto-grow
      spellcheck="true"
      variant="outlined"
      density="compact"
      hide-details="auto"
      :base-color="accentColor"
      :color="accentColor"
      class="launch-textarea"
      @update:model-value="emit('update:customPrompt', $event as string)"
    />
    <div class="d-flex align-center ga-2 mt-2">
      <v-icon size="12" style="color: var(--content-faint); flex-shrink: 0;">mdi-information-outline</v-icon>
      <span class="field-hint text-caption" style="margin-top: 0;">{{ t('launch.promptNote') }}</span>
    </div>
  </div>

  <!-- Multi-instance toggle (ADR-006) -->
  <div>
    <v-switch
      :model-value="multiInstance"
      data-testid="switch-worktree"
      density="compact"
      hide-details
      :color="accentColor"
      :style="{ '--switch-accent': accentColor }"
      :label="t('launch.multiInstance')"
      class="launch-switch"
      @update:model-value="emit('update:multiInstance', $event as boolean)"
    />
    <p class="field-hint mt-1 text-caption">{{ t('launch.multiInstanceNote') }}</p>
    <p class="field-hint text-caption" style="font-style: italic;">
      {{ t('launch.worktreeSource', { source: worktreeSource === 'global' ? t('launch.worktreeSourceGlobal') : worktreeSource === 'agent' ? t('launch.worktreeSourceAgent') : t('launch.worktreeSourceManual') }) }}
    </p>
    <p v-if="worktreeError" class="field-hint field-hint--error text-caption">
      {{ t('launch.multiInstanceError', { error: worktreeError }) }}
    </p>
  </div>
</template>

<style scoped>
.section-title {
  font-weight: 500;
  color: var(--content-secondary);
}
.field-hint {
  color: var(--content-muted);
  margin-top: 4px;
}
.field-hint--error {
  color: rgb(var(--v-theme-error));
}

/* :deep() required — v-switch label font-size/color not exposed as props */
.launch-switch :deep(.v-label) {
  font-size: 14px;
  color: var(--content-secondary);
}
/* Switch track color — force agent hex in teleported dialog */
.launch-switch :deep(.v-selection-control--dirty .v-switch__track) {
  background-color: var(--switch-accent) !important;
}

/* :deep() required — native <textarea> inside v-textarea */
.launch-textarea :deep(textarea) {
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
}

/* v-btn-toggle active state */
.launch-toggle :deep(.v-btn--active) {
  color: var(--toggle-accent) !important;
}

/* Expand/collapse animation */
.expand-enter-active {
  transition: all var(--md-duration-short4) var(--md-easing-standard);
  overflow: hidden;
}
.expand-enter-from { opacity: 0; max-height: 0; }
.expand-enter-to   { opacity: 1; max-height: 8rem; }
.expand-leave-active {
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  overflow: hidden;
}
.expand-leave-from { opacity: 1; max-height: 8rem; }
.expand-leave-to   { opacity: 0; max-height: 0; }
</style>
