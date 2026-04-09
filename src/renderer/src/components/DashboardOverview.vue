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
import AgentBadge from './AgentBadge.vue'
import ActivityHeatmap from './ActivityHeatmap.vue'
import SessionActivityChart from './SessionActivityChart.vue'
import SuccessRateChart from './SuccessRateChart.vue'
import AgentQualityPanel from './AgentQualityPanel.vue'
import TokenTelemetryPanel from './TokenTelemetryPanel.vue'
import type { TokenStats } from './TokenTelemetryPanel.vue'
import CodeTelemetryPanel from './CodeTelemetryPanel.vue'

const WorkloadView = defineAsyncComponent(() => import('./WorkloadView.vue'))

const { t } = useI18n()
const store = useTasksStore()

// ── Types ───────────────────────────────────────────────────────────────────

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

/**
 * Fetches aggregated token stats for today, last 7 days, and all-time.
 * Handles sessions with no token data gracefully (falls back to zeros).
 * @returns Promise that resolves when all three period stats are updated.
 */
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

/**
 * Queries the number of sessions started on the current calendar day.
 * Updates `sessionsTodayCount`.
 * @returns Promise that resolves when the count is updated.
 */
async function fetchSessionsToday(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = await store.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM sessions WHERE date(started_at) = ?`,
    [today]
  )
  sessionsTodayCount.value = rows[0]?.count ?? 0
}

// ── Recent tasks (top 10 from store) ─────────────────────────────────────────
const recentTasks = computed(() =>
  [...store.tasks]
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .slice(0, 10)
)

// ── Recent activity (agent_logs) ──────────────────────────────────────────────
const recentActivity = ref<ActivityRow[]>([])

/**
 * Fetches the 10 most recent agent_logs entries (joined with agent name).
 * Updates `recentActivity`.
 * @returns Promise that resolves when activity rows are populated.
 */
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
/**
 * Runs all data fetches in parallel. No-ops when no database is connected.
 * Called on mount, every 10 s, and whenever `store.dbPath` changes.
 * @returns Promise that resolves when all fetches complete.
 */
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

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Converts an ISO date string into a compact relative time label.
 * Examples: "12s", "5m", "3h", "2d".
 * @param dateStr - ISO 8601 date string from the database.
 * @returns Human-readable relative time string.
 */
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const STATUT_LABEL = computed<Record<string, string>>(() => ({
  todo: t('status.todo'),
  in_progress: t('status.inProgress'),
  done: t('status.done'),
  archived: t('status.archived'),
}))

function statusColor(status: string): string {
  const map: Record<string, string> = {
    todo: 'default',
    in_progress: 'info',
    done: 'default',
    archived: 'default',
  }
  return map[status] ?? 'default'
}

function priorityColor(priority: string): string {
  const map: Record<string, string> = {
    low: 'rgb(var(--v-theme-content-subtle))',
    high: 'rgb(var(--v-theme-warning))',
    critical: 'rgb(var(--v-theme-error))',
  }
  return map[priority] ?? 'rgb(var(--v-theme-content-muted))'
}
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

      <!-- ── 4 Metric Cards ─────────────────────────────────────────────── -->
      <v-row class="row-16">

        <!-- Active agents -->
        <v-col cols="3">
          <v-card elevation="1" class="metric-card">
            <v-card-text class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--cyan shrink-0">
                <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-secondary))">mdi-account-group</v-icon>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ activeAgentsCount }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.activeAgents') }}</div>
                <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.sessionsStarted') }}</div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- In-progress tasks -->
        <v-col cols="3">
          <v-card elevation="1" class="metric-card">
            <v-card-text class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--amber shrink-0">
                <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-warning))">mdi-lightning-bolt</v-icon>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ store.stats.in_progress }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.inProgress') }}</div>
                <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.activeTasks') }}</div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Todo tasks -->
        <v-col cols="3">
          <v-card elevation="1" class="metric-card">
            <v-card-text class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--violet shrink-0">
                <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-primary))">mdi-clipboard-text-outline</v-icon>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ store.stats.todo }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.todo') }}</div>
                <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.pendingTasks') }}</div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Sessions today -->
        <v-col cols="3">
          <v-card elevation="1" class="metric-card">
            <v-card-text class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--emerald shrink-0">
                <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-info))">mdi-calendar-today</v-icon>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ sessionsTodayCount }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.today') }}</div>
                <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.sessionsStarted') }}</div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

      </v-row>

      <!-- ── Token telemetry (full width) ──────────────────────────────── -->
      <TokenTelemetryPanel
        :stats-today="statsToday"
        :stats-7d="stats7d"
        :stats-all="statsAll"
      />

      <!-- ── Recent tasks + activity ────────────────────────────────────── -->
      <v-row class="row-16">

        <!-- Recent tasks -->
        <v-col cols="6">
          <v-card elevation="0" class="metric-card section-card">
            <div class="section-header">
              <span class="text-body-2 font-weight-medium section-title">{{ t('dashboard.recentTasks') }}</span>
            </div>
            <v-list
              v-if="recentTasks.length > 0"
              density="compact"
              bg-color="transparent"
              class="pa-0 section-scroll"
            >
              <v-list-item
                v-for="task in recentTasks"
                :key="task.id"
                :ripple="true"
                class="task-list-item"
                @click="store.openTask(task)"
              >
                <div class="d-flex align-start ga-2 py-1">
                  <v-chip
                    size="x-small"
                    :color="statusColor(task.status)"
                    variant="tonal"
                    label
                    class="shrink-0"
                  >{{ STATUT_LABEL[task.status] ?? task.status }}</v-chip>
                  <div class="task-meta-inner">
                    <p class="text-caption text-truncate">{{ task.title }}</p>
                    <div class="d-flex align-center ga-1 mt-1">
                      <AgentBadge v-if="task.agent_name" :name="task.agent_name" />
                      <span
                        v-if="task.priority && task.priority !== 'normal'"
                        class="text-caption"
                        :style="{ color: priorityColor(task.priority) }"
                      >{{ task.priority }}</span>
                    </div>
                  </div>
                  <span class="shrink-0 text-caption text-disabled tabular-nums ml-auto">
                    {{ relativeTime(task.updated_at) }}
                  </span>
                </div>
              </v-list-item>
            </v-list>
            <div v-else class="d-flex align-center justify-center pa-8">
              <span class="text-caption text-disabled font-italic">{{ t('dashboard.noTasks') }}</span>
            </div>
          </v-card>
        </v-col>

        <!-- Recent activity -->
        <v-col cols="6">
          <v-card elevation="0" class="metric-card section-card">
            <div class="section-header">
              <span class="text-body-2 font-weight-medium section-title">{{ t('dashboard.recentActivity') }}</span>
            </div>
            <v-list
              v-if="recentActivity.length > 0"
              density="compact"
              bg-color="transparent"
              class="pa-0 section-scroll"
            >
              <v-list-item
                v-for="(entry, i) in recentActivity"
                :key="i"
                class="activity-list-item"
              >
                <div class="d-flex align-start ga-2 py-1">
                  <AgentBadge v-if="entry.agent_name" :name="entry.agent_name" class="shrink-0" />
                  <span v-else class="text-caption text-disabled agent-label shrink-0">—</span>
                  <div class="task-meta-inner">
                    <p class="text-caption font-mono">{{ entry.action }}</p>
                    <p v-if="entry.detail" class="text-caption text-medium-emphasis text-truncate mt-1">{{ entry.detail }}</p>
                  </div>
                  <span class="shrink-0 text-caption text-disabled tabular-nums ml-auto">
                    {{ relativeTime(entry.created_at) }}
                  </span>
                </div>
              </v-list-item>
            </v-list>
            <div v-else class="d-flex align-center justify-center pa-8">
              <span class="text-caption text-disabled font-italic">{{ t('dashboard.noActivity') }}</span>
            </div>
          </v-card>
        </v-col>

      </v-row>

      <!-- ── Code telemetry + Heatmap ───────────────────────────────────── -->
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

      <!-- ── Charts 14d ────────────────────────────────────────────────── -->
      <v-row class="row-16">
        <v-col cols="6" style="min-height: 200px;">
          <SessionActivityChart />
        </v-col>
        <v-col cols="6" style="min-height: 200px;">
          <SuccessRateChart />
        </v-col>
      </v-row>

      <!-- ── Quality (full width) ──────────────────────────────────────── -->
      <AgentQualityPanel />

      <!-- ── Workload (full width, lazy) ──────────────────────────────── -->
      <Suspense>
        <WorkloadView />
        <template #fallback>
          <v-card elevation="0" class="workload-fallback d-flex align-center justify-center pa-8">
            <p class="text-body-2 text-medium-emphasis">{{ t('common.loading') }}</p>
          </v-card>
        </template>
      </Suspense>

    </template>

    </div><!-- end overview-body -->
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

/* Prevent flex-shrink from squishing bottom widgets when total content height
   exceeds the container. Without this, AgentQualityPanel and WorkloadView
   get compressed to height:0 instead of the container scrolling. */
.overview-body > * {
  flex-shrink: 0;
}

/* ── Metric cards ── */
.metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}

.metric-card:hover {
  border-color: var(--edge-subtle) !important;
}

.metric-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--shape-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.metric-icon--cyan    { background-color: rgba(var(--v-theme-secondary), 0.15); }
.metric-icon--amber   { background-color: rgba(var(--v-theme-warning), 0.15); }
.metric-icon--violet  { background-color: rgba(var(--v-theme-primary), 0.15); }
.metric-icon--emerald { background-color: rgba(var(--v-theme-info), 0.15); }

.metric-svg {
  width: 16px;
  height: 16px;
}

.metric-values {
  min-width: 0;
}

.metric-sublabel {
  color: var(--content-tertiary);
}

.lh-tight {
  line-height: 1.2;
}

/* ── Section cards (recent tasks / activity / heatmap) ── */
.section-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
}

.section-title {
  color: var(--content-secondary);
}

.section-scroll {
  flex: 1;
  overflow-y: auto;
}

/* ── List item overrides ── */
.task-list-item {
  border-bottom: 1px solid var(--edge-default);
  cursor: pointer;
}

.task-list-item:last-child {
  border-bottom: none;
}

.activity-list-item {
  border-bottom: 1px solid var(--edge-default);
}

.activity-list-item:last-child {
  border-bottom: none;
}

.task-meta-inner {
  flex: 1;
  min-width: 0;
}

.agent-label {
  margin-top: 2px;
  white-space: nowrap;
}

/* ── Workload fallback ── */
.workload-fallback {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
}

/* ── Uniform 16px column gutter (matches TelemetryView) ── */
.row-16 {
  margin-left: -8px !important;
  margin-right: -8px !important;
}
.row-16 :deep(.v-col) {
  padding-left: 8px !important;
  padding-right: 8px !important;
}
</style>
