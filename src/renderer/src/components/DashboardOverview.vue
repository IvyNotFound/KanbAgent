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

const STATUT_CLASSES: Record<string, string> = {
  todo: 'bg-zinc-600/30 text-zinc-400 border-zinc-600/40',
  in_progress: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  archived: 'bg-zinc-700/30 text-zinc-500 border-zinc-700/40',
}

const PRIORITY_CLASSES: Record<string, string> = {
  low: 'text-zinc-500',
  normal: 'text-zinc-400',
  high: 'text-amber-400',
  critical: 'text-red-400',
}
</script>

<template>
  <div class="flex flex-col h-full overflow-auto bg-surface-base text-content-primary p-6 gap-6">

    <!-- Title -->
    <h2 class="text-xl font-semibold text-content-primary shrink-0">{{ t('dashboard.overview') }}</h2>

    <!-- No project state -->
    <div v-if="!store.dbPath" class="flex items-center justify-center h-40">
      <p class="text-sm text-content-faint italic">{{ t('common.noProject') }}</p>
    </div>

    <template v-else>

      <!-- ── 4 Metric Cards ──────────────────────────────────────────────── -->
      <div class="grid grid-cols-4 gap-4">

        <!-- Agents actifs -->
        <div class="flex items-center gap-3 p-4 rounded-lg bg-surface-secondary border border-edge-default hover:border-edge-subtle transition-colors">
          <div class="shrink-0 w-8 h-8 rounded-md bg-cyan-500/15 flex items-center justify-center">
            <!-- users icon -->
            <svg class="w-4 h-4 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM17 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 0 0-1.5-4.33A5 5 0 0 1 19 16v1h-6.07zM6 11a5 5 0 0 1 5 5v1H1v-1a5 5 0 0 1 5-5z"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-xl font-bold text-content-primary tabular-nums leading-tight">
              {{ activeAgentsCount }}
            </div>
            <div class="text-xs text-content-secondary truncate">{{ t('dashboard.activeAgents') }}</div>
            <div class="text-[11px] text-content-tertiary truncate">{{ t('dashboard.sessionsStarted') }}</div>
          </div>
        </div>

        <!-- Tâches in_progress -->
        <div class="flex items-center gap-3 p-4 rounded-lg bg-surface-secondary border border-edge-default hover:border-edge-subtle transition-colors">
          <div class="shrink-0 w-8 h-8 rounded-md bg-amber-500/15 flex items-center justify-center">
            <!-- lightning icon -->
            <svg class="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0 1 12 2v5h4a1 1 0 0 1 .82 1.573l-7 10A1 1 0 0 1 8 18v-5H4a1 1 0 0 1-.82-1.573l7-10a1 1 0 0 1 1.12-.38z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-xl font-bold text-content-primary tabular-nums leading-tight">
              {{ store.stats.in_progress }}
            </div>
            <div class="text-xs text-content-secondary truncate">{{ t('dashboard.inProgress') }}</div>
            <div class="text-[11px] text-content-tertiary truncate">{{ t('dashboard.activeTasks') }}</div>
          </div>
        </div>

        <!-- Tâches todo -->
        <div class="flex items-center gap-3 p-4 rounded-lg bg-surface-secondary border border-edge-default hover:border-edge-subtle transition-colors">
          <div class="shrink-0 w-8 h-8 rounded-md bg-violet-500/15 flex items-center justify-center">
            <!-- clipboard icon -->
            <svg class="w-4 h-4 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 2a1 1 0 0 0 0 2h2a1 1 0 1 0 0-2H9z"/>
              <path fill-rule="evenodd" d="M4 5a2 2 0 0 1 2-2 3 3 0 0 0 3 3h2a3 3 0 0 0 3-3 2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm3 4a1 1 0 0 0 0 2h.01a1 1 0 1 0 0-2H7zm3 0a1 1 0 0 0 0 2h3a1 1 0 1 0 0-2h-3zm-3 4a1 1 0 1 0 0 2h.01a1 1 0 1 0 0-2H7zm3 0a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2h-3z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-xl font-bold text-content-primary tabular-nums leading-tight">
              {{ store.stats.todo }}
            </div>
            <div class="text-xs text-content-secondary truncate">{{ t('dashboard.todo') }}</div>
            <div class="text-[11px] text-content-tertiary truncate">{{ t('dashboard.pendingTasks') }}</div>
          </div>
        </div>

        <!-- Sessions aujourd'hui -->
        <div class="flex items-center gap-3 p-4 rounded-lg bg-surface-secondary border border-edge-default hover:border-edge-subtle transition-colors">
          <div class="shrink-0 w-8 h-8 rounded-md bg-emerald-500/15 flex items-center justify-center">
            <!-- calendar icon -->
            <svg class="w-4 h-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M6 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1V3a1 1 0 1 0-2 0v1H7V3a1 1 0 0 0-1-1zm0 5a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H6z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-xl font-bold text-content-primary tabular-nums leading-tight">
              {{ sessionsTodayCount }}
            </div>
            <div class="text-xs text-content-secondary truncate">{{ t('dashboard.today') }}</div>
            <div class="text-[11px] text-content-tertiary truncate">{{ t('dashboard.sessionsStarted') }}</div>
          </div>
        </div>

      </div>

      <!-- ── Token telemetry (full width) ──────────────────────────────── -->
      <TokenTelemetryPanel
        :stats-today="statsToday"
        :stats-7d="stats7d"
        :stats-all="statsAll"
      />

      <!-- ── 2 Sections ──────────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 gap-4">

        <!-- Tâches récentes -->
        <div class="flex flex-col rounded-lg bg-surface-secondary border border-edge-default overflow-hidden">
          <div class="shrink-0 px-4 py-2.5 border-b border-edge-default">
            <span class="text-xs text-content-muted uppercase tracking-wide">{{ t('dashboard.recentTasks') }}</span>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div
              v-if="recentTasks.length === 0"
              class="flex items-center justify-center py-8"
            >
              <span class="text-xs text-content-faint italic">{{ t('dashboard.noTasks') }}</span>
            </div>
            <div
              v-for="task in recentTasks"
              :key="task.id"
              class="flex items-start gap-2 px-4 py-2 border-b border-edge-default/50 last:border-0 hover:bg-surface-tertiary/30 cursor-pointer transition-colors"
              @click="store.openTask(task)"
            >
              <!-- Statut badge -->
              <span
                class="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium border"
                :class="STATUT_CLASSES[task.status] ?? STATUT_CLASSES.todo"
              >{{ STATUT_LABEL[task.status] ?? task.status }}</span>

              <!-- Title + meta -->
              <div class="flex-1 min-w-0">
                <p class="text-xs text-content-primary truncate leading-tight">{{ task.title }}</p>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span
                    v-if="task.agent_name"
                    class="text-[11px] font-medium truncate"
                    :style="{ color: agentFg(task.agent_name) }"
                  >{{ task.agent_name }}</span>
                  <span v-if="task.priority && task.priority !== 'normal'" class="text-[11px]" :class="PRIORITY_CLASSES[task.priority]">{{ task.priority }}</span>
                </div>
              </div>

              <!-- Time -->
              <span class="shrink-0 text-[11px] text-content-faint tabular-nums">
                {{ relativeTime(task.updated_at) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Activité récente -->
        <div class="flex flex-col rounded-lg bg-surface-secondary border border-edge-default overflow-hidden">
          <div class="shrink-0 px-4 py-2.5 border-b border-edge-default">
            <span class="text-xs text-content-muted uppercase tracking-wide">{{ t('dashboard.recentActivity') }}</span>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div
              v-if="recentActivity.length === 0"
              class="flex items-center justify-center py-8"
            >
              <span class="text-xs text-content-faint italic">{{ t('dashboard.noActivity') }}</span>
            </div>
            <div
              v-for="(entry, i) in recentActivity"
              :key="i"
              class="flex items-start gap-2 px-4 py-2 border-b border-edge-default/50 last:border-0"
            >
              <!-- Agent badge -->
              <span
                v-if="entry.agent_name"
                class="shrink-0 text-[11px] font-medium font-mono mt-0.5"
                :style="{ color: agentFg(entry.agent_name) }"
              >{{ entry.agent_name }}</span>
              <span v-else class="shrink-0 text-[11px] text-content-faint mt-0.5">—</span>

              <!-- Action + detail -->
              <div class="flex-1 min-w-0">
                <p class="text-xs text-content-primary font-mono">{{ entry.action }}</p>
                <p v-if="entry.detail" class="text-[11px] text-content-secondary truncate mt-0.5">{{ entry.detail }}</p>
              </div>

              <!-- Time -->
              <span class="shrink-0 text-[11px] text-content-faint tabular-nums">
                {{ relativeTime(entry.created_at) }}
              </span>
            </div>
          </div>
        </div>

      </div>

      <!-- ── Code telemetry + Heatmap (2 columns) ────────────────────── -->
      <div class="grid grid-cols-2 gap-4">
        <CodeTelemetryPanel :project-path="store.projectPath" />
        <div class="rounded-lg bg-surface-secondary border border-edge-default overflow-hidden">
          <div class="shrink-0 px-4 py-2.5 border-b border-edge-default">
            <span class="text-xs text-content-muted uppercase tracking-wide">{{ t('dashboard.activity') }}</span>
          </div>
          <ActivityHeatmap v-if="store.dbPath" :db-path="store.dbPath" />
        </div>
      </div>

      <!-- ── Charts 14d (2 columns) ────────────────────────────────────── -->
      <div class="grid grid-cols-2 gap-4">
        <SessionActivityChart class="min-h-[200px]" />
        <SuccessRateChart class="min-h-[200px]" />
      </div>

      <!-- ── Quality (full width) ───────────────────────────────────────── -->
      <AgentQualityPanel />

      <!-- ── Workload (full width, lazy) ───────────────────────────────── -->
      <Suspense>
        <WorkloadView />
        <template #fallback>
          <div class="flex items-center justify-center py-8 rounded-lg bg-surface-secondary border border-edge-default">
            <p class="text-sm text-content-faint animate-pulse">{{ t('common.loading') }}</p>
          </div>
        </template>
      </Suspense>

    </template>
  </div>
</template>
