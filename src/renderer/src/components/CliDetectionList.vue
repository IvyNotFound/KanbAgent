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
      <button
        :disabled="loading"
        class="cli-refresh-btn"
        @click="emit('refresh')"
      >
        <!-- spinner while loading -->
        <v-progress-circular v-if="loading" class="cli-icon" indeterminate :size="14" :width="2" />
        <v-icon v-else class="cli-icon" size="14">mdi-refresh</v-icon>
        {{ loading ? t('settings.cliRefreshing') : t('settings.cliRefresh') }}
      </button>
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
          <span class="cli-label">{{ meta.label }}</span>
          <span class="cli-vendor">{{ meta.vendor }}</span>
        </div>
        <span
          class="cli-version-badge"
          :class="{ 'cli-version-badge--detected': isDetected(meta.cli) }"
        >
          {{ versionLabel(meta.cli) }}
        </span>
      </div>

      <!-- Right: toggle -->
      <button
        :title="isEnabled(meta.cli) ? t('settings.cliEnabled') : t('settings.cliDisabled')"
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
      </button>
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
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-subtle);
  border-radius: 6px;
  color: var(--content-muted);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.cli-refresh-btn:hover:not(:disabled) {
  background: var(--surface-tertiary);
  color: var(--content-primary);
}
.cli-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
  font-size: 13px;
  font-weight: 500;
  color: var(--content-primary);
  line-height: 1.2;
}
.cli-vendor {
  font-size: 10px;
  color: var(--content-subtle);
  line-height: 1.2;
}
.cli-version-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
  background: var(--surface-tertiary);
  color: var(--content-faint);
  border: 1px solid var(--edge-subtle);
}
.cli-version-badge--detected {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border-color: rgba(16, 185, 129, 0.3);
}
/* Toggle switch */
.cli-toggle {
  position: relative;
  display: inline-flex;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 9999px;
  border: 1px solid var(--edge-default);
  background: var(--surface-tertiary);
  cursor: pointer;
  transition: background-color 0.2s;
}
.cli-toggle--on {
  background: #6d28d9;
  border-color: #6d28d9;
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
