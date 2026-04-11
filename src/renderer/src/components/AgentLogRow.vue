<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { parseUtcDate } from '@renderer/utils/parseDate'
import AgentBadge from './AgentBadge.vue'
import type { AgentLog } from '@renderer/types'

const { t, locale } = useI18n()

type EnrichedLog = AgentLog & { parsedFiles: string[] }

const props = defineProps<{
  log: EnrichedLog
  expanded: boolean
  levelBtnColor: Record<string, string | undefined>
}>()

const emit = defineEmits<{
  (e: 'toggle', id: number): void
}>()

function formatTime(dateStr: string): string {
  const d = parseUtcDate(dateStr)
  const now = new Date()
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })
}

function absoluteTime(dateStr: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(dateStr).toLocaleString(dateLocale, {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}
</script>

<template>
  <div
    class="al-row"
    :class="log.detail || log.parsedFiles.length > 0 ? 'al-row--clickable' : ''"
    @click="(log.detail || log.parsedFiles.length > 0) && emit('toggle', log.id)"
  >
    <!-- Main line -->
    <div class="al-row-main">
      <v-chip
        :color="levelBtnColor[log.level]"
        size="x-small"
        variant="tonal"
        class="al-level-chip"
      >
        {{ log.level }}
      </v-chip>
      <span class="al-time text-label-medium" :title="absoluteTime(log.created_at)">{{ formatTime(log.created_at) }}</span>
      <AgentBadge v-if="log.agent_name" :name="log.agent_name" />
      <span v-else class="al-agent-badge al-agent-badge--none text-label-medium">—</span>
      <span class="al-action text-body-2">{{ log.action }}</span>
      <v-icon
        v-if="log.detail || log.parsedFiles.length > 0"
        class="al-chevron"
        :class="expanded ? 'al-chevron--open' : ''"
        size="12"
      >
        mdi-chevron-right
      </v-icon>
    </div>

    <!-- Expandable detail -->
    <div v-if="expanded" class="al-detail">
      <p v-if="log.detail" class="al-detail-text text-body-2">{{ log.detail }}</p>
      <div v-if="log.parsedFiles.length > 0" class="al-files">
        <span
          v-for="f in log.parsedFiles"
          :key="f"
          class="al-file-badge text-label-medium"
        >{{ f.split('/').pop() }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.al-row {
  border-bottom: 1px solid rgba(var(--v-theme-surface-tertiary),0.5);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.al-row--clickable { cursor: pointer; }
.al-row--clickable:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }

.al-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  min-width: 0;
}

.al-level-chip { flex-shrink: 0; }

.al-time {
  flex-shrink: 0;
  color: var(--content-subtle);
  font-family: ui-monospace, monospace;
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.al-agent-badge {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: var(--shape-xs);
  font-weight: 500;
}
.al-agent-badge--none { color: var(--content-dim); }
.al-action {
  font-weight: 500;
  color: var(--content-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.al-chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--content-faint);
  transition: transform var(--md-duration-short3) var(--md-easing-standard);
  margin-left: auto;
}
.al-chevron--open { transform: rotate(90deg); }

.al-detail {
  padding: 0 24px 8px;
  margin-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.al-detail-text {
  color: var(--content-tertiary);
  line-height: 1.625;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  margin: 0;
}
.al-files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.al-file-badge {
  font-family: ui-monospace, monospace;
  padding: 4px 8px;
  border-radius: var(--shape-xs);
  background: var(--surface-secondary);
  color: var(--content-subtle);
  border: 1px solid rgba(var(--v-theme-surface-tertiary),0.5);
}
</style>
