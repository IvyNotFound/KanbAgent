<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'

interface DayRow {
  day: string
  status: string
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
      SELECT date(started_at) as day, status, COUNT(*) as count
      FROM sessions
      WHERE started_at >= date('now', '-14 days')
        AND started_at IS NOT NULL
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

const grouped = computed<DayBars[]>(() =>
  days.value.map(day => {
    const dayRows = rows.value.filter(r => r.day === day)
    const completed = dayRows.find(r => r.status === 'completed')?.count ?? 0
    const blocked = dayRows.find(r => r.status === 'blocked')?.count ?? 0
    const started = dayRows.find(r => r.status === 'started')?.count ?? 0
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
  <v-card elevation="0" class="chart-card">
    <div class="chart-header">
      <h3 class="text-caption font-weight-semibold text-medium-emphasis">
        {{ t('sessionActivityChart.title') }}
      </h3>
    </div>
    <v-divider />
    <div class="chart-body">

      <!-- Loading -->
      <div v-if="loading" class="d-flex align-center justify-center flex-1">
        <span class="text-caption text-disabled">{{ t('sessionActivityChart.loading') }}</span>
      </div>

      <!-- Empty state -->
      <div v-else-if="isEmpty" class="d-flex align-center justify-center flex-1">
        <p class="text-caption text-disabled font-italic">{{ t('sessionActivityChart.empty') }}</p>
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
            <div v-if="day.completed > 0" class="bar bar-completed" :style="{ height: segH(day.completed) }" />
            <div v-if="day.started > 0"   class="bar bar-started"   :style="{ height: segH(day.started) }" />
            <div v-if="day.blocked > 0"   class="bar bar-blocked"   :style="{ height: segH(day.blocked) }" />
            <div v-if="day.total === 0"   class="bar bar-empty" style="height: 4px" />
          </div>
        </div>

        <!-- Date labels -->
        <div class="bars-container date-labels">
          <div
            v-for="(day, idx) in grouped"
            :key="day.date"
            class="bar-col text-center font-mono text-caption font-weight-medium"
            :class="(idx % 2 === 0 || idx === 13) ? 'date-visible' : 'date-hidden'"
          >
            {{ shortDate(day.date) }}
          </div>
        </div>

        <!-- Legend -->
        <div class="d-flex align-center ga-4 flex-wrap">
          <div class="d-flex align-center ga-2">
            <span class="legend-dot legend-dot--completed" />
            <span class="text-caption text-medium-emphasis">{{ t('status.completed') }}</span>
          </div>
          <div class="d-flex align-center ga-2">
            <span class="legend-dot legend-dot--started" />
            <span class="text-caption text-medium-emphasis">{{ t('status.started') }}</span>
          </div>
          <div class="d-flex align-center ga-2">
            <span class="legend-dot legend-dot--blocked" />
            <span class="text-caption text-medium-emphasis">{{ t('status.blocked') }}</span>
          </div>
          <span class="ml-auto text-caption text-disabled font-mono">
            {{ t('sessionActivityChart.maxPerDay', { n: maxTotal }) }}
          </span>
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
  background: var(--surface-secondary) !important;
}

.chart-header {
  flex-shrink: 0;
  padding: 12px 16px;
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
  gap: 1px;
  cursor: default;
}

.bar {
  width: 100%;
  border-radius: 2px;
  transition: height 0.2s;
}

.bar-completed { background-color: rgb(var(--v-theme-secondary)); }
.bar-started   { background-color: rgb(var(--v-theme-content-subtle)); }
.bar-blocked   { background-color: rgb(var(--v-theme-error)); }
.bar-empty     { background-color: var(--surface-tertiary); }

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

.legend-dot--completed { background-color: rgb(var(--v-theme-secondary)); }
.legend-dot--started   { background-color: rgb(var(--v-theme-content-subtle)); }
.legend-dot--blocked   { background-color: rgb(var(--v-theme-error)); }
</style>
