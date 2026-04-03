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
        class="cli-refresh-btn text-caption font-weight-medium"
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
          <span class="cli-vendor text-caption font-weight-medium">{{ meta.vendor }}</span>
        </div>
        <span
          class="cli-version-badge text-caption font-weight-medium"
          :class="{ 'cli-version-badge--detected': isDetected(meta.cli) }"
        >
          {{ versionLabel(meta.cli) }}
        </span>
      </div>

      <!-- Right: toggle -->
      <v-btn
        :title="isEnabled(meta.cli) ? t('settings.cliEnabled') : t('settings.cliDisabled')"
        variant="text"
        class="cli-toggle"
        :class="{ 'cli-toggle--on': isEnabled(meta.cli) }"
        role="switch"
        :aria-checked="isEnabled(meta.cli)"
        @click="emit('toggle', meta.cli)"
      >
        <span
          class="cli-toggle-thumb elevation-1"
          :class="{ 'cli-toggle-thumb--on': isEnabled(meta.cli) }"
        />
      </v-btn>
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
  border-radius: 6px;
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
  border-radius: 4px;
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
/* Toggle switch */
.cli-toggle {
  width: 36px !important;
  min-width: 36px !important;
  height: 20px !important;
  min-height: 20px !important;
  padding: 0 !important;
  flex-shrink: 0;
  border-radius: 9999px !important;
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-tertiary) !important;
  transition: background-color 0.2s;
  overflow: hidden;
}
.cli-toggle--on {
  background: rgb(var(--v-theme-primary)) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
}
.cli-toggle-thumb {
  pointer-events: none;
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 9999px;
  background: white;
  transform: translateX(1px);
  transition: transform 0.2s;
}
.cli-toggle-thumb--on { transform: translateX(17px); }
</style>
