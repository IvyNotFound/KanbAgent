/**
 * Composable for token stats data fetching, computation, and formatting.
 * Extracted from TokenStatsView.vue to keep the component under 400 lines.
 *
 * @module composables/useTokenStats
 */

import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { usePolledData } from '@renderer/composables/usePolledData'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'

export interface AgentTokenRow {
  agent_id: number
  agent_name: string | null
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  total: number
  session_count: number
}

export interface SessionTokenRow {
  id: number
  agent_id: number
  agent_name: string
  started_at: string
  ended_at: string | null
  status: string
  cli_type: string | null
  cost_usd: number | null
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  total: number
}

export interface PeriodStats {
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  total: number
  session_count: number
}

export interface SparkDay {
  day: string
  total: number
}

// ── Period selector ───────────────────────────────────────────────────────────

export const PERIODS = [
  { key: '1h',  labelKey: 'tokenStats.period.1h',  sql: "datetime('now', '-1 hour')" },
  { key: '24h', labelKey: 'tokenStats.period.24h', sql: "datetime('now', '-24 hours')" },
  { key: '7d',  labelKey: 'tokenStats.period.7d',  sql: "datetime('now', '-7 days')" },
  { key: '30d', labelKey: 'tokenStats.period.30d', sql: "datetime('now', '-30 days')" },
  { key: 'all', labelKey: 'tokenStats.period.all', sql: null },
] as const

export type PeriodKey = (typeof PERIODS)[number]['key']

// ── Pricing constants (Anthropic Sonnet 4.6 — last checked 2026-02-27)
// See: https://www.anthropic.com/pricing
const PRICING = {
  input:       3.00,   // $ per 1M tokens
  output:      15.00,  // $ per 1M tokens
  cache_read:  0.30,   // $ per 1M tokens
  cache_write: 3.75,   // $ per 1M tokens
} as const

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString()
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return '< $0.01'
  return '$' + usd.toFixed(2)
}

/**
 * Returns the cost in USD for a session row, or null when no estimate is available.
 *
 * Priority:
 * 1. cost_usd from DB (populated by the CLI when it reports the cost directly)
 * 2. Anthropic Sonnet 4.6 pricing for Claude sessions (cli_type='claude' or legacy null)
 * 3. null for all other CLIs without a direct cost_usd
 */
export function estimateSessionCost(row: SessionTokenRow): number | null {
  if (row.cost_usd != null) return row.cost_usd
  if (row.cli_type === 'claude' || row.cli_type == null) {
    return (
      row.tokens_in        * PRICING.input       +
      row.tokens_out       * PRICING.output      +
      row.tokens_cache_read  * PRICING.cache_read  +
      row.tokens_cache_write * PRICING.cache_write
    ) / 1_000_000
  }
  return null
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function loadSavedPeriod(): PeriodKey {
  try {
    const v = localStorage.getItem('tokenStats.period') as PeriodKey | null
    if (v && PERIODS.some(p => p.key === v)) return v
  } catch { /* ignore */ }
  return '24h'
}

function whereClause(periodSql: string | null): string {
  return periodSql ? `WHERE started_at >= ${periodSql}` : ''
}

function andOrWhere(periodSql: string | null, extraCondition: string): string {
  return periodSql
    ? `WHERE started_at >= ${periodSql} AND ${extraCondition}`
    : `WHERE ${extraCondition}`
}

// ── Composable ────────────────────────────────────────────────────────────────

export interface AgentStyle { color: string; backgroundColor: string; boxShadow: string }

export function useTokenStats() {
  const { t, locale } = useI18n()
  const store = useTasksStore()
  const tabsStore = useTabsStore()

  const selectedPeriod = ref<PeriodKey>(loadSavedPeriod())
  const activePeriod = computed(() => PERIODS.find(p => p.key === selectedPeriod.value) ?? PERIODS[1])
  const costPeriod = computed((): 'day' | 'week' | 'month' => {
    if (selectedPeriod.value === '1h' || selectedPeriod.value === '24h') return 'day'
    if (selectedPeriod.value === '7d') return 'week'
    return 'month'
  })

  const globalStats = ref<PeriodStats>({ tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0, session_count: 0 })
  const agentRows = ref<AgentTokenRow[]>([])
  const sessionRows = ref<SessionTokenRow[]>([])
  const sparkDays = ref<SparkDay[]>([])

  async function fetchStats(): Promise<void> {
    if (!store.dbPath) return
    const where = whereClause(activePeriod.value.sql)
    try {
      const [globalRes, agentRes, sessionRes, sparkRes] = await Promise.all([
        window.electronAPI.queryDb(
          store.dbPath,
          `SELECT COALESCE(SUM(tokens_in),0) as tokens_in,
                  COALESCE(SUM(tokens_out),0) as tokens_out,
                  COALESCE(SUM(tokens_cache_read),0) as tokens_cache_read,
                  COALESCE(SUM(tokens_cache_write),0) as tokens_cache_write,
                  COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)),0) as total,
                  COUNT(*) as session_count
           FROM sessions
           ${where}`,
        ) as Promise<PeriodStats[]>,
        window.electronAPI.queryDb(
          store.dbPath,
          `SELECT s.agent_id,
                  a.name as agent_name,
                  COALESCE(SUM(s.tokens_in),0) as tokens_in,
                  COALESCE(SUM(s.tokens_out),0) as tokens_out,
                  COALESCE(SUM(s.tokens_cache_read),0) as tokens_cache_read,
                  COALESCE(SUM(s.tokens_cache_write),0) as tokens_cache_write,
                  COALESCE(SUM(COALESCE(s.tokens_in,0) + COALESCE(s.tokens_out,0)),0) as total,
                  COUNT(s.id) as session_count
           FROM sessions s
           LEFT JOIN agents a ON a.id = s.agent_id
           ${where}
           GROUP BY s.agent_id
           ORDER BY total DESC`,
        ) as Promise<AgentTokenRow[]>,
        window.electronAPI.queryDb(
          store.dbPath,
          `SELECT s.id, s.agent_id,
                  a.name as agent_name,
                  s.started_at, s.ended_at, s.status,
                  s.cli_type,
                  s.cost_usd,
                  COALESCE(s.tokens_in, 0) as tokens_in,
                  COALESCE(s.tokens_out, 0) as tokens_out,
                  COALESCE(s.tokens_cache_read, 0) as tokens_cache_read,
                  COALESCE(s.tokens_cache_write, 0) as tokens_cache_write,
                  (COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0)) as total
           FROM sessions s
           LEFT JOIN agents a ON a.id = s.agent_id
           ${andOrWhere(activePeriod.value.sql, '(COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0)) > 0')}
           ORDER BY s.started_at DESC
           LIMIT 50`,
        ) as Promise<SessionTokenRow[]>,
        window.electronAPI.queryDb(
          store.dbPath,
          `SELECT date(started_at) as day,
                  SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)) as total
           FROM sessions
           WHERE started_at >= datetime('now', '-30 days')
           GROUP BY date(started_at)
           ORDER BY day ASC`,
        ) as Promise<SparkDay[]>,
      ])
      globalStats.value = globalRes[0] ?? { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0, session_count: 0 }
      agentRows.value = agentRes
      sessionRows.value = sessionRes
      sparkDays.value = sparkRes
    } catch { /* silent — usePolledData handles loading state */ }
  }

  watch(selectedPeriod, (v) => {
    try { localStorage.setItem('tokenStats.period', v) } catch { /* ignore */ }
    void fetchStats()
  })

  const { loading, refresh } = usePolledData(
    fetchStats,
    () => tabsStore.activeTabId === 'dashboard',
    30000,
  )

  // ── Formatting ──────────────────────────────────────────────────────────────

  function formatDate(dateStr: string): string {
    const d = parseUtcDate(dateStr)
    const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
    return d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  // ── Computed ────────────────────────────────────────────────────────────────

  const maxAgentTotal = computed(() => Math.max(...agentRows.value.map(r => r.total), 1))

  function barWidth(total: number): string {
    return Math.max((total / maxAgentTotal.value) * 100, 2) + '%'
  }

  const avgPerSession = computed(() => {
    if (globalStats.value.session_count === 0) return 0
    return Math.round(globalStats.value.total / globalStats.value.session_count)
  })

  const estimatedCost = computed(() => {
    const s = globalStats.value
    return (
      s.tokens_in        * PRICING.input       +
      s.tokens_out       * PRICING.output      +
      s.tokens_cache_read  * PRICING.cache_read  +
      s.tokens_cache_write * PRICING.cache_write
    ) / 1_000_000
  })

  const cacheHitRate = computed(() => {
    const total = globalStats.value.tokens_in + globalStats.value.tokens_cache_read
    if (total === 0) return 0
    return Math.round((globalStats.value.tokens_cache_read / total) * 100)
  })

  const cacheHitColor = computed(() => {
    if (cacheHitRate.value > 50) return 'text-emerald-600 dark:text-emerald-400'
    if (cacheHitRate.value >= 20) return 'text-amber-600 dark:text-amber-400'
    return 'text-content-faint'
  })

  // ── Sparkline 30 days ───────────────────────────────────────────────────────

  const sparkBars = computed(() => {
    const map = new Map<string, number>()
    for (const d of sparkDays.value) map.set(d.day, d.total)

    const fmt = new Intl.DateTimeFormat(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
      day: 'numeric',
      month: 'short',
    })
    const bars: Array<{ day: string; total: number; label: string }> = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date()
      date.setUTCDate(date.getUTCDate() - i)
      const key = date.toISOString().slice(0, 10)
      bars.push({ day: key, total: map.get(key) ?? 0, label: fmt.format(date) })
    }
    return bars
  })

  const sparkMax = computed(() => Math.max(...sparkBars.value.map(b => b.total), 1))

  function sparkBarHeight(total: number): number {
    if (total === 0) return 0
    return Math.max(Math.round((total / sparkMax.value) * 44), 2)
  }

  const hoveredSparkBar = ref<number | null>(null)

  // ── Agent color cache ───────────────────────────────────────────────────────

  const agentStyles = computed<Map<string, AgentStyle>>(() => {
    const m = new Map<string, AgentStyle>()
    for (const row of [...agentRows.value, ...sessionRows.value]) {
      if (row.agent_name && !m.has(row.agent_name)) {
        m.set(row.agent_name, {
          color: agentFg(row.agent_name),
          backgroundColor: agentBg(row.agent_name),
          boxShadow: `0 0 0 1px ${agentBorder(row.agent_name)}`,
        })
      }
    }
    return m
  })

  return {
    // Stores
    store, tabsStore, t,
    // Period
    selectedPeriod, activePeriod, costPeriod, PERIODS,
    // Data
    globalStats, agentRows, sessionRows, sparkDays,
    loading, refresh,
    // Formatting
    formatNumber, formatDate, formatCost, barWidth,
    // Computed
    avgPerSession, estimatedCost, cacheHitRate, cacheHitColor, maxAgentTotal,
    // Sparkline
    sparkBars, sparkMax, sparkBarHeight, hoveredSparkBar,
    // Agent styles
    agentStyles,
  }
}
