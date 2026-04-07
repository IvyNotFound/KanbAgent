<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'

interface DayRow {
  day: string
  status: string
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
      SELECT date(started_at) as day, status, COUNT(*) as count
      FROM sessions
      WHERE started_at >= date('now', '-14 days')
        AND started_at IS NOT NULL
        AND status IN ('completed', 'blocked')
      GROUP BY day, status
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
    const completed = dayRows.find(r => r.status === 'completed')?.count ?? 0
    const blocked = dayRows.find(r => r.status === 'blocked')?.count ?? 0
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

function barClass(rate: number): string {
  if (rate >= 80) return 'bar-high'
  if (rate >= 50) return 'bar-mid'
  return 'bar-low'
}

function avgBadgeStyle(rate: number): string {
  if (rate >= 80) return 'rgb(var(--v-theme-secondary))'
  if (rate >= 50) return 'rgb(var(--v-theme-warning))'
  return 'rgb(var(--v-theme-error))'
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
  <v-card elevation="0" class="chart-card">
    <!-- Title with avg rate -->
    <div class="chart-header d-flex align-center ga-2">
      <h3 class="text-body-2 font-weight-medium chart-title">
        {{ t('successRateChart.title') }}
      </h3>
      <span
        v-if="avgRate !== null"
        class="text-caption font-weight-bold font-mono"
        :data-rate-level="avgRate >= 80 ? 'high' : avgRate >= 50 ? 'mid' : 'low'"
        :style="{ color: avgBadgeStyle(avgRate) }"
      >
        {{ t('successRateChart.avg', { rate: avgRate }) }}
      </span>
    </div>
    <div class="chart-body">

      <!-- Loading -->
      <div v-if="loading" class="d-flex align-center justify-center flex-1">
        <span class="text-caption text-disabled">{{ t('successRateChart.loading') }}</span>
      </div>

      <!-- Empty state -->
      <div v-else-if="isEmpty" class="d-flex align-center justify-center flex-1">
        <p class="text-caption text-disabled font-italic">{{ t('successRateChart.empty') }}</p>
      </div>

      <!-- Chart -->
      <template v-else>
        <!-- Bar area -->
        <div class="bars-container" :style="{ height: `${CHART_H}px` }">
          <div
            v-for="day in grouped"
            :key="day.date"
            class="bar-col"
            :title="tooltip(day)"
          >
            <div
              v-if="day.rate !== null"
              class="bar"
              :class="barClass(day.rate)"
              :style="{ height: barH(day.rate) }"
            />
            <!-- No data marker -->
            <div v-else class="bar bar-empty" style="height: 4px" />
          </div>
        </div>

        <!-- Date labels -->
        <div class="bars-container date-labels">
          <div
            v-for="(day, idx) in grouped"
            :key="day.date"
            class="bar-col text-center font-mono text-label-medium"
            :class="(idx % 2 === 0 || idx === 13) ? 'date-visible' : 'date-hidden'"
          >
            {{ shortDate(day.date) }}
          </div>
        </div>

        <!-- Legend / thresholds -->
        <div class="d-flex align-center ga-4 flex-wrap">
          <div class="d-flex align-center ga-2">
            <span class="legend-dot legend-dot--high" />
            <span class="text-caption text-medium-emphasis">≥ 80%</span>
          </div>
          <div class="d-flex align-center ga-2">
            <span class="legend-dot legend-dot--mid" />
            <span class="text-caption text-medium-emphasis">≥ 50%</span>
          </div>
          <div class="d-flex align-center ga-2">
            <span class="legend-dot legend-dot--low" />
            <span class="text-caption text-medium-emphasis">&lt; 50%</span>
          </div>
        </div>
      </template>

    </div>
  </v-card>
</template>

<style scoped>
.chart-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--edge-default);
  overflow: hidden;
  background: var(--surface-primary) !important;
}

.chart-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
}

.chart-title {
  color: var(--content-secondary);
  margin: 0;
}

.chart-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 12px;
  overflow-y: auto;
}

.bars-container {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}

.bar-col {
  display: flex;
  flex-direction: column-reverse;
  flex: 1;
  cursor: default;
}

.bar {
  width: 100%;
  border-radius: 2px;
  transition: height var(--md-duration-short4) var(--md-easing-standard);
}

.bar-high  { background-color: rgb(var(--v-theme-secondary)); }
.bar-mid   { background-color: rgb(var(--v-theme-warning)); }
.bar-low   { background-color: rgb(var(--v-theme-error)); }
.bar-empty { background-color: var(--surface-tertiary); }

.date-labels {
  height: auto !important;
  align-items: flex-start;
}

.date-visible {
color: var(--content-faint);
}

.date-hidden {
  color: transparent;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-dot--high { background-color: rgb(var(--v-theme-secondary)); }
.legend-dot--mid  { background-color: rgb(var(--v-theme-warning)); }
.legend-dot--low  { background-color: rgb(var(--v-theme-error)); }
</style>
