<script setup lang="ts">
import { useI18n } from 'vue-i18n'

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

const props = defineProps<{
  task: TimelineTask
  x: number
  y: number
  now: number
}>()

function taskStartMs(task: TimelineTask): number {
  return new Date(task.started_at ?? task.created_at).getTime()
}

function taskEndMs(task: TimelineTask): number {
  if (task.status === 'in_progress') return props.now
  if (task.completed_at) return new Date(task.completed_at).getTime()
  return taskStartMs(task) + 1_800_000
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function taskDurationLabel(task: TimelineTask): string {
  const start = taskStartMs(task)
  const end = task.status === 'in_progress' ? props.now : taskEndMs(task)
  const ms = end - start
  if (ms < 0) return '—'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}j`
}

function effortLabel(effort: number): string {
  return (['', 'S', 'M', 'L'] as const)[effort] ?? '?'
}
</script>

<template>
  <Teleport to="body">
    <div
      class="tl-tooltip elevation-2 pa-3 text-caption"
      :style="{ left: (x + 14) + 'px', top: (y - 14) + 'px' }"
    >
      <div class="tl-tooltip-title">{{ task.title }}</div>
      <div class="tl-tooltip-body">
        <div>
          {{ t('timeline.tooltipStatus') }}:
          <span :class="{
            'tl-status-progress': task.status === 'in_progress',
            'tl-status-done': task.status === 'done',
            'tl-status-todo': task.status === 'todo',
          }">{{ task.status }}</span>
        </div>
        <div>{{ t('timeline.tooltipStart') }}: {{ formatDate(task.started_at ?? task.created_at) }}</div>
        <div v-if="task.completed_at">{{ t('timeline.tooltipEnd') }}: {{ formatDate(task.completed_at) }}</div>
        <div>{{ t('timeline.tooltipDuration') }}: {{ taskDurationLabel(task) }}</div>
        <div>{{ t('timeline.tooltipEffort') }}: {{ effortLabel(task.effort) }}</div>
        <div class="tl-tooltip-id">#{{ task.id }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tl-tooltip {
  position: fixed;
  z-index: 50;
  background: var(--surface-base);
  border: 1px solid var(--edge-default);
  border-radius: var(--shape-sm);
  pointer-events: none;
  max-width: 280px;
}
.tl-tooltip-title { font-weight: 600; color: var(--content-primary); margin-bottom: 6px; line-height: 1.4; }
.tl-tooltip-body { color: var(--content-muted); display: flex; flex-direction: column; gap: 2px; }
.tl-tooltip-id { color: var(--content-faint); margin-top: 2px; }
.tl-status-progress { color: rgb(var(--v-theme-primary)); }
.tl-status-done { color: rgb(var(--v-theme-secondary)); }
.tl-status-todo { color: var(--content-tertiary); }
</style>
