<script setup lang="ts">
import CostStatsSection from '@renderer/components/CostStatsSection.vue'
import { useTokenStats } from '@renderer/composables/useTokenStats'

const {
  store, t,
  selectedPeriod, costPeriod, PERIODS,
  globalStats, agentRows, sessionRows,
  loading, refresh,
  formatNumber, formatDate, formatCost, barWidth,
  avgPerSession, estimatedCost, cacheHitRate, cacheHitColor,
  sparkBars, sparkBarHeight, hoveredSparkBar,
  agentStyles,
} = useTokenStats()
</script>

<template>
  <div class="flex flex-col h-full bg-surface-base min-h-0">

    <!-- ── Period selector ────────────────────────────────────────────── -->
    <div class="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
      <h2 class="text-xl font-semibold text-content-primary mr-2">{{ t('tokenStats.title') }}</h2>
      <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('tokenStats.period.label') }}</span>
      <div class="flex gap-1">
        <button
          v-for="period in PERIODS"
          :key="period.key"
          class="px-2.5 py-0.5 rounded-full text-[11px] border transition-colors"
          :class="selectedPeriod === period.key
            ? 'bg-accent-primary border-accent-primary text-white'
            : 'bg-surface-secondary border-edge-default text-content-secondary hover:border-accent-primary hover:text-content-primary'"
          @click="selectedPeriod = period.key"
        >
          {{ t(period.labelKey) }}
        </button>
      </div>
    </div>

    <!-- ── Summary cards ──────────────────────────────────────────────── -->
    <div class="shrink-0 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 px-4 py-2 border-b border-edge-subtle bg-surface-base">

      <!-- Period total tokens -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] uppercase tracking-wider text-content-faint truncate">{{ t('tokenStats.total') }}</span>
        <span class="text-base font-bold text-content-primary tabular-nums">{{ formatNumber(globalStats.total) }}</span>
        <div class="flex gap-1.5 text-[10px] font-mono text-content-subtle">
          <span class="text-emerald-600 dark:text-emerald-400">↓ {{ formatNumber(globalStats.tokens_in) }}</span>
          <span class="text-sky-600 dark:text-sky-400">↑ {{ formatNumber(globalStats.tokens_out) }}</span>
        </div>
      </div>

      <!-- Sessions count -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] uppercase tracking-wider text-content-faint truncate">{{ t('tokenStats.sessions') }}</span>
        <span class="text-base font-bold text-content-primary tabular-nums">{{ globalStats.session_count }}</span>
        <div class="text-[10px] text-content-subtle truncate">
          {{ t('tokenStats.avgPerSession') }} {{ formatNumber(avgPerSession) }}
        </div>
      </div>

      <!-- Cache tokens -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] uppercase tracking-wider text-content-faint truncate">{{ t('tokenStats.cache') }}</span>
        <span class="text-base font-bold text-content-primary tabular-nums">{{ formatNumber(globalStats.tokens_cache_read + globalStats.tokens_cache_write) }}</span>
        <div class="flex gap-1.5 text-[10px] font-mono text-content-subtle">
          <span class="text-amber-600 dark:text-amber-400">R {{ formatNumber(globalStats.tokens_cache_read) }}</span>
          <span class="text-violet-600 dark:text-violet-400">W {{ formatNumber(globalStats.tokens_cache_write) }}</span>
        </div>
      </div>

      <!-- Cache hit rate (T635) -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] uppercase tracking-wider text-content-faint truncate">{{ t('tokenStats.cacheHit') }}</span>
        <span class="text-base font-bold tabular-nums" :class="cacheHitColor">{{ cacheHitRate }}%</span>
        <div class="text-[10px] text-content-subtle truncate">
          {{ t('tokenStats.cacheHitLabel') }}
        </div>
      </div>

      <!-- Estimated cost (T635) -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] uppercase tracking-wider text-content-faint truncate">{{ t('tokenStats.cost') }}</span>
        <span class="text-base font-bold text-content-primary tabular-nums">{{ formatCost(estimatedCost) }}</span>
        <div class="text-[10px] text-content-faint truncate">
          {{ t('tokenStats.costNote') }}
        </div>
      </div>

      <!-- Output ratio -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] uppercase tracking-wider text-content-faint truncate">{{ t('tokenStats.ratio') }}</span>
        <span class="text-base font-bold text-content-primary tabular-nums">
          {{ globalStats.total > 0 ? Math.round((globalStats.tokens_out / Math.max(globalStats.total, 1)) * 100) : 0 }}%
        </span>
        <div class="text-[10px] text-content-subtle truncate">
          <span class="text-sky-600 dark:text-sky-400">{{ t('tokenStats.outputRatio') }}</span>
        </div>
      </div>
    </div>

    <!-- ── Sparkline 30 days ─────────────────────────────────────────── -->
    <div class="shrink-0 px-4 py-2 border-b border-edge-subtle bg-surface-base">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-[10px] uppercase tracking-wider text-content-faint">{{ t('tokenStats.evolution') }}</span>
      </div>
      <div class="flex items-end gap-1 h-[60px]">
        <div
          v-for="(bar, i) in sparkBars"
          :key="bar.day"
          class="relative flex-1 flex flex-col justify-end cursor-default group"
          @mouseenter="hoveredSparkBar = i"
          @mouseleave="hoveredSparkBar = null"
        >
          <div
            class="w-full rounded-t transition-colors"
            :class="hoveredSparkBar === i
              ? 'bg-accent-primary'
              : 'bg-emerald-600/50 dark:bg-emerald-500/40'"
            :style="{ height: sparkBarHeight(bar.total) + 'px' }"
          />
          <div
            v-if="bar.total === 0"
            class="w-full h-[2px] rounded bg-edge-subtle"
          />
          <div
            v-if="hoveredSparkBar === i"
            class="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded text-[10px] whitespace-nowrap bg-surface-tooltip text-content-primary border border-edge-default shadow-lg pointer-events-none"
          >
            {{ bar.label }} : {{ formatNumber(bar.total) }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── Content (scrollable) ───────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-4">

      <!-- Cost analytics section (T769) -->
      <CostStatsSection :db-path="store.dbPath" :period="costPeriod" />

      <!-- Per-agent table with bars -->
      <section>
        <h3 class="text-[11px] uppercase tracking-wider text-content-faint mb-2">{{ t('tokenStats.perAgent') }}</h3>

        <div v-if="agentRows.length === 0" class="text-sm text-content-faint py-4 text-center">
          {{ t('tokenStats.noData') }}
        </div>

        <div v-else class="space-y-1.5">
          <div
            v-for="row in agentRows"
            :key="row.agent_id"
            class="flex items-center gap-3 group"
          >
            <span
              v-if="row.agent_name"
              class="shrink-0 w-32 text-[11px] font-mono px-1.5 py-0.5 rounded font-medium truncate text-right"
              :style="agentStyles.get(row.agent_name)"
              :title="row.agent_name"
            >{{ row.agent_name }}</span>
            <span v-else class="shrink-0 w-32 text-[11px] font-mono text-content-dim text-right">—</span>

            <div class="flex-1 h-5 bg-surface-secondary rounded overflow-hidden relative">
              <div
                class="h-full rounded bg-gradient-to-r from-emerald-600/60 to-sky-600/60 transition-all duration-300"
                :style="{ width: barWidth(row.total) }"
              />
              <span class="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-content-secondary">
                {{ formatNumber(row.total) }}
              </span>
            </div>

            <div class="shrink-0 flex gap-2 text-[10px] font-mono text-content-subtle w-40 justify-end">
              <span class="text-emerald-600 dark:text-emerald-400">↓{{ formatNumber(row.tokens_in) }}</span>
              <span class="text-sky-600 dark:text-sky-400">↑{{ formatNumber(row.tokens_out) }}</span>
              <span class="text-content-faint">{{ row.session_count }}s</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Per-session table -->
      <section>
        <h3 class="text-[11px] uppercase tracking-wider text-content-faint mb-2">{{ t('tokenStats.perSession') }}</h3>

        <div v-if="sessionRows.length === 0" class="text-sm text-content-faint py-4 text-center">
          {{ t('tokenStats.noData') }}
        </div>

        <table v-else class="w-full text-[11px]">
          <thead>
            <tr class="text-content-faint text-left border-b border-edge-subtle">
              <th class="py-1.5 px-2 font-medium">ID</th>
              <th class="py-1.5 px-2 font-medium">{{ t('tokenStats.agent') }}</th>
              <th class="py-1.5 px-2 font-medium">{{ t('tokenStats.date') }}</th>
              <th class="py-1.5 px-2 font-medium text-right text-emerald-600 dark:text-emerald-400">↓ In</th>
              <th class="py-1.5 px-2 font-medium text-right text-sky-600 dark:text-sky-400">↑ Out</th>
              <th class="py-1.5 px-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in sessionRows"
              :key="s.id"
              class="border-b border-edge-subtle/40 hover:bg-surface-secondary/40 transition-colors"
            >
              <td class="py-1.5 px-2 text-content-faint">#{{ s.id }}</td>
              <td class="py-1.5 px-2">
                <span
                  v-if="s.agent_name"
                  class="px-1.5 py-0.5 rounded font-medium"
                  :style="agentStyles.get(s.agent_name)"
                >{{ s.agent_name }}</span>
                <span v-else class="text-content-dim">—</span>
              </td>
              <td class="py-1.5 px-2 text-content-subtle">{{ formatDate(s.started_at) }}</td>
              <td class="py-1.5 px-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums font-mono">{{ formatNumber(s.tokens_in) }}</td>
              <td class="py-1.5 px-2 text-right text-sky-600 dark:text-sky-400 tabular-nums font-mono">{{ formatNumber(s.tokens_out) }}</td>
              <td class="py-1.5 px-2 text-right text-content-secondary font-semibold tabular-nums font-mono">{{ formatNumber(s.total) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Refresh button -->
    <div class="shrink-0 flex items-center justify-end px-4 py-2 border-t border-edge-subtle bg-surface-base">
      <button
        class="w-6 h-6 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
        :class="{ 'animate-spin': loading }"
        :title="t('logs.refresh')"
        @click="refresh"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
      </button>
    </div>
  </div>
</template>
