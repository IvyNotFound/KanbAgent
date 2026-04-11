/**
 * DashboardOverview — Landing sub-tab of DashboardView.
 *
 * Displays 4 real-time metric cards (active agents, in-progress tasks, todo tasks,
 * sessions today) alongside recent tasks, recent agent_logs activity, an activity
 * heatmap, 14-day session/success charts, agent quality panel, and workload view.
 * Data is polled every 10 seconds.
 */
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import ActivityHeatmap from './ActivityHeatmap.vue'
import SessionActivityChart from './SessionActivityChart.vue'
import SuccessRateChart from './SuccessRateChart.vue'
import AgentQualityPanel from './AgentQualityPanel.vue'
import TokenTelemetryPanel from './TokenTelemetryPanel.vue'
import type { TokenStats } from './TokenTelemetryPanel.vue'
import CodeTelemetryPanel from './CodeTelemetryPanel.vue'
import DashboardMetricCards from './DashboardMetricCards.vue'
import DashboardRecentPanel from './DashboardRecentPanel.vue'

const WorkloadView = defineAsyncComponent(() => import('./WorkloadView.vue'))

const { t } = useI18n()
const store = useTasksStore()

interface ActivityRow {
  created_at: string
  action: string
  detail: string | null
  agent_name: string | null
}

// ── Token telemetry ───────────────────────────────────────────────────────────

const EMPTY_STATS: TokenStats = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, session_count: 0 }
const statsToday = ref<TokenStats>({ ...EMPTY_STATS })
const stats7d = ref<TokenStats>({ ...EMPTY_STATS })
const statsAll = ref<TokenStats>({ ...EMPTY_STATS })

async function fetchTokenStats(): Promise<void> {
  if (!store.dbPath) return
  const SQL = `SELECT
    COALESCE(SUM(tokens_in), 0)          AS tokens_in,
    COALESCE(SUM(tokens_out), 0)         AS tokens_out,
    COALESCE(SUM(tokens_cache_read), 0)  AS tokens_cache_read,
    COALESCE(SUM(tokens_cache_write), 0) AS tokens_cache_write,
    COUNT(*)                             AS session_count
  FROM sessions`
  const [today, d7, all] = await Promise.all([
    store.query<TokenStats>(`${SQL} WHERE date(started_at) = date('now') AND (tokens_in > 0 OR tokens_out > 0)`),
    store.query<TokenStats>(`${SQL} WHERE started_at >= datetime('now', '-7 days') AND (tokens_in > 0 OR tokens_out > 0)`),
    store.query<TokenStats>(`${SQL} WHERE tokens_in > 0 OR tokens_out > 0`),
  ])
  statsToday.value = (today ?? [])[0] ?? { ...EMPTY_STATS }
  stats7d.value = (d7 ?? [])[0] ?? { ...EMPTY_STATS }
  statsAll.value = (all ?? [])[0] ?? { ...EMPTY_STATS }
}

// ── Metric: active agents ────────────────────────────────────────────────────
const activeAgentsCount = computed(() =>
  store.agents.filter(a => a.session_status === 'started').length
)

// ── Metric: sessions today ────────────────────────────────────────────────────
const sessionsTodayCount = ref(0)

async function fetchSessionsToday(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = await store.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM sessions WHERE date(started_at) = ?`,
    [today]
  )
  sessionsTodayCount.value = rows[0]?.count ?? 0
}

// ── Recent activity (agent_logs) ──────────────────────────────────────────────
const recentActivity = ref<ActivityRow[]>([])

async function fetchActivity(): Promise<void> {
  const rows = await store.query<ActivityRow>(`
    SELECT al.created_at, al.action, al.detail, a.name as agent_name
    FROM agent_logs al
    LEFT JOIN agents a ON a.id = al.agent_id
    ORDER BY al.created_at DESC
    LIMIT 10
  `)
  recentActivity.value = rows
}

// ── Load + polling ────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  if (!store.dbPath || document.visibilityState === 'hidden') return
  await Promise.all([fetchSessionsToday(), fetchActivity(), fetchTokenStats()])
}

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  load()
  pollTimer = setInterval(load, 10000)
})

onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
})

watch(() => store.dbPath, (val) => { if (val) load() })

</script>

<template>
  <div class="overview-root">
    <!-- Fixed header -->
    <div class="overview-header">
      <h2 class="text-h6 font-weight-medium overview-title">{{ t('dashboard.overview') }}</h2>
    </div>

    <!-- Scrollable body -->
    <div class="overview-body">
      <!-- No project state -->
      <div v-if="!store.dbPath" class="d-flex align-center justify-center" style="height: 160px;">
        <p class="text-body-2 text-medium-emphasis font-italic">{{ t('common.noProject') }}</p>
      </div>

      <template v-else>
        <!-- 4 Metric Cards -->
        <DashboardMetricCards
          :active-agents-count="activeAgentsCount"
          :in-progress-count="store.stats.in_progress"
          :todo-count="store.stats.todo"
          :sessions-today-count="sessionsTodayCount"
        />

        <!-- Token telemetry (full width) -->
        <TokenTelemetryPanel
          :stats-today="statsToday"
          :stats-7d="stats7d"
          :stats-all="statsAll"
        />

        <!-- Recent tasks + activity (extracted) -->
        <DashboardRecentPanel :recent-activity="recentActivity" />

        <!-- Code telemetry + Heatmap -->
        <v-row class="row-16">
          <v-col cols="6">
            <CodeTelemetryPanel :project-path="store.projectPath" />
          </v-col>
          <v-col cols="6">
            <v-card elevation="0" class="metric-card section-card">
              <div class="section-header">
                <span class="text-body-2 font-weight-medium section-title">{{ t('dashboard.activity') }}</span>
              </div>
              <ActivityHeatmap v-if="store.dbPath" :db-path="store.dbPath" />
            </v-card>
          </v-col>
        </v-row>

        <!-- Charts 14d -->
        <v-row class="row-16">
          <v-col cols="6" style="min-height: 200px;">
            <SessionActivityChart />
          </v-col>
          <v-col cols="6" style="min-height: 200px;">
            <SuccessRateChart />
          </v-col>
        </v-row>

        <!-- Quality (full width) -->
        <AgentQualityPanel />

        <!-- Workload (full width, lazy) -->
        <Suspense>
          <WorkloadView />
          <template #fallback>
            <v-card elevation="0" class="workload-fallback d-flex align-center justify-center pa-8">
              <p class="text-body-2 text-medium-emphasis">{{ t('common.loading') }}</p>
            </v-card>
          </template>
        </Suspense>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overview-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-base);
  color: var(--content-primary);
}

.overview-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}

.overview-title {
  margin: 0;
  color: var(--content-primary);
}

.overview-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overview-body > * {
  flex-shrink: 0;
}

.metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}
.metric-card:hover {
  border-color: var(--edge-subtle) !important;
}

.workload-fallback {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
}

</style>
