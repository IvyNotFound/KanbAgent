/**
 * CostStatsSection — Cost breakdown section with per-agent bars and sparkline trend.
 *
 * When the optional `period` prop is provided, the internal day/week/month selector
 * is hidden and the component follows the parent's period (used by TokenStatsView to
 * keep the two selectors in sync).
 */
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

/**
 * @property dbPath  - Path to the active SQLite database (null = no project open).
 * @property period  - Optional period override from parent. When set, hides the internal
 *                    period selector. Accepts 'day' | 'week' | 'month'.
 */
const props = defineProps<{
  dbPath: string | null
  period?: 'day' | 'week' | 'month'
}>()

const { t } = useI18n()

// ── Types ──────────────────────────────────────────────────────────────────

interface CostRow {
  agent_name: string | null
  agent_id: number
  period: string
  session_count: number
  total_cost: number | null
  avg_duration_s: number | null
  total_turns: number | null
  total_tokens: number | null
  cache_read: number | null
  cache_write: number | null
}

interface AgentCostAgg {
  agent_name: string
  agent_id: number
  total_cost: number
  session_count: number
  total_tokens: number
  cache_read: number
  cache_write: number
  total_turns: number
}

// ── Period selector ────────────────────────────────────────────────────────

const PERIODS = [
  { key: 'day'   as const, labelKey: 'costStats.period.day'   },
  { key: 'week'  as const, labelKey: 'costStats.period.week'  },
  { key: 'month' as const, labelKey: 'costStats.period.month' },
]

const selectedPeriod = ref<'day' | 'week' | 'month'>('day')

// ── Data fetching ──────────────────────────────────────────────────────────

const rows = ref<CostRow[]>([])
const loading = ref(false)
const hasData = ref<boolean | null>(null) // null = unknown (loading), false = no data, true = has data

/**
 * Fetches aggregated cost statistics from the backend.
 * Uses `props.period` when set, otherwise falls back to the internal `selectedPeriod`.
 * @returns Promise that resolves when rows are populated.
 */
async function fetchCostStats(): Promise<void> {
  if (!props.dbPath) return
  loading.value = true
  try {
    const res = await window.electronAPI.sessionsStatsCost(props.dbPath, {
      period: props.period ?? selectedPeriod.value,
      limit: 30,
    })
    if (res.success) {
      rows.value = (res.rows as CostRow[])
      hasData.value = rows.value.length > 0
    }
  } catch {
    hasData.value = false
  } finally {
    loading.value = false
  }
}

onMounted(fetchCostStats)
watch(selectedPeriod, fetchCostStats)
watch(() => props.period, fetchCostStats)
watch(() => props.dbPath, fetchCostStats)

// ── Aggregations ───────────────────────────────────────────────────────────

const byAgent = computed<AgentCostAgg[]>(() => {
  const map = new Map<string, AgentCostAgg>()
  for (const row of rows.value) {
    const key = row.agent_name ?? '?'
    const ex = map.get(key) ?? {
      agent_name: key,
      agent_id: row.agent_id,
      total_cost: 0,
      session_count: 0,
      total_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      total_turns: 0,
    }
    map.set(key, {
      ...ex,
      total_cost:    ex.total_cost    + (row.total_cost    ?? 0),
      session_count: ex.session_count + row.session_count,
      total_tokens:  ex.total_tokens  + (row.total_tokens  ?? 0),
      cache_read:    ex.cache_read    + (row.cache_read    ?? 0),
      cache_write:   ex.cache_write   + (row.cache_write   ?? 0),
      total_turns:   ex.total_turns   + (row.total_turns   ?? 0),
    })
  }
  return [...map.values()].sort((a, b) => b.total_cost - a.total_cost)
})

// Sparkline: cost per period bucket (last 7 buckets)
const sparkPeriods = computed<Array<{ label: string; cost: number }>>(() => {
  const periodMap = new Map<string, number>()
  for (const row of rows.value) {
    periodMap.set(row.period, (periodMap.get(row.period) ?? 0) + (row.total_cost ?? 0))
  }
  const sorted = [...periodMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return sorted.slice(-7).map(([label, cost]) => ({ label, cost }))
})

const sparkMax = computed(() => Math.max(...sparkPeriods.value.map(b => b.cost), 0.0001))

// Global totals
const globalCost     = computed(() => byAgent.value.reduce((s, r) => s + r.total_cost, 0))
const globalSessions = computed(() => byAgent.value.reduce((s, r) => s + r.session_count, 0))
const globalTurns    = computed(() => byAgent.value.reduce((s, r) => s + r.total_turns, 0))

// Bar widths
const maxAgentCost = computed(() => Math.max(...byAgent.value.map(r => r.total_cost), 0.0001))

/**
 * Returns a percentage width string for the cost bar relative to the highest agent cost.
 * Minimum bar width is 2% so zero-cost bars remain visible.
 * @param cost - Agent total cost in USD.
 * @returns CSS width string, e.g. "42%".
 */
function barWidth(cost: number): string {
  return Math.max((cost / maxAgentCost.value) * 100, 2) + '%'
}

/**
 * Computes the cache hit rate for an agent as an integer percentage (0–100).
 * Returns 0 when no cache tokens were recorded.
 * @param row - Aggregated cost row for the agent.
 * @returns Cache efficiency percentage.
 */
function cacheEfficiency(row: AgentCostAgg): number {
  const total = row.cache_read + row.cache_write
  if (total === 0) return 0
  return Math.round((row.cache_read / total) * 100)
}

function cacheEffClass(row: AgentCostAgg): string {
  const e = cacheEfficiency(row)
  if (e > 50) return 'cache-eff--high'
  if (e >= 20) return 'cache-eff--mid'
  return ''
}

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * Formats a USD cost value as a human-readable string.
 * - Zero → "$0.00"
 * - Sub-millicent → "< $0.001"
 * - Sub-cent → 3 decimal places
 * - Otherwise → 2 decimal places
 * @param usd - Cost amount in US dollars.
 * @returns Formatted cost string.
 */
function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return '< $0.001'
  if (usd < 0.01) return '$' + usd.toFixed(3)
  return '$' + usd.toFixed(2)
}

// ── Agent styles ───────────────────────────────────────────────────────────

interface AgentStyle { color: string; backgroundColor: string; boxShadow: string }

const agentStyles = computed<Map<string, AgentStyle>>(() => {
  const m = new Map<string, AgentStyle>()
  for (const row of byAgent.value) {
    if (!m.has(row.agent_name)) {
      m.set(row.agent_name, {
        color: agentFg(row.agent_name),
        backgroundColor: agentBg(row.agent_name),
        boxShadow: `0 0 0 1px ${agentBorder(row.agent_name)}`,
      })
    }
  }
  return m
})

// ── Sparkline hover ────────────────────────────────────────────────────────

const hoveredBar = ref<number | null>(null)
</script>

<template>
  <section class="cost-section ga-3">
<!-- Header + period selector -->
    <div v-if="!props.period" class="cost-header">
      <h3 class="cost-title text-caption font-weight-medium">
        {{ t('costStats.title') }}
      </h3>
      <div class="cost-period-btns ga-1">
        <v-btn
          v-for="p in PERIODS"
          :key="p.key"
          variant="text"
          size="small"
          density="compact"
          class="cost-period-btn text-caption font-weight-medium"
          :class="{ 'cost-period-btn--active': selectedPeriod === p.key }"
          @click="selectedPeriod = p.key"
        >
          {{ t(p.labelKey) }}
        </v-btn>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading && rows.length === 0" class="cost-state pa-4 text-caption">
      {{ t('costStats.loading') }}
    </div>

    <!-- No data state -->
    <div v-else-if="hasData === false" class="cost-state pa-4 text-caption">
      {{ t('costStats.noData') }}
    </div>

    <template v-else-if="byAgent.length > 0">
<!-- Global summary row -->
      <div class="cost-summary-grid ga-2">
        <div class="cost-summary-card">
          <span class="cost-summary-label text-caption font-weight-medium">{{ t('costStats.totalCost') }}</span>
          <span class="cost-summary-value text-body-2">{{ formatCost(globalCost) }}</span>
        </div>
        <div class="cost-summary-card">
          <span class="cost-summary-label text-caption font-weight-medium">{{ t('costStats.sessions') }}</span>
          <span class="cost-summary-value text-body-2">{{ globalSessions }}</span>
        </div>
        <div class="cost-summary-card">
          <span class="cost-summary-label text-caption font-weight-medium">{{ t('costStats.turns') }}</span>
          <span class="cost-summary-value text-body-2">{{ globalTurns }}</span>
        </div>
      </div>

      <!-- Cost sparkline (last 7 periods) -->
      <div v-if="sparkPeriods.length > 1" class="cost-sparkline-section ga-1">
        <span class="cost-section-label text-caption font-weight-medium">{{ t('costStats.trend') }}</span>
        <div class="cost-sparkline ga-1">
          <div
            v-for="(bar, i) in sparkPeriods"
            :key="bar.label"
            class="cost-spark-bar-wrap"
            @mouseenter="hoveredBar = i"
            @mouseleave="hoveredBar = null"
          >
            <div
              class="cost-spark-bar"
              :class="{ 'cost-spark-bar--hover': hoveredBar === i }"
              :style="{ height: Math.max(Math.round((bar.cost / sparkMax) * 36), bar.cost > 0 ? 2 : 0) + 'px' }"
            />
            <div v-if="bar.cost === 0" class="cost-spark-zero" />
            <div
              v-if="hoveredBar === i"
              class="cost-spark-tooltip elevation-2 py-1 px-2 text-caption font-weight-medium"
            >
              {{ bar.label }} : {{ formatCost(bar.cost) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Per-agent cost table -->
      <div class="cost-agent-table">
        <span class="cost-section-label text-caption font-weight-medium">{{ t('costStats.perAgent') }}</span>

        <div
          v-for="row in byAgent"
          :key="row.agent_id"
          class="cost-agent-row ga-3"
        >
          <!-- Agent badge -->
          <span
            class="cost-agent-badge"
            :style="agentStyles.get(row.agent_name)"
            :title="row.agent_name"
          >{{ row.agent_name }}</span>

          <!-- Cost bar -->
          <div class="cost-bar-track">
            <div
              class="cost-bar-fill"
              :style="{ width: barWidth(row.total_cost) }"
            />
            <span class="cost-bar-label px-2">
              {{ formatCost(row.total_cost) }}
            </span>
          </div>

          <!-- Cache efficiency -->
          <div class="cost-cache-info ga-3">
            <span
              class="cost-cache-eff"
              :class="cacheEffClass(row)"
              :title="t('costStats.cacheEfficiency')"
            >{{ t('costStats.cache') }} {{ cacheEfficiency(row) }}%</span>
            <span class="cost-sessions">{{ row.session_count }}s</span>
          </div>
        </div>
      </div>
</template>
  </section>
</template>

<style scoped>
.cost-section {
  display: flex;
  flex-direction: column;
}
.cost-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cost-title {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  margin: 0;
  font-weight: 400;
}
.cost-period-btns {
  display: flex;
}
.cost-period-btn {
  border: 1px solid var(--edge-default) !important;
  border-radius: 9999px !important;
  color: var(--content-secondary) !important;
}
.cost-period-btn--active {
  background: rgb(var(--v-theme-primary)) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
  color: white !important;
}
.cost-state {
  color: var(--content-faint);
  text-align: center;
}
/* Summary grid */
.cost-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.cost-summary-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}
.cost-summary-label {
  letter-spacing: 0.02em;
  color: var(--content-faint);
}
.cost-summary-value {
  font-weight: 700;
  color: var(--content-primary);
  font-variant-numeric: tabular-nums;
}
/* Section label */
.cost-section-label {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  display: block;
}
/* Sparkline */
.cost-sparkline-section {
  display: flex;
  flex-direction: column;
}
.cost-sparkline {
  display: flex;
  align-items: flex-end;
  height: 40px;
}
.cost-spark-bar-wrap {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  cursor: default;
}
.cost-spark-bar {
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: rgba(var(--v-theme-primary), 0.45);
  transition: background-color 0.15s;
}
.cost-spark-bar--hover { background: rgb(var(--v-theme-primary)); }
.cost-spark-zero {
  width: 100%;
  height: 2px;
  border-radius: 2px;
  background: var(--edge-subtle);
}
.cost-spark-tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  border-radius: 4px;
  white-space: nowrap;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: 1px solid var(--edge-default);
  pointer-events: none;
}
/* Per-agent table */
.cost-agent-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cost-agent-row {
  display: flex;
  align-items: center;
}
.cost-agent-badge {
  flex-shrink: 0;
  width: 128px;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.cost-bar-track {
  flex: 1;
  height: 20px;
  background: var(--surface-secondary);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}
.cost-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(to right, rgba(var(--v-theme-primary), 0.6), rgba(var(--v-theme-secondary), 0.6));
  transition: width 0.3s;
}
.cost-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: var(--content-secondary);
}
.cost-cache-info {
  flex-shrink: 0;
  display: flex;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: var(--content-subtle);
  width: 128px;
  justify-content: flex-end;
}
.cost-cache-eff { color: var(--content-faint); }
.cache-eff--high { color: rgb(var(--v-theme-secondary)); }
.cache-eff--mid { color: rgb(var(--v-theme-warning)); }
.cost-sessions { color: var(--content-faint); }
</style>
