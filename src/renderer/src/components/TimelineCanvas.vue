<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AgentBadge from './AgentBadge.vue'
import TimelineTooltip from './TimelineTooltip.vue'

const { t } = useI18n()

interface TimelineTask {
  id: number
  title: string
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  effort: number
  agentName: string | null
  agentId: number | null
}

interface AgentGroup {
  name: string
  tasks: TimelineTask[]
}

const props = defineProps<{
  loading: boolean
  error: string | null
  groups: AgentGroup[]
  axisTicks: Array<{ label: string; pct: number }>
  tooltipTask: TimelineTask | null
  tooltipX: number
  tooltipY: number
  now: number
  barLeft: (task: TimelineTask) => string
  barWidth: (task: TimelineTask) => string
}>()

const emit = defineEmits<{
  (e: 'show-tooltip', event: MouseEvent, task: TimelineTask): void
  (e: 'hide-tooltip'): void
}>()

const legendItems = computed(() => [
  { status: 'todo', label: t('columns.todo') },
  { status: 'in_progress', label: t('columns.in_progress') },
  { status: 'done', label: t('columns.done') },
  { status: 'archived', label: t('columns.archived') },
  { status: 'rejected', label: t('columns.rejected') },
])

function statusColorClass(status: string): string {
  switch (status) {
    case 'in_progress': return 'tl-bg-progress'
    case 'done': return 'tl-bg-done'
    case 'archived': return 'tl-bg-archived'
    case 'rejected': return 'tl-bg-rejected'
    default: return 'tl-bg-todo'
  }
}
</script>

<template>
  <div v-if="loading" class="tl-state-center">
    <v-progress-circular indeterminate :size="32" :width="3" />
  </div>
  <div v-else-if="error" class="tl-state-center tl-error text-body-2">{{ error }}</div>
  <div v-else-if="groups.length === 0" class="tl-state-center tl-muted-sm text-body-2">{{ t('timeline.noData') }}</div>
  <div v-else class="tl-canvas">
    <!-- Time axis -->
    <div class="tl-axis">
      <div class="tl-axis-spacer" />
      <div class="tl-axis-ticks">
        <span
          v-for="tick in axisTicks"
          :key="tick.pct"
          class="tl-tick text-caption"
          :style="{ left: tick.pct + '%' }"
        >{{ tick.label }}</span>
      </div>
    </div>

    <!-- Agent rows -->
    <div v-for="group in groups" :key="group.name" class="tl-row">
      <div class="tl-row-label py-2 px-3">
        <AgentBadge :name="group.name" />
      </div>
      <div class="tl-row-bars">
        <div
          v-for="task in group.tasks"
          :key="task.id"
          class="tl-bar"
          :class="[statusColorClass(task.status), task.status === 'in_progress' ? 'tl-bar--pulse' : '']"
          :style="{ left: barLeft(task), width: barWidth(task), minWidth: '4px' }"
          @mouseenter="emit('show-tooltip', $event, task)"
          @mouseleave="emit('hide-tooltip')"
        />
      </div>
    </div>
  </div>

  <!-- Legend -->
  <div v-if="!loading && !error && groups.length > 0" class="tl-legend ga-4 py-3 px-5">
    <span class="tl-muted-xs text-caption">{{ t('timeline.legend') }}</span>
    <div v-for="item in legendItems" :key="item.status" class="tl-legend-item">
      <div class="tl-legend-dot" :class="statusColorClass(item.status)" />
      <span class="tl-muted-xs text-caption">{{ item.label }}</span>
    </div>
  </div>

  <TimelineTooltip
    v-if="tooltipTask"
    :task="tooltipTask"
    :x="tooltipX"
    :y="tooltipY"
    :now="now"
  />
</template>

<style scoped>
.tl-state-center { display: flex; align-items: center; justify-content: center; height: 128px; }
.tl-error { color: rgb(var(--v-theme-error)); }
.tl-muted-xs { color: var(--content-muted); }
.tl-muted-sm { color: var(--content-muted); }

.tl-canvas { min-width: 700px; }
.tl-axis {
  display: flex;
  border-bottom: 1px solid var(--edge-subtle);
}
.tl-axis-spacer { width: 144px; flex-shrink: 0; }
.tl-axis-ticks { flex: 1; position: relative; height: 32px; }
.tl-tick {
  position: absolute;
  color: var(--content-muted);
  transform: translate(-50%, -50%);
  top: 50%;
  white-space: nowrap;
}
.tl-tick:first-child { transform: translate(0%, -50%); }
.tl-tick:last-child  { transform: translate(-100%, -50%); }

.tl-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid rgba(var(--v-theme-surface-secondary),0.4);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.tl-row:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }
.tl-row-label {
  width: 144px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-right: 1px solid rgba(var(--v-theme-surface-secondary),0.4);
}
.tl-row-bars {
  flex: 1;
  position: relative;
  min-height: 40px;
  overflow: hidden;
}
.tl-bar {
  position: absolute;
  top: 8px;
  height: 24px;
  border-radius: var(--shape-xs);
  cursor: pointer;
  transition: opacity var(--md-duration-short3) var(--md-easing-standard);
}
.tl-bar:hover { opacity: 0.8; }
.tl-bar--pulse { animation: tlPulse 2s ease-in-out infinite; }
@keyframes tlPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

.tl-bg-progress { background: rgb(var(--v-theme-primary)); }
.tl-bg-done     { background: rgb(var(--v-theme-secondary)); }
.tl-bg-todo     { background: rgba(var(--v-theme-on-surface), 0.35); }
.tl-bg-archived  { background: rgba(var(--v-theme-on-surface), 0.18); }
.tl-bg-rejected  { background: rgb(var(--v-theme-chip-rejected)); }

.tl-legend {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--edge-subtle);
}
.tl-legend-item { display: flex; align-items: center; gap: 6px; }
.tl-legend-dot { width: 12px; height: 12px; border-radius: 2px; }
</style>
