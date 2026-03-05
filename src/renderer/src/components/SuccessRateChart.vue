<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'

interface DayRow {
  day: string
  statut: string
  count: number
}

interface DayRate {
  date: string
  completed: number
  blocked: number
  rate: number | null // null = no terminal sessions (only started)
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
        AND statut IN ('completed', 'blocked')
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

const grouped = computed<DayRate[]>(() =>
  days.value.map(day => {
    const dayRows = rows.value.filter(r => r.day === day)
    const completed = dayRows.find(r => r.statut === 'completed')?.count ?? 0
    const blocked = dayRows.find(r => r.statut === 'blocked')?.count ?? 0
    const total = completed + blocked
    return {
      date: day,
      completed,
      blocked,
      rate: total > 0 ? Math.round((completed / total) * 100) : null,
    }
  })
)

const isEmpty = computed(() => grouped.value.every(d => d.rate === null))

const avgRate = computed<number | null>(() => {
  const valid = grouped.value.filter(d => d.rate !== null)
  if (valid.length === 0) return null
  return Math.round(valid.reduce((sum, d) => sum + (d.rate ?? 0), 0) / valid.length)
})

function barColor(rate: number): string {
  if (rate >= 80) return 'bg-emerald-500 dark:bg-emerald-600'
  if (rate >= 50) return 'bg-amber-400 dark:bg-amber-500'
  return 'bg-red-500 dark:bg-red-600'
}

function avgBadgeColor(rate: number): string {
  if (rate >= 80) return 'text-emerald-500 dark:text-emerald-400'
  if (rate >= 50) return 'text-amber-400 dark:text-amber-300'
  return 'text-red-500 dark:text-red-400'
}

function barH(rate: number): string {
  return `${Math.round((rate / 100) * CHART_H)}px`
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function tooltip(day: DayRate): string {
  if (day.rate === null) return `${day.date} — ${t('successRateChart.noTerminalSessions')}`
  return `${day.date} — ${day.rate}% (${day.completed} completed, ${day.blocked} blocked)`
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 px-4 py-3 gap-3 overflow-y-auto">
    <!-- Title with avg rate -->
    <div class="shrink-0 flex items-center gap-2">
      <h3 class="text-xs font-semibold text-content-secondary">
        {{ t('successRateChart.title') }}
      </h3>
      <span
        v-if="avgRate !== null"
        class="text-xs font-bold font-mono"
        :class="avgBadgeColor(avgRate)"
      >
        {{ t('successRateChart.avg', { rate: avgRate }) }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center flex-1">
      <span class="text-xs text-content-faint animate-pulse">{{ t('successRateChart.loading') }}</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="isEmpty" class="flex items-center justify-center flex-1">
      <p class="text-xs text-content-faint italic">{{ t('successRateChart.empty') }}</p>
    </div>

    <!-- Chart -->
    <template v-else>
      <!-- Bar area -->
      <div class="flex items-end gap-[3px] shrink-0" :style="{ height: `${CHART_H}px` }">
        <div
          v-for="day in grouped"
          :key="day.date"
          class="flex flex-col-reverse flex-1 cursor-default"
          :title="tooltip(day)"
        >
          <div
            v-if="day.rate !== null"
            class="w-full rounded-sm transition-all"
            :class="barColor(day.rate)"
            :style="{ height: barH(day.rate) }"
          />
          <!-- No data marker -->
          <div
            v-else
            class="w-full rounded-sm bg-surface-secondary"
            style="height: 4px"
          />
        </div>
      </div>

      <!-- Reference lines labels -->
      <div class="relative shrink-0 -mt-1">
        <div class="flex gap-[3px]">
          <div
            v-for="(day, idx) in grouped"
            :key="day.date"
            class="flex-1 text-center font-mono"
            :class="(idx % 2 === 0 || idx === 13) ? 'text-[10px] text-content-faint' : 'text-transparent'"
          >
            {{ shortDate(day.date) }}
          </div>
        </div>
      </div>

      <!-- Legend / thresholds -->
      <div class="flex items-center gap-4 shrink-0 flex-wrap">
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-sm bg-emerald-500 dark:bg-emerald-600" />
          <span class="text-[11px] text-content-faint">≥ 80%</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-sm bg-amber-400 dark:bg-amber-500" />
          <span class="text-[11px] text-content-faint">≥ 50%</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-sm bg-red-500 dark:bg-red-600" />
          <span class="text-[11px] text-content-faint">< 50%</span>
        </div>
      </div>
    </template>
  </div>
</template>
