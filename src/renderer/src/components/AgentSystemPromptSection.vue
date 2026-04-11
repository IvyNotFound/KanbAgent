<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  systemPrompt: string
  systemPromptSuffix: string
  isEditMode: boolean
  accentColor?: string
}>()

const emit = defineEmits<{
  'update:systemPrompt': [value: string]
  'update:systemPromptSuffix': [value: string]
}>()

const { t } = useI18n()

const showPrompt = ref(false)
const sectionEl = ref<HTMLElement | null>(null)

function toggle() {
  showPrompt.value = !showPrompt.value
  if (showPrompt.value) {
    nextTick(() => {
      sectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
}

defineExpose({ toggle })
</script>

<template>
  <div ref="sectionEl" class="prompt-section">
    <div
      class="prompt-header"
      role="button"
      tabindex="0"
      @click="toggle"
      @keydown.enter="toggle"
      @keydown.space.prevent="toggle"
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
        :model-value="systemPrompt"
        rows="8"
        spellcheck="true"
        :placeholder="t('agent.systemPromptPlaceholder')"
        hide-details
        variant="outlined"
        :color="accentColor"
        :base-color="accentColor"
        @update:model-value="emit('update:systemPrompt', $event as string)"
      />
      <div v-if="isEditMode">
        <div class="field-label-subtle text-label-medium mb-1">
          {{ t('agent.hiddenSuffix') }}
          <span class="field-label-note">({{ t('agent.hiddenSuffixCode') }})</span>
        </div>
        <v-textarea
          :model-value="systemPromptSuffix"
          rows="6"
          spellcheck="true"
          :placeholder="t('agent.systemPromptSuffixPlaceholder')"
          hide-details
          variant="outlined"
          :color="accentColor"
          :base-color="accentColor"
          @update:model-value="emit('update:systemPromptSuffix', $event as string)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.field-label-subtle {
  font-size: 12px;
  color: var(--content-subtle);
}
.field-label-note {
  color: var(--content-faint);
  margin-left: 4px;
}
</style>
