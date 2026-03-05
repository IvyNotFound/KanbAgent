<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'

interface DayRow {
  day: string
  statut: string
  count: number
}

interface DayBars {
  date: string
  completed: number
  blocked: number
  started: number
  total: number
}

const CHART_H = 144 // px

const { t } = useI18n()
const store = useTasksStore()
const rows = ref<DayRow[]>([])
const loading = ref(false)

async function fetchData(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  try {
    const result = await window.electronAPI.queryDb(store.dbPath, `
      SELECT date(started_at) as day, statut, COUNT(*) as count
      FROM sessions
      WHERE started_at >= date('now', '-14 days')
        AND started_at IS NOT NULL
      GROUP BY day, statut
      ORDER BY day
    `)
    rows.value = result as DayRow[]
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchData)
watch(() => store.dbPath, fetchData)

function last14Days(): string[] {
  const days: string[] = []
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

const days = computed<string[]>(() => last14Days())

const grouped = computed<DayBars[]>(() =>
  days.value.map(day => {
    const dayRows = rows.value.filter(r => r.day === day)
    const completed = dayRows.find(r => r.statut === 'completed')?.count ?? 0
    const blocked = dayRows.find(r => r.statut === 'blocked')?.count ?? 0
    const started = dayRows.find(r => r.statut === 'started')?.count ?? 0
    return { date: day, completed, blocked, started, total: completed + blocked + started }
  })
)

const maxTotal = computed(() => Math.max(...grouped.value.map(d => d.total), 1))
const isEmpty = computed(() => grouped.value.every(d => d.total === 0))

function segH(count: number): string {
  return `${Math.round((count / maxTotal.value) * CHART_H)}px`
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function tooltip(day: DayBars): string {
  return `${day.date} — ${day.total} session(s): ${day.completed} completed, ${day.blocked} blocked, ${day.started} started`
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 px-4 py-3 gap-3 overflow-y-auto">
    <h3 class="shrink-0 text-xs font-semibold text-content-secondary">
      {{ t('sessionActivityChart.title') }}
    </h3>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center flex-1">
      <span class="text-xs text-content-faint animate-pulse">{{ t('sessionActivityChart.loading') }}</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="isEmpty" class="flex items-center justify-center flex-1">
      <p class="text-xs text-content-faint italic">{{ t('sessionActivityChart.empty') }}</p>
    </div>

    <!-- Chart -->
    <template v-else>
      <!-- Bar area -->
      <div class="flex items-end gap-[3px] shrink-0" :style="{ height: `${CHART_H}px` }">
        <div
          v-for="day in grouped"
          :key="day.date"
          class="flex flex-col-reverse flex-1 gap-[1px] cursor-default"
          :title="tooltip(day)"
        >
          <div
            v-if="day.completed > 0"
            class="w-full rounded-sm bg-emerald-500 dark:bg-emerald-600 transition-all"
            :style="{ height: segH(day.completed) }"
          />
          <div
            v-if="day.started > 0"
            class="w-full rounded-sm bg-zinc-400 dark:bg-zinc-500 transition-all"
            :style="{ height: segH(day.started) }"
          />
          <div
            v-if="day.blocked > 0"
            class="w-full rounded-sm bg-red-500 dark:bg-red-600 transition-all"
            :style="{ height: segH(day.blocked) }"
          />
          <!-- Empty spacer for days with no data -->
          <div
            v-if="day.total === 0"
            class="w-full rounded-sm bg-surface-secondary"
            style="height: 4px"
          />
        </div>
      </div>

      <!-- Date labels -->
      <div class="flex gap-[3px] shrink-0">
        <div
          v-for="(day, idx) in grouped"
          :key="day.date"
          class="flex-1 text-center font-mono"
          :class="(idx % 2 === 0 || idx === 13) ? 'text-[10px] text-content-faint' : 'text-transparent'"
        >
          {{ shortDate(day.date) }}
        </div>
      </div>

      <!-- Legend -->
      <div class="flex items-center gap-4 shrink-0 flex-wrap">
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-sm bg-emerald-500 dark:bg-emerald-600" />
          <span class="text-[11px] text-content-faint">Completed</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-sm bg-zinc-400 dark:bg-zinc-500" />
          <span class="text-[11px] text-content-faint">Started</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-sm bg-red-500 dark:bg-red-600" />
          <span class="text-[11px] text-content-faint">Blocked</span>
        </div>
        <span class="ml-auto text-[11px] text-content-faint font-mono">
          {{ t('sessionActivityChart.maxPerDay', { n: maxTotal }) }}
        </span>
      </div>
    </template>
  </div>
</template>
