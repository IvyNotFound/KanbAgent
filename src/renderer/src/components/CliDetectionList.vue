<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CliType, CliInstance } from '@shared/cli-types'

const props = defineProps<{
  instances: CliInstance[]
  enabled: CliType[]
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'toggle', cli: CliType): void
}>()

const { t } = useI18n()

interface CliMeta {
  cli: CliType
  label: string
  vendor: string
}

const CLI_META: CliMeta[] = [
  { cli: 'claude',    label: 'Claude Code',   vendor: 'Anthropic' },
  { cli: 'codex',     label: 'Codex CLI',     vendor: 'OpenAI' },
  { cli: 'gemini',    label: 'Gemini CLI',    vendor: 'Google' },
  { cli: 'opencode',  label: 'OpenCode',      vendor: 'SST' },
  { cli: 'aider',     label: 'Aider',         vendor: 'Paul Gauthier' },
  { cli: 'goose',     label: 'Goose',         vendor: 'Block' },
]

function instancesFor(cli: CliType): CliInstance[] {
  return props.instances.filter(i => i.cli === cli)
}

function versionLabel(cli: CliType): string {
  const found = instancesFor(cli)
  if (found.length === 0) return t('settings.cliNotDetected')
  const v = found[0].version
  const count = found.length
  return count > 1 ? `v${v} (×${count})` : `v${v}`
}

function isDetected(cli: CliType): boolean {
  return instancesFor(cli).length > 0
}

function isEnabled(cli: CliType): boolean {
  return props.enabled.includes(cli)
}
</script>

<template>
  <div class="cli-list">
    <!-- Refresh button -->
    <div class="cli-refresh-row">
      <v-btn
        color="primary"
        :disabled="loading"
        class="cli-refresh-btn"
        @click="emit('refresh')"
      >
        <!-- spinner while loading -->
        <v-progress-circular v-if="loading" class="cli-icon" indeterminate :size="14" :width="2" />
        <v-icon v-else class="cli-icon" size="14">mdi-refresh</v-icon>
        {{ loading ? t('settings.cliRefreshing') : t('settings.cliRefresh') }}
      </v-btn>
    </div>

    <!-- CLI rows -->
    <div
      v-for="meta in CLI_META"
      :key="meta.cli"
      class="cli-row"
    >
      <!-- Left: name + vendor + version badge -->
      <div class="cli-row-left">
        <div class="cli-labels">
          <span class="cli-label text-caption">{{ meta.label }}</span>
          <span class="cli-vendor text-label-medium">{{ meta.vendor }}</span>
        </div>
        <span
          class="cli-version-badge text-label-medium"
          :class="{ 'cli-version-badge--detected': isDetected(meta.cli) }"
        >
          {{ versionLabel(meta.cli) }}
        </span>
      </div>

      <!-- Right: v-switch MD3 toggle -->
      <v-switch
        :model-value="isEnabled(meta.cli)"
        color="primary"
        hide-details
        density="compact"
        class="flex-grow-0"
        @update:model-value="emit('toggle', meta.cli)"
      />
    </div>
  </div>
</template>

<style scoped>
.cli-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cli-refresh-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.cli-refresh-btn {
  gap: 6px;
}
.cli-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.cli-icon--spin { animation: cli-spin 1s linear infinite; }
@keyframes cli-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.cli-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--shape-xs);
  background: var(--surface-secondary);
  border: 1px solid var(--edge-subtle);
}
.cli-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cli-labels {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cli-label {
  font-weight: 500;
  color: var(--content-primary);
  line-height: 1.2;
}
.cli-vendor {
  color: var(--content-subtle);
  line-height: 1.2;
}
.cli-version-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: var(--shape-xs);
  font-weight: 500;
  flex-shrink: 0;
  background: var(--surface-tertiary);
  color: var(--content-faint);
  border: 1px solid var(--edge-subtle);
}
.cli-version-badge--detected {
  background: rgba(var(--v-theme-secondary), 0.15);
  color: rgb(var(--v-theme-secondary));
  border-color: rgba(var(--v-theme-secondary), 0.3);
}
</style>
