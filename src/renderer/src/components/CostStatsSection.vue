<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

const props = defineProps<{ dbPath: string | null }>()

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

async function fetchCostStats(): Promise<void> {
  if (!props.dbPath) return
  loading.value = true
  try {
    const res = await window.electronAPI.sessionsStatsCost(props.dbPath, {
      period: selectedPeriod.value,
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

function barWidth(cost: number): string {
  return Math.max((cost / maxAgentCost.value) * 100, 2) + '%'
}

// Cache efficiency per agent
function cacheEfficiency(row: AgentCostAgg): number {
  const total = row.cache_read + row.cache_write
  if (total === 0) return 0
  return Math.round((row.cache_read / total) * 100)
}

// ── Formatting ─────────────────────────────────────────────────────────────

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
  <section class="space-y-3">

    <!-- Header + period selector -->
    <div class="flex items-center justify-between">
      <h3 class="text-[11px] uppercase tracking-wider text-content-faint">
        {{ t('costStats.title') }}
      </h3>
      <div class="flex gap-1">
        <button
          v-for="p in PERIODS"
          :key="p.key"
          class="px-2 py-0.5 rounded-full text-[11px] border transition-colors"
          :class="selectedPeriod === p.key
            ? 'bg-accent-primary border-accent-primary text-white'
            : 'bg-surface-secondary border-edge-default text-content-secondary hover:border-accent-primary hover:text-content-primary'"
          @click="selectedPeriod = p.key"
        >
          {{ t(p.labelKey) }}
        </button>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading && rows.length === 0" class="text-sm text-content-faint py-4 text-center">
      {{ t('costStats.loading') }}
    </div>

    <!-- No data state -->
    <div v-else-if="hasData === false" class="text-sm text-content-faint py-4 text-center">
      {{ t('costStats.noData') }}
    </div>

    <template v-else-if="byAgent.length > 0">

      <!-- Global summary row -->
      <div class="grid grid-cols-3 gap-2">
        <div class="flex flex-col gap-0.5 p-2.5 rounded-lg bg-surface-secondary border border-edge-default">
          <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('costStats.totalCost') }}</span>
          <span class="text-base font-bold text-content-primary tabular-nums">{{ formatCost(globalCost) }}</span>
        </div>
        <div class="flex flex-col gap-0.5 p-2.5 rounded-lg bg-surface-secondary border border-edge-default">
          <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('costStats.sessions') }}</span>
          <span class="text-base font-bold text-content-primary tabular-nums">{{ globalSessions }}</span>
        </div>
        <div class="flex flex-col gap-0.5 p-2.5 rounded-lg bg-surface-secondary border border-edge-default">
          <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('costStats.turns') }}</span>
          <span class="text-base font-bold text-content-primary tabular-nums">{{ globalTurns }}</span>
        </div>
      </div>

      <!-- Cost sparkline (last 7 periods) -->
      <div v-if="sparkPeriods.length > 1" class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('costStats.trend') }}</span>
        <div class="flex items-end gap-1 h-[40px]">
          <div
            v-for="(bar, i) in sparkPeriods"
            :key="bar.label"
            class="relative flex-1 flex flex-col justify-end cursor-default"
            @mouseenter="hoveredBar = i"
            @mouseleave="hoveredBar = null"
          >
            <div
              class="w-full rounded-t transition-colors"
              :class="hoveredBar === i ? 'bg-accent-primary' : 'bg-violet-600/50 dark:bg-violet-500/40'"
              :style="{ height: Math.max(Math.round((bar.cost / sparkMax) * 36), bar.cost > 0 ? 2 : 0) + 'px' }"
            />
            <div v-if="bar.cost === 0" class="w-full h-[2px] rounded bg-edge-subtle" />
            <div
              v-if="hoveredBar === i"
              class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded text-[10px] whitespace-nowrap bg-surface-tooltip text-content-primary border border-edge-default shadow-lg pointer-events-none"
            >
              {{ bar.label }} : {{ formatCost(bar.cost) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Per-agent cost table -->
      <div class="space-y-1.5">
        <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('costStats.perAgent') }}</span>

        <div
          v-for="row in byAgent"
          :key="row.agent_id"
          class="flex items-center gap-3"
        >
          <!-- Agent badge -->
          <span
            class="shrink-0 w-32 text-[11px] font-mono px-1.5 py-0.5 rounded font-medium truncate text-right"
            :style="agentStyles.get(row.agent_name)"
            :title="row.agent_name"
          >{{ row.agent_name }}</span>

          <!-- Cost bar -->
          <div class="flex-1 h-5 bg-surface-secondary rounded overflow-hidden relative">
            <div
              class="h-full rounded bg-gradient-to-r from-violet-600/60 to-pink-600/60 transition-all duration-300"
              :style="{ width: barWidth(row.total_cost) }"
            />
            <span class="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-content-secondary">
              {{ formatCost(row.total_cost) }}
            </span>
          </div>

          <!-- Cache efficiency -->
          <div class="shrink-0 flex gap-3 text-[10px] font-mono text-content-subtle w-32 justify-end">
            <span
              :class="cacheEfficiency(row) > 50 ? 'text-emerald-600 dark:text-emerald-400' : cacheEfficiency(row) >= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-content-faint'"
              :title="t('costStats.cacheEfficiency')"
            >{{ t('costStats.cache') }} {{ cacheEfficiency(row) }}%</span>
            <span class="text-content-faint">{{ row.session_count }}s</span>
          </div>
        </div>
      </div>

    </template>
  </section>
</template>
