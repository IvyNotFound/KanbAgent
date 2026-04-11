<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
import TimelineCanvas from './TimelineCanvas.vue'

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
const daysBack = ref(180)
const now = ref(Date.now())

// Viewport: defines the visible time window
const viewportStart = ref<number>(now.value - 7 * 86_400_000)
const viewportEnd = ref<number>(now.value)
const viewportDuration = computed(() => viewportEnd.value - viewportStart.value)

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
  const canvasWidth = bodyRef.value.clientWidth - 144
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
  nowTimer = setInterval(() => { if (document.visibilityState !== 'hidden') now.value = Date.now() }, 60_000)
  refreshTimer = setInterval(() => { if (document.visibilityState !== 'hidden') fetchTasks() }, 60_000)
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
  const cursorX = event.clientX - rect.left - 144
  const barsWidth = rect.width - 144
  const cursorFraction = barsWidth > 0 ? Math.max(0, Math.min(1, cursorX / barsWidth)) : 0.5
  const cursorTime = viewportStart.value + cursorFraction * viewportDuration.value
  const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
  const newDuration = Math.min(
    Math.max(viewportDuration.value * factor, 60_000),
    365 * 86_400_000
  )
  viewportStart.value = cursorTime - cursorFraction * newDuration
  viewportEnd.value = cursorTime + (1 - cursorFraction) * newDuration
}

const unassignedLabel = computed(() => t('timeline.unassigned'))

const allAgents = computed(() => {
  const names = new Set(tasks.value.map(t => t.agentName || unassignedLabel.value))
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

</script>

<template>
  <div class="tl-view" @mousemove="moveTooltip">
    <!-- Header -->
    <div class="tl-header">
      <h2 class="text-h6 font-weight-medium tl-title flex-shrink-0">{{ t('timeline.title') }}</h2>
      <div class="ml-auto flex-shrink-0">
        <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loading" :title="t('common.refresh')" @click="fetchTasks" />
      </div>
    </div>

    <!-- Filter bar -->
    <div class="tl-filter-bar">
      <v-btn-toggle v-model="selectedPeriod" mandatory density="compact" variant="outlined" class="tl-period-toggle flex-shrink-0">
        <v-btn
          v-for="item in periodItems"
          :key="item.value"
          :value="item.value"
          size="x-small"
          class="text-label-medium"
          @click="setViewportPeriod(item.value)"
        >
          {{ item.title }}
        </v-btn>
      </v-btn-toggle>
      <template v-if="allAgents.length > 0">
        <div class="tl-filter-sep" />
        <span class="tl-filter-label text-caption flex-shrink-0">{{ t('timeline.filterAgents') }}</span>
        <v-chip-group v-model="selectedAgents" multiple>
          <v-chip
            v-for="name in allAgents"
            :key="name"
            :value="name"
            variant="outlined"
            size="small"
            :style="selectedAgents.includes(name)
              ? { color: agentFg(name), backgroundColor: agentBg(name), borderColor: agentFg(name) + '66' }
              : {}"
          >
            {{ name }}
          </v-chip>
        </v-chip-group>
        <v-btn v-if="selectedAgents.length > 0" variant="text" size="small" class="flex-shrink-0" @click="selectedAgents = []">
          {{ t('timeline.clearFilter') }}
        </v-btn>
      </template>
    </div>

    <!-- Body -->
    <div class="tl-body-wrapper">
      <v-card elevation="0" class="section-card">
        <div ref="bodyRef" class="tl-body" @wheel.prevent="onCanvasWheel" @mousedown="onMouseDown">
          <TimelineCanvas
            :loading="loading"
            :error="error"
            :groups="groups"
            :axis-ticks="axisTicks"
            :tooltip-task="tooltipTask"
            :tooltip-x="tooltipX"
            :tooltip-y="tooltipY"
            :now="now"
            :bar-left="barLeft"
            :bar-width="barWidth"
            @show-tooltip="showTooltip"
            @hide-tooltip="hideTooltip"
          />
        </div>
      </v-card>
    </div>
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
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.tl-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.tl-title {
  margin: 0;
  color: var(--content-primary);
}
.tl-body-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
.tl-period-toggle { height: 28px; }
.tl-filter-label { color: var(--content-muted); }
.tl-filter-sep {
  width: 1px;
  height: 20px;
  background: var(--edge-subtle);
  flex-shrink: 0;
  align-self: center;
  margin: 0 4px;
}

.tl-body {
  flex: 1;
  overflow: auto;
  cursor: grab;
  user-select: none;
}
.tl-body:active { cursor: grabbing; }
</style>
