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
import { agentFg } from '@renderer/utils/agentColor'
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
  if (!store.dbPath) return
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
    done: 'success',
    archived: 'default',
  }
  return map[status] ?? 'default'
}

function priorityColor(priority: string): string {
  const map: Record<string, string> = {
    low: '#71717a',      // zinc-500
    high: '#fbbf24',     // amber-400
    critical: '#f87171', // red-400
  }
  return map[priority] ?? '#a1a1aa'
}
</script>

<template>
  <div class="overview-root">

    <!-- Title -->
    <h2 class="text-h6 font-weight-medium shrink-0">{{ t('dashboard.overview') }}</h2>

    <!-- No project state -->
    <div v-if="!store.dbPath" class="d-flex align-center justify-center" style="height: 160px;">
      <p class="text-body-2 text-medium-emphasis font-italic">{{ t('common.noProject') }}</p>
    </div>

    <template v-else>

      <!-- ── 4 Metric Cards ─────────────────────────────────────────────── -->
      <v-row dense>

        <!-- Active agents -->
        <v-col cols="3">
          <v-card elevation="0" class="metric-card">
            <div class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--cyan shrink-0">
                <svg class="metric-svg" viewBox="0 0 20 20" fill="currentColor" style="color: #22d3ee">
                  <path d="M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM17 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 0 0-1.5-4.33A5 5 0 0 1 19 16v1h-6.07zM6 11a5 5 0 0 1 5 5v1H1v-1a5 5 0 0 1 5-5z"/>
                </svg>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ activeAgentsCount }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.activeAgents') }}</div>
                <div class="metric-sublabel text-truncate">{{ t('dashboard.sessionsStarted') }}</div>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- In-progress tasks -->
        <v-col cols="3">
          <v-card elevation="0" class="metric-card">
            <div class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--amber shrink-0">
                <svg class="metric-svg" viewBox="0 0 20 20" fill="currentColor" style="color: #fbbf24">
                  <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0 1 12 2v5h4a1 1 0 0 1 .82 1.573l-7 10A1 1 0 0 1 8 18v-5H4a1 1 0 0 1-.82-1.573l7-10a1 1 0 0 1 1.12-.38z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ store.stats.in_progress }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.inProgress') }}</div>
                <div class="metric-sublabel text-truncate">{{ t('dashboard.activeTasks') }}</div>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Todo tasks -->
        <v-col cols="3">
          <v-card elevation="0" class="metric-card">
            <div class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--violet shrink-0">
                <svg class="metric-svg" viewBox="0 0 20 20" fill="currentColor" style="color: #a78bfa">
                  <path d="M9 2a1 1 0 0 0 0 2h2a1 1 0 1 0 0-2H9z"/>
                  <path fill-rule="evenodd" d="M4 5a2 2 0 0 1 2-2 3 3 0 0 0 3 3h2a3 3 0 0 0 3-3 2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm3 4a1 1 0 0 0 0 2h.01a1 1 0 1 0 0-2H7zm3 0a1 1 0 0 0 0 2h3a1 1 0 1 0 0-2h-3zm-3 4a1 1 0 1 0 0 2h.01a1 1 0 1 0 0-2H7zm3 0a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2h-3z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ store.stats.todo }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.todo') }}</div>
                <div class="metric-sublabel text-truncate">{{ t('dashboard.pendingTasks') }}</div>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Sessions today -->
        <v-col cols="3">
          <v-card elevation="0" class="metric-card">
            <div class="d-flex align-center ga-3 pa-4">
              <div class="metric-icon metric-icon--emerald shrink-0">
                <svg class="metric-svg" viewBox="0 0 20 20" fill="currentColor" style="color: #34d399">
                  <path fill-rule="evenodd" d="M6 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1V3a1 1 0 1 0-2 0v1H7V3a1 1 0 0 0-1-1zm0 5a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H6z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="metric-values">
                <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ sessionsTodayCount }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.today') }}</div>
                <div class="metric-sublabel text-truncate">{{ t('dashboard.sessionsStarted') }}</div>
              </div>
            </div>
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
      <v-row>

        <!-- Recent tasks -->
        <v-col cols="6">
          <div class="section-card">
            <div class="section-header">
              <span class="text-overline text-medium-emphasis">{{ t('dashboard.recentTasks') }}</span>
            </div>
            <div class="section-list">
              <div v-if="recentTasks.length === 0" class="d-flex align-center justify-center pa-8">
                <span class="text-caption text-disabled font-italic">{{ t('dashboard.noTasks') }}</span>
              </div>
              <div
                v-for="task in recentTasks"
                :key="task.id"
                class="task-row"
                @click="store.openTask(task)"
              >
                <v-chip
                  size="x-small"
                  :color="statusColor(task.status)"
                  variant="tonal"
                  label
                  class="shrink-0"
                >{{ STATUT_LABEL[task.status] ?? task.status }}</v-chip>

                <div class="task-meta">
                  <p class="text-caption text-truncate">{{ task.title }}</p>
                  <div class="d-flex align-center ga-1 mt-1">
                    <span
                      v-if="task.agent_name"
                      class="text-caption font-weight-medium"
                      :style="{ color: agentFg(task.agent_name) }"
                    >{{ task.agent_name }}</span>
                    <span
                      v-if="task.priority && task.priority !== 'normal'"
                      class="text-caption"
                      :style="{ color: priorityColor(task.priority) }"
                    >{{ task.priority }}</span>
                  </div>
                </div>

                <span class="shrink-0 text-caption text-disabled tabular-nums">
                  {{ relativeTime(task.updated_at) }}
                </span>
              </div>
            </div>
          </div>
        </v-col>

        <!-- Recent activity -->
        <v-col cols="6">
          <div class="section-card">
            <div class="section-header">
              <span class="text-overline text-medium-emphasis">{{ t('dashboard.recentActivity') }}</span>
            </div>
            <div class="section-list">
              <div v-if="recentActivity.length === 0" class="d-flex align-center justify-center pa-8">
                <span class="text-caption text-disabled font-italic">{{ t('dashboard.noActivity') }}</span>
              </div>
              <div
                v-for="(entry, i) in recentActivity"
                :key="i"
                class="activity-row"
              >
                <span
                  v-if="entry.agent_name"
                  class="shrink-0 text-caption font-weight-medium font-mono agent-label"
                  :style="{ color: agentFg(entry.agent_name) }"
                >{{ entry.agent_name }}</span>
                <span v-else class="shrink-0 text-caption text-disabled agent-label">—</span>

                <div class="task-meta">
                  <p class="text-caption font-mono">{{ entry.action }}</p>
                  <p v-if="entry.detail" class="text-caption text-medium-emphasis text-truncate mt-1">{{ entry.detail }}</p>
                </div>

                <span class="shrink-0 text-caption text-disabled tabular-nums">
                  {{ relativeTime(entry.created_at) }}
                </span>
              </div>
            </div>
          </div>
        </v-col>

      </v-row>

      <!-- ── Code telemetry + Heatmap ───────────────────────────────────── -->
      <v-row>
        <v-col cols="6">
          <CodeTelemetryPanel :project-path="store.projectPath" />
        </v-col>
        <v-col cols="6">
          <div class="section-card">
            <div class="section-header">
              <span class="text-overline text-medium-emphasis">{{ t('dashboard.activity') }}</span>
            </div>
            <ActivityHeatmap v-if="store.dbPath" :db-path="store.dbPath" />
          </div>
        </v-col>
      </v-row>

      <!-- ── Charts 14d ────────────────────────────────────────────────── -->
      <v-row>
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
  </div>
</template>

<style scoped>
.overview-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  padding: 24px;
  gap: 16px;
  background: var(--surface-base);
  color: var(--content-primary);
}

/* ── Metric cards ── */
.metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-secondary) !important;
  transition: border-color 0.15s;
}

.metric-card:hover {
  border-color: var(--edge-subtle) !important;
}

.metric-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.metric-icon--cyan    { background-color: rgba(6,   182, 212, 0.15); }
.metric-icon--amber   { background-color: rgba(245, 158, 11,  0.15); }
.metric-icon--violet  { background-color: rgba(139, 92,  246, 0.15); }
.metric-icon--emerald { background-color: rgba(16,  185, 129, 0.15); }

.metric-svg {
  width: 16px;
  height: 16px;
}

.metric-values {
  min-width: 0;
}

.metric-sublabel {
  font-size: 11px;
  color: var(--content-tertiary);
}

.lh-tight {
  line-height: 1.2;
}

/* ── Section cards (recent tasks / activity / heatmap) ── */
.section-card {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  overflow: hidden;
  height: 100%;
}

.section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
}

.section-list {
  flex: 1;
  overflow-y: auto;
}

/* ── Task rows ── */
.task-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-default);
  cursor: pointer;
  transition: background-color 0.15s;
}

.task-row:last-child {
  border-bottom: none;
}

.task-row:hover {
  background-color: var(--surface-tertiary);
}

.task-meta {
  flex: 1;
  min-width: 0;
}

/* ── Activity rows ── */
.activity-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-default);
}

.activity-row:last-child {
  border-bottom: none;
}

.agent-label {
  margin-top: 2px;
}

/* ── Workload fallback ── */
.workload-fallback {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-secondary) !important;
}
</style>
