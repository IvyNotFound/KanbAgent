<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

const { t } = useI18n()
const store = useTasksStore()

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

const tasks = ref<TimelineTask[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selectedAgents = ref<string[]>([])
const daysBack = ref(30)
const now = ref(Date.now())

let nowTimer: ReturnType<typeof setInterval> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  nowTimer = setInterval(() => { now.value = Date.now() }, 60_000)
  // Poll every 60s while tab is open instead of reacting to every lastRefresh (T1116)
  refreshTimer = setInterval(fetchTasks, 60_000)
  fetchTasks()
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
  if (refreshTimer) clearInterval(refreshTimer)
})

async function fetchTasks(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  error.value = null
  try {
    const cutoff = new Date(Date.now() - daysBack.value * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
    const result = await window.electronAPI.queryDb(
      store.dbPath,
      `SELECT t.id, t.title, t.status, t.created_at, t.started_at, t.completed_at,
              t.effort, a.name as agentName, a.id as agentId
       FROM tasks t
       LEFT JOIN agents a ON t.agent_assigned_id = a.id
       WHERE t.created_at >= ?
       ORDER BY a.name, t.created_at`,
      [cutoff]
    ) as TimelineTask[]
    tasks.value = result
  } catch (e) {
    error.value = String(e)
    tasks.value = []
  } finally {
    loading.value = false
  }
}

watch(() => store.dbPath, fetchTasks)
watch(daysBack, fetchTasks)

const periodItems = computed(() => [
  { title: '7d', value: 7 },
  { title: '14d', value: 14 },
  { title: '30d', value: 30 },
  { title: '60d', value: 60 },
  { title: '90d', value: 90 },
])

const unassignedLabel = computed(() => t('timeline.unassigned'))

const allAgents = computed(() => {
  const names = new Set(tasks.value.map(t => t.agentName ?? unassignedLabel.value))
  return [...names].sort()
})

const filteredTasks = computed(() => {
  if (selectedAgents.value.length === 0) return tasks.value
  return tasks.value.filter(t => selectedAgents.value.includes(t.agentName ?? unassignedLabel.value))
})

function taskStartMs(task: TimelineTask): number {
  return new Date(task.started_at ?? task.created_at).getTime()
}

function taskEndMs(task: TimelineTask): number {
  if (task.status === 'in_progress') return now.value
  if (task.completed_at) return new Date(task.completed_at).getTime()
  // For tasks with no end date, show at least 30 min
  return taskStartMs(task) + 1_800_000
}

const rangeStart = computed(() => {
  if (filteredTasks.value.length === 0) return Date.now() - daysBack.value * 86_400_000
  return filteredTasks.value.reduce(
    (min, t) => Math.min(min, new Date(t.created_at).getTime()),
    Infinity
  )
})

const rangeEnd = computed(() => {
  return Math.max(now.value, rangeStart.value + 3_600_000)
})

const rangeDuration = computed(() => Math.max(rangeEnd.value - rangeStart.value, 1))

const isHourly = computed(() => rangeDuration.value < 2 * 86_400_000)
const isWeekly = computed(() => rangeDuration.value > 60 * 86_400_000)

const axisTicks = computed(() => {
  const ticks: { label: string; pct: number }[] = []
  const count = 7
  for (let i = 0; i <= count; i++) {
    const ts = rangeStart.value + (rangeDuration.value / count) * i
    const d = new Date(ts)
    let label: string
    if (isHourly.value) {
      label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (isWeekly.value) {
      label = d.toLocaleDateString([], { day: '2-digit', month: 'short' })
    } else {
      label = d.toLocaleDateString([], { day: '2-digit', month: 'short' })
    }
    ticks.push({ label, pct: (i / count) * 100 })
  }
  return ticks
})

const groups = computed((): AgentGroup[] => {
  const map = new Map<string, TimelineTask[]>()
  for (const task of filteredTasks.value) {
    const key = task.agentName ?? unassignedLabel.value
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(task)
  }
  return [...map.entries()].map(([name, taskList]) => ({ name, tasks: taskList }))
})

function barLeft(task: TimelineTask): string {
  const start = Math.max(taskStartMs(task), rangeStart.value)
  return ((start - rangeStart.value) / rangeDuration.value * 100).toFixed(3) + '%'
}

function barWidth(task: TimelineTask): string {
  const start = Math.max(taskStartMs(task), rangeStart.value)
  const end = Math.min(taskEndMs(task), rangeEnd.value)
  const w = Math.max((end - start) / rangeDuration.value * 100, 0.3)
  return w.toFixed(3) + '%'
}

function statusColorClass(status: string): string {
  switch (status) {
    case 'in_progress': return 'tl-bg-progress'
    case 'done': return 'tl-bg-done'
    case 'archived': return 'tl-bg-archived'
    default: return 'tl-bg-todo'
  }
}

function effortLabel(effort: number): string {
  return (['', 'S', 'M', 'L'] as const)[effort] ?? '?'
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function taskDurationLabel(task: TimelineTask): string {
  const start = taskStartMs(task)
  const end = task.status === 'in_progress' ? now.value : taskEndMs(task)
  const ms = end - start
  if (ms < 0) return '—'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}j`
}

const tooltipTask = ref<TimelineTask | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)

function showTooltip(event: MouseEvent, task: TimelineTask): void {
  tooltipTask.value = task
  tooltipX.value = event.clientX
  tooltipY.value = event.clientY
}

function moveTooltip(event: MouseEvent): void {
  if (tooltipTask.value) {
    tooltipX.value = event.clientX
    tooltipY.value = event.clientY
  }
}

function hideTooltip(): void {
  tooltipTask.value = null
}

const legendItems = computed(() => [
  { status: 'todo', label: t('columns.todo') },
  { status: 'in_progress', label: t('columns.in_progress') },
  { status: 'done', label: t('columns.done') },
  { status: 'archived', label: t('columns.archived') },
])
</script>

<template>
  <div class="tl-view" @mousemove="moveTooltip">
    <!-- Header -->
    <div class="tl-header">
      <h2 class="tl-title text-h6 font-weight-medium">{{ t('timeline.title') }}</h2>
      <div class="tl-header-controls">
        <v-select
          v-model="daysBack"
          :items="periodItems"
          density="compact"
          variant="outlined"
          :hide-details="true"
          style="max-width: 160px;"
        />
        <v-btn variant="text" size="small" :loading="loading" prepend-icon="mdi-refresh" @click="fetchTasks">
          {{ t('common.refresh') }}
        </v-btn>
      </div>
    </div>

    <!-- Agent filter chips -->
    <div v-if="allAgents.length > 0" class="tl-filters py-2 px-4">
      <span class="tl-filter-label text-caption">{{ t('timeline.filterAgents') }}</span>
      <v-chip-group v-model="selectedAgents" multiple>
        <v-chip
          v-for="name in allAgents"
          :key="name"
          :value="name"
          size="small"
          variant="outlined"
          :style="selectedAgents.includes(name) ? { color: agentFg(name), background: agentBg(name), borderColor: agentBorder(name) } : {}"
        >{{ name }}</v-chip>
      </v-chip-group>
      <v-btn v-if="selectedAgents.length > 0" variant="text" size="small" @click="selectedAgents = []">
        {{ t('timeline.clearFilter') }}
      </v-btn>
    </div>

    <!-- Timeline body -->
    <div class="tl-body">
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
        <div
          v-for="group in groups"
          :key="group.name"
          class="tl-row"
        >
          <div class="tl-row-label py-2 px-3">
            <span class="tl-agent-name text-caption" :style="{ color: agentFg(group.name) }">{{ group.name }}</span>
          </div>
          <div class="tl-row-bars">
            <div
              v-for="task in group.tasks"
              :key="task.id"
              class="tl-bar"
              :class="[statusColorClass(task.status), task.status === 'in_progress' ? 'tl-bar--pulse' : '']"
              :style="{ left: barLeft(task), width: barWidth(task), minWidth: '4px' }"
              @mouseenter="showTooltip($event, task)"
              @mouseleave="hideTooltip"
            />
          </div>
        </div>

        <!-- Legend -->
        <div class="tl-legend ga-4 py-3 px-5">
          <span class="tl-muted-xs text-caption">{{ t('timeline.legend') }}</span>
          <div v-for="item in legendItems" :key="item.status" class="tl-legend-item">
            <div class="tl-legend-dot" :class="statusColorClass(item.status)" />
            <span class="tl-muted-xs text-caption">{{ item.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltipTask"
        class="tl-tooltip elevation-2 pa-3 text-caption"
        :style="{ left: (tooltipX + 14) + 'px', top: (tooltipY - 14) + 'px' }"
      >
        <div class="tl-tooltip-title">{{ tooltipTask.title }}</div>
        <div class="tl-tooltip-body">
          <div>
            {{ t('timeline.tooltipStatus') }}:
            <span :class="{
              'tl-status-progress': tooltipTask.status === 'in_progress',
              'tl-status-done': tooltipTask.status === 'done',
              'tl-status-todo': tooltipTask.status === 'todo',
            }">{{ tooltipTask.status }}</span>
          </div>
          <div>{{ t('timeline.tooltipStart') }}: {{ formatDate(tooltipTask.started_at ?? tooltipTask.created_at) }}</div>
          <div v-if="tooltipTask.completed_at">{{ t('timeline.tooltipEnd') }}: {{ formatDate(tooltipTask.completed_at) }}</div>
          <div>{{ t('timeline.tooltipDuration') }}: {{ taskDurationLabel(tooltipTask) }}</div>
          <div>{{ t('timeline.tooltipEffort') }}: {{ effortLabel(tooltipTask.effort) }}</div>
          <div class="tl-tooltip-id">#{{ tooltipTask.id }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tl-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-base);
  overflow: hidden;
}
.tl-header {
  height: 44px;
  padding: 0 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--edge-subtle);
}
.tl-title { color: var(--content-primary); margin: 0; }
.tl-header-controls { display: flex; align-items: center; gap: 12px; }

.tl-filters {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-wrap: wrap;
}
.tl-filter-label { color: var(--content-muted); flex-shrink: 0; }
.tl-muted-xs { color: var(--content-muted); }
.tl-muted-sm { color: var(--content-muted); }

.tl-body { flex: 1; overflow: auto; }
.tl-state-center { display: flex; align-items: center; justify-content: center; height: 128px; }
.tl-error { color: rgb(var(--v-theme-error)); }

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
.tl-agent-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-row-bars { flex: 1; position: relative; min-height: 40px; }
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

/* status colors */
.tl-bg-progress { background: rgb(var(--v-theme-primary)); }
.tl-bg-done     { background: rgb(var(--v-theme-secondary)); }
.tl-bg-archived { background: rgb(var(--v-theme-content-faint)); }
.tl-bg-todo     { background: rgb(var(--v-theme-content-subtle)); }

.tl-legend {
  display: flex;
  align-items: center;
  border-top: 1px solid var(--edge-subtle);
}
.tl-legend-item { display: flex; align-items: center; gap: 6px; }
.tl-legend-dot { width: 12px; height: 12px; border-radius: 2px; }

/* tooltip */
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
