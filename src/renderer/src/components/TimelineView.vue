<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentAccent } from '@renderer/utils/agentColor'

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
const daysBack = ref(180) // DB fetch range — not the zoom level
const now = ref(Date.now())

// Viewport: defines the visible time window (independent of the fetch range)
const viewportStart = ref<number>(now.value - 7 * 86_400_000)
const viewportEnd = ref<number>(now.value)
const viewportDuration = computed(() => viewportEnd.value - viewportStart.value)

// Period chip presets — tracks the last clicked preset for visual state only
const selectedPeriod = ref<number>(7)

function setViewportPeriod(days: number): void {
  selectedPeriod.value = days
  viewportEnd.value = now.value
  viewportStart.value = now.value - days * 86_400_000
}

let nowTimer: ReturnType<typeof setInterval> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

// Drag pan state
const bodyRef = ref<HTMLElement | null>(null)
let dragStartX = 0
let dragStartViewportStart = 0
let isDragging = false

function onMouseDown(event: MouseEvent): void {
  dragStartX = event.clientX
  dragStartViewportStart = viewportStart.value
  isDragging = true
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(event: MouseEvent): void {
  if (!isDragging || !bodyRef.value) return
  const canvasWidth = bodyRef.value.clientWidth - 144 // subtract label column width
  if (canvasWidth <= 0) return
  const pxPerMs = canvasWidth / viewportDuration.value
  const deltaMs = -(event.clientX - dragStartX) / pxPerMs
  viewportStart.value = dragStartViewportStart + deltaMs
  viewportEnd.value = viewportStart.value + viewportDuration.value
}

function onMouseUp(): void {
  isDragging = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

onMounted(() => {
  nowTimer = setInterval(() => { now.value = Date.now() }, 60_000)
  refreshTimer = setInterval(fetchTasks, 60_000)
  fetchTasks()
  window.addEventListener('blur', onMouseUp)
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('blur', onMouseUp)
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

// Expand DB fetch range if the user pans/zooms beyond fetched data
watch(viewportStart, (newStart) => {
  const cutoff = now.value - daysBack.value * 86_400_000
  if (newStart < cutoff) {
    const daysNeeded = Math.ceil((now.value - newStart) / 86_400_000)
    daysBack.value = Math.min(Math.max(daysNeeded + 30, daysBack.value), 365)
  }
})

const periodItems = computed(() => [
  { title: '1d', value: 1 },
  { title: '3d', value: 3 },
  { title: '7d', value: 7 },
  { title: '14d', value: 14 },
  { title: '30d', value: 30 },
  { title: '60d', value: 60 },
  { title: '90d', value: 90 },
  { title: '180d', value: 180 },
])

function onCanvasWheel(event: WheelEvent): void {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  // Compute cursor fraction within the bars area (skip 144px label column)
  const cursorX = event.clientX - rect.left - 144
  const barsWidth = rect.width - 144
  const cursorFraction = barsWidth > 0 ? Math.max(0, Math.min(1, cursorX / barsWidth)) : 0.5
  const cursorTime = viewportStart.value + cursorFraction * viewportDuration.value
  const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
  const newDuration = Math.min(
    Math.max(viewportDuration.value * factor, 60_000),  // min: 1 minute
    365 * 86_400_000                                    // max: 1 year
  )
  viewportStart.value = cursorTime - cursorFraction * newDuration
  viewportEnd.value = cursorTime + (1 - cursorFraction) * newDuration
}

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

const isHourly = computed(() => viewportDuration.value < 2 * 86_400_000)
const isWeekly = computed(() => viewportDuration.value > 60 * 86_400_000)

const axisTicks = computed(() => {
  const ticks: { label: string; pct: number }[] = []
  const count = 7
  for (let i = 0; i <= count; i++) {
    const ts = viewportStart.value + (viewportDuration.value / count) * i
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
  return ((taskStartMs(task) - viewportStart.value) / viewportDuration.value * 100).toFixed(3) + '%'
}

function barWidth(task: TimelineTask): string {
  const w = Math.max((taskEndMs(task) - taskStartMs(task)) / viewportDuration.value * 100, 0.3)
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
    <v-card elevation="0" class="section-card">
      <!-- Header -->
      <div class="section-header">
        <span class="text-body-2 font-weight-medium section-title">{{ t('timeline.title') }}</span>
        <div class="ml-auto">
          <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loading" :title="t('common.refresh')" @click="fetchTasks" />
        </div>
      </div>

      <!-- Filters bar — period presets (zoom shortcuts) + agent filter chips -->
      <div class="tl-filters py-2 px-4">
        <!-- Period presets: clicking resets the viewport to that range -->
        <v-chip-group v-model="selectedPeriod" mandatory class="flex-shrink-0">
        <v-chip
          v-for="item in periodItems"
          :key="item.value"
          :value="item.value"
          size="small"
          filter
          variant="tonal"
          @click="setViewportPeriod(item.value)"
        >
          {{ item.title }}
        </v-chip>
      </v-chip-group>

      <!-- Separator + agent filter chips -->
      <template v-if="allAgents.length > 0">
        <div class="tl-filter-sep" />
        <span class="tl-filter-label text-caption flex-shrink-0">{{ t('timeline.filterAgents') }}</span>
        <v-chip-group v-model="selectedAgents" multiple>
          <v-chip
            v-for="name in allAgents"
            :key="name"
            :value="name"
            size="small"
            filter
            variant="tonal"
            :color="agentAccent(name)"
          >
            {{ name }}
          </v-chip>
        </v-chip-group>
        <v-btn v-if="selectedAgents.length > 0" variant="text" size="small" class="flex-shrink-0" @click="selectedAgents = []">
          {{ t('timeline.clearFilter') }}
        </v-btn>
      </template>
    </div>

    <!-- Timeline body — wheel zooms viewport continuously, mousedown pans -->
    <div ref="bodyRef" class="tl-body" @wheel.prevent="onCanvasWheel" @mousedown="onMouseDown">
      <div v-if="loading" class="tl-state-center">
        <v-progress-circular indeterminate :size="32" :width="3" />
      </div>
      <div v-else-if="error" class="tl-state-center tl-error text-body-2">{{ error }}</div>
      <div v-else-if="groups.length === 0" class="tl-state-center tl-muted-sm text-body-2">{{ t('timeline.noData') }}</div>
      <div v-else class="tl-canvas">
        <!-- Time axis — reflects visible viewport in real time -->
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
            <span class="tl-agent-name text-caption" :style="{ color: agentAccent(group.name) }">{{ group.name }}</span>
          </div>
          <!-- overflow:hidden clips bars that extend outside the viewport -->
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
      </div>
    </div>

    <!-- Legend — outside scrollable canvas so it stays visible when body is scrolled -->
    <div v-if="!loading && !error && groups.length > 0" class="tl-legend ga-4 py-3 px-5">
      <span class="tl-muted-xs text-caption">{{ t('timeline.legend') }}</span>
      <div v-for="item in legendItems" :key="item.status" class="tl-legend-item">
        <div class="tl-legend-dot" :class="statusColorClass(item.status)" />
        <span class="tl-muted-xs text-caption">{{ item.label }}</span>
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
    </v-card>
  </div>
</template>

<style scoped>
.tl-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-base);
  overflow: hidden;
  padding: 16px;
}
.section-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title { color: var(--content-secondary); }

.tl-filters {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-wrap: nowrap;
  overflow-x: auto;
}
.tl-filter-label { color: var(--content-muted); }
.tl-filter-sep {
  width: 1px;
  height: 20px;
  background: var(--edge-subtle);
  flex-shrink: 0;
  align-self: center;
  margin: 0 4px;
}
.tl-muted-xs { color: var(--content-muted); }
.tl-muted-sm { color: var(--content-muted); }

.tl-body {
  flex: 1;
  overflow: auto;
  cursor: grab;
  user-select: none;
}
.tl-body:active { cursor: grabbing; }
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
/* Prevent first/last tick labels from being clipped at the canvas edges */
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
.tl-agent-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Status colors — todo/archived use on-surface alpha for visibility in both themes */
.tl-bg-progress { background: rgb(var(--v-theme-primary)); }
.tl-bg-done     { background: rgb(var(--v-theme-secondary)); }
.tl-bg-todo     { background: rgba(var(--v-theme-on-surface), 0.35); }
.tl-bg-archived { background: rgba(var(--v-theme-on-surface), 0.18); }

/* Legend — flex-shrink:0 keeps it fixed at the bottom, outside the scrollable canvas */
.tl-legend {
  flex-shrink: 0;
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
