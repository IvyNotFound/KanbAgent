<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

const { t } = useI18n()
const store = useTasksStore()

interface TimelineTask {
  id: number
  titre: string
  statut: string
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

onMounted(() => {
  nowTimer = setInterval(() => { now.value = Date.now() }, 60_000)
  fetchTasks()
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})

async function fetchTasks(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  error.value = null
  try {
    const cutoff = new Date(Date.now() - daysBack.value * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
    const result = await window.electronAPI.queryDb(
      store.dbPath,
      `SELECT t.id, t.titre, t.statut, t.created_at, t.started_at, t.completed_at,
              t.effort, a.name as agentName, a.id as agentId
       FROM tasks t
       LEFT JOIN agents a ON t.agent_assigne_id = a.id
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
watch(() => store.lastRefresh, fetchTasks)
watch(daysBack, fetchTasks)

const unassignedLabel = computed(() => t('timeline.unassigned'))

const allAgents = computed(() => {
  const names = new Set(tasks.value.map(t => t.agentName ?? unassignedLabel.value))
  return [...names].sort()
})

function toggleAgent(name: string): void {
  const idx = selectedAgents.value.indexOf(name)
  if (idx >= 0) {
    selectedAgents.value.splice(idx, 1)
  } else {
    selectedAgents.value.push(name)
  }
}

function isAgentSelected(name: string): boolean {
  return selectedAgents.value.includes(name)
}

const filteredTasks = computed(() => {
  if (selectedAgents.value.length === 0) return tasks.value
  return tasks.value.filter(t => selectedAgents.value.includes(t.agentName ?? unassignedLabel.value))
})

function taskStartMs(task: TimelineTask): number {
  return new Date(task.started_at ?? task.created_at).getTime()
}

function taskEndMs(task: TimelineTask): number {
  if (task.statut === 'in_progress') return now.value
  if (task.completed_at) return new Date(task.completed_at).getTime()
  // For tasks with no end date, show at least 30 min
  return taskStartMs(task) + 1_800_000
}

const rangeStart = computed(() => {
  if (filteredTasks.value.length === 0) return Date.now() - daysBack.value * 86_400_000
  return Math.min(...filteredTasks.value.map(t => new Date(t.created_at).getTime()))
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

function statusColorClass(statut: string): string {
  switch (statut) {
    case 'in_progress': return 'bg-blue-500'
    case 'done': return 'bg-green-600'
    case 'archived': return 'bg-zinc-600'
    default: return 'bg-zinc-500'
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
  const end = task.statut === 'in_progress' ? now.value : taskEndMs(task)
  const ms = end - start
  if (ms < 0) return '—'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}j`
}

const tooltip = ref<{ task: TimelineTask; x: number; y: number } | null>(null)

function showTooltip(event: MouseEvent, task: TimelineTask): void {
  tooltip.value = { task, x: event.clientX, y: event.clientY }
}

function moveTooltip(event: MouseEvent): void {
  if (tooltip.value) {
    tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
  }
}

function hideTooltip(): void {
  tooltip.value = null
}

const legendItems = computed(() => [
  { statut: 'todo', label: t('columns.todo') },
  { statut: 'in_progress', label: t('columns.in_progress') },
  { statut: 'done', label: t('columns.done') },
  { statut: 'archived', label: t('columns.archived') },
])
</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary overflow-hidden" @mousemove="moveTooltip">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-5 py-3 border-b border-edge-subtle bg-surface-base">
      <h2 class="text-sm font-semibold text-content-secondary">{{ t('timeline.title') }}</h2>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-content-muted">{{ t('timeline.period') }}</span>
          <select
            v-model="daysBack"
            class="text-xs bg-surface-base border border-edge-subtle rounded px-2 py-1 text-content-primary focus:outline-none cursor-pointer"
          >
            <option :value="7">7j</option>
            <option :value="14">14j</option>
            <option :value="30">30j</option>
            <option :value="60">60j</option>
            <option :value="90">90j</option>
          </select>
        </div>
        <button
          class="text-xs text-content-muted hover:text-content-primary transition-colors px-2 py-1 rounded border border-edge-subtle disabled:opacity-50"
          :disabled="loading"
          @click="fetchTasks"
        >
          {{ loading ? t('common.loading') : t('common.refresh') }}
        </button>
      </div>
    </div>

    <!-- Agent filter chips -->
    <div
      v-if="allAgents.length > 0"
      class="shrink-0 flex items-center gap-2 px-5 py-2 border-b border-edge-subtle flex-wrap"
    >
      <span class="text-xs text-content-muted shrink-0">{{ t('timeline.filterAgents') }}</span>
      <button
        v-for="name in allAgents"
        :key="name"
        class="text-xs px-2 py-0.5 rounded-full border transition-colors"
        :style="isAgentSelected(name) ? { color: agentFg(name), background: agentBg(name), borderColor: agentBorder(name) } : {}"
        :class="isAgentSelected(name) ? '' : 'border-edge-subtle text-content-muted hover:border-edge-strong'"
        @click="toggleAgent(name)"
      >
        {{ name }}
      </button>
      <button
        v-if="selectedAgents.length > 0"
        class="text-xs text-content-muted hover:text-content-primary ml-1 transition-colors"
        @click="selectedAgents = []"
      >
        {{ t('timeline.clearFilter') }}
      </button>
    </div>

    <!-- Timeline body -->
    <div class="flex-1 overflow-auto">
      <div v-if="loading" class="flex items-center justify-center h-32 text-content-muted text-sm">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="error" class="flex items-center justify-center h-32 text-red-400 text-sm">
        {{ error }}
      </div>
      <div v-else-if="groups.length === 0" class="flex items-center justify-center h-32 text-content-muted text-sm">
        {{ t('timeline.noData') }}
      </div>
      <div v-else class="min-w-[700px]">
        <!-- Time axis -->
        <div class="flex border-b border-edge-subtle">
          <div class="w-36 shrink-0" />
          <div class="flex-1 relative h-8">
            <span
              v-for="tick in axisTicks"
              :key="tick.pct"
              class="absolute text-xs text-content-muted -translate-x-1/2 top-1/2 -translate-y-1/2 whitespace-nowrap"
              :style="{ left: tick.pct + '%' }"
            >{{ tick.label }}</span>
          </div>
        </div>

        <!-- Agent rows -->
        <div
          v-for="group in groups"
          :key="group.name"
          class="flex items-stretch border-b border-edge-subtle/40 hover:bg-surface-secondary/50 transition-colors"
        >
          <!-- Agent label -->
          <div class="w-36 shrink-0 flex items-center px-3 py-2 border-r border-edge-subtle/40">
            <span
              class="text-xs font-medium truncate"
              :style="{ color: agentFg(group.name) }"
            >{{ group.name }}</span>
          </div>

          <!-- Bars -->
          <div class="flex-1 relative" style="min-height: 40px;">
            <div
              v-for="task in group.tasks"
              :key="task.id"
              class="absolute top-2 h-6 rounded cursor-pointer hover:opacity-80 transition-opacity"
              :class="[statusColorClass(task.statut), task.statut === 'in_progress' ? 'animate-pulse' : '']"
              :style="{ left: barLeft(task), width: barWidth(task), minWidth: '4px' }"
              @mouseenter="showTooltip($event, task)"
              @mouseleave="hideTooltip"
            />
          </div>
        </div>

        <!-- Legend -->
        <div class="flex items-center gap-4 px-5 py-3 border-t border-edge-subtle">
          <span class="text-xs text-content-muted">{{ t('timeline.legend') }}</span>
          <div
            v-for="item in legendItems"
            :key="item.statut"
            class="flex items-center gap-1.5"
          >
            <div class="w-3 h-3 rounded-sm" :class="statusColorClass(item.statut)" />
            <span class="text-xs text-content-muted">{{ item.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="fixed z-50 bg-surface-primary border border-edge-default rounded-lg shadow-xl p-3 text-xs pointer-events-none"
        :style="{ left: (tooltip.x + 14) + 'px', top: (tooltip.y - 14) + 'px', maxWidth: '280px' }"
      >
        <div class="font-semibold text-content-primary mb-1.5 leading-snug">{{ tooltip.task.titre }}</div>
        <div class="space-y-0.5 text-content-muted">
          <div>
            {{ t('timeline.tooltipStatus') }}:
            <span
              :class="{
                'text-blue-400': tooltip.task.statut === 'in_progress',
                'text-green-400': tooltip.task.statut === 'done',
                'text-content-tertiary': tooltip.task.statut === 'todo',
              }"
            >{{ tooltip.task.statut }}</span>
          </div>
          <div>{{ t('timeline.tooltipStart') }}: {{ formatDate(tooltip.task.started_at ?? tooltip.task.created_at) }}</div>
          <div v-if="tooltip.task.completed_at">
            {{ t('timeline.tooltipEnd') }}: {{ formatDate(tooltip.task.completed_at) }}
          </div>
          <div>{{ t('timeline.tooltipDuration') }}: {{ taskDurationLabel(tooltip.task) }}</div>
          <div>{{ t('timeline.tooltipEffort') }}: {{ effortLabel(tooltip.task.effort) }}</div>
          <div class="text-content-faint mt-0.5">#{{ tooltip.task.id }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
