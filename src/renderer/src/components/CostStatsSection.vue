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
import { agentAccent } from '@renderer/utils/agentColor'
import AgentBadge from './AgentBadge.vue'
import CostSparkline from './CostSparkline.vue'

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

const PERIODS = [
  { key: 'day'   as const, labelKey: 'costStats.period.day'   },
  { key: 'week'  as const, labelKey: 'costStats.period.week'  },
  { key: 'month' as const, labelKey: 'costStats.period.month' },
]

const selectedPeriod = ref<'day' | 'week' | 'month'>('day')

const rows = ref<CostRow[]>([])
const loading = ref(false)
const hasData = ref<boolean | null>(null)

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

const sparkPeriods = computed<Array<{ label: string; cost: number }>>(() => {
  const periodMap = new Map<string, number>()
  for (const row of rows.value) {
    periodMap.set(row.period, (periodMap.get(row.period) ?? 0) + (row.total_cost ?? 0))
  }
  const sorted = [...periodMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return sorted.slice(-7).map(([label, cost]) => ({ label, cost }))
})

const sparkMax = computed(() => Math.max(...sparkPeriods.value.map(b => b.cost), 0.0001))

const globalCost     = computed(() => byAgent.value.reduce((s, r) => s + r.total_cost, 0))
const globalSessions = computed(() => byAgent.value.reduce((s, r) => s + r.session_count, 0))
const globalTurns    = computed(() => byAgent.value.reduce((s, r) => s + r.total_turns, 0))

const maxAgentCost = computed(() => Math.max(...byAgent.value.map(r => r.total_cost), 0.0001))

function barWidth(cost: number): string {
  return Math.max((cost / maxAgentCost.value) * 100, 2) + '%'
}

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

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return '< $0.001'
  if (usd < 0.01) return '$' + usd.toFixed(3)
  return '$' + usd.toFixed(2)
}
</script>

<template>
  <section class="cost-section ga-3">
    <!-- Header + period selector -->
    <div v-if="!props.period" class="cost-header">
      <h3 class="cost-title text-label-medium">
        {{ t('costStats.title') }}
      </h3>
      <div class="cost-period-btns ga-1">
        <v-btn
          v-for="p in PERIODS"
          :key="p.key"
          variant="text"
          size="small"
          density="compact"
          class="cost-period-btn text-label-medium"
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
          <span class="cost-summary-label text-label-medium">{{ t('costStats.totalCost') }}</span>
          <span class="cost-summary-value text-body-2">{{ formatCost(globalCost) }}</span>
        </div>
        <div class="cost-summary-card">
          <span class="cost-summary-label text-label-medium">{{ t('costStats.sessions') }}</span>
          <span class="cost-summary-value text-body-2">{{ globalSessions }}</span>
        </div>
        <div class="cost-summary-card">
          <span class="cost-summary-label text-label-medium">{{ t('costStats.turns') }}</span>
          <span class="cost-summary-value text-body-2">{{ globalTurns }}</span>
        </div>
      </div>

      <!-- Cost sparkline (extracted) -->
      <CostSparkline
        :spark-periods="sparkPeriods"
        :spark-max="sparkMax"
        :format-cost="formatCost"
      />

      <!-- Per-agent cost table -->
      <div class="cost-agent-table">
        <span class="cost-section-label text-label-medium">{{ t('costStats.perAgent') }}</span>

        <div
          v-for="row in byAgent"
          :key="row.agent_id"
          class="cost-agent-row ga-3"
        >
          <AgentBadge :name="row.agent_name" />

          <div class="cost-bar-track">
            <div
              class="cost-bar-fill"
              :style="{ width: barWidth(row.total_cost), backgroundColor: agentAccent(row.agent_name) }"
            />
            <span class="cost-bar-label px-2">
              {{ formatCost(row.total_cost) }}
            </span>
          </div>

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
.cost-period-btns { display: flex; }
.cost-period-btn {
  border: 1px solid var(--edge-default) !important;
  border-radius: var(--shape-full) !important;
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
.cost-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.cost-summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--shape-sm);
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
.cost-section-label {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  display: block;
}
.cost-agent-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cost-agent-row {
  display: flex;
  align-items: center;
}
.cost-bar-track {
  flex: 1;
  height: 20px;
  background: var(--surface-secondary);
  border-radius: var(--shape-xs);
  overflow: hidden;
  position: relative;
}
.cost-bar-fill {
  height: 100%;
  border-radius: var(--shape-xs);
  transition: width var(--md-duration-medium2) var(--md-easing-standard);
}
.cost-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  font-size: 0.625rem;
  font-family: ui-monospace, monospace;
  color: var(--content-secondary);
}
.cost-cache-info {
  flex-shrink: 0;
  display: flex;
  font-size: 0.625rem;
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
