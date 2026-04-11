<script setup lang="ts">
import CostStatsSection from '@renderer/components/CostStatsSection.vue'
import AgentBadge from '@renderer/components/AgentBadge.vue'
import TokenStatsSummaryCards from '@renderer/components/TokenStatsSummaryCards.vue'
import { useTokenStats, estimateSessionCost } from '@renderer/composables/useTokenStats'

const {
  store, t,
  selectedPeriod, costPeriod, PERIODS,
  globalStats, agentRows, sessionRows,
  loading, refresh,
  formatNumber, formatDate, formatCost, barWidth,
  avgPerSession, estimatedCost, cacheHitRate, cacheHitColor,
  sparkBars, sparkBarHeight, hoveredSparkBar,
} = useTokenStats()
</script>

<template>
  <div class="ts-view">
    <!-- Header: title only -->
    <div class="ts-header">
      <h2 class="ts-title text-h6 font-weight-medium">{{ t('tokenStats.title') }}</h2>
    </div>

    <!-- Filter bar: period selector + refresh -->
    <div class="ts-filter-bar">
      <span class="ts-filter-label text-label-medium">{{ t('tokenStats.period.label') }}</span>
      <v-btn-toggle
        v-model="selectedPeriod"
        mandatory
        density="compact"
        variant="outlined"
        class="ts-period-toggle"
      >
        <v-btn
          v-for="period in PERIODS"
          :key="period.key"
          :value="period.key"
          size="x-small"
          class="text-label-medium"
        >
          {{ t(period.labelKey) }}
        </v-btn>
      </v-btn-toggle>
      <v-btn
        icon="mdi-refresh"
        variant="text"
        size="small"
        style="margin-left: auto"
        :loading="loading"
        :title="t('common.refresh')"
        @click="refresh"
      />
    </div>

    <!-- Summary cards (extracted) -->
    <TokenStatsSummaryCards
      :total="globalStats.total"
      :tokens-in="globalStats.tokens_in"
      :tokens-out="globalStats.tokens_out"
      :session-count="globalStats.session_count"
      :cache-total="globalStats.tokens_cache_read + globalStats.tokens_cache_write"
      :cache-read="globalStats.tokens_cache_read"
      :cache-write="globalStats.tokens_cache_write"
      :cache-hit-rate="cacheHitRate"
      :cache-hit-color="cacheHitColor"
      :estimated-cost="estimatedCost"
      :avg-per-session="avgPerSession"
      :format-number="formatNumber"
      :format-cost="formatCost"
    />

    <!-- Content (scrollable) -->
    <div class="ts-content py-3 px-4 ga-4">
      <!-- Sparkline 30 days -->
      <v-card elevation="0" class="ts-section-card">
        <div class="ts-section-header">
          <span class="text-body-2 font-weight-medium ts-section-title">{{ t('tokenStats.evolution') }}</span>
        </div>
        <div class="pa-3">
          <div class="ts-spark-bars ga-1">
            <div
              v-for="(bar, i) in sparkBars"
              :key="bar.day"
              class="ts-spark-col"
              @mouseenter="hoveredSparkBar = i"
              @mouseleave="hoveredSparkBar = null"
            >
              <div
                class="ts-spark-bar"
                :class="hoveredSparkBar === i ? 'ts-spark-bar--hovered' : ''"
                :style="{ height: sparkBarHeight(bar.total) + 'px' }"
              />
              <div v-if="bar.total === 0" class="ts-spark-zero" />
              <div v-if="hoveredSparkBar === i" class="ts-spark-tooltip elevation-2 text-label-medium">
                {{ bar.label }} : {{ formatNumber(bar.total) }}
              </div>
            </div>
          </div>
        </div>
      </v-card>

      <!-- Cost analytics section -->
      <v-card elevation="0" class="ts-section-card">
        <div class="ts-section-header">
          <span class="text-body-2 font-weight-medium ts-section-title">{{ t('costStats.title') }}</span>
        </div>
        <div class="pa-3">
          <CostStatsSection :db-path="store.dbPath" :period="costPeriod" />
        </div>
      </v-card>

      <!-- Per-agent table with bars -->
      <v-card elevation="0" class="ts-section-card">
        <div class="ts-section-header">
          <span class="text-body-2 font-weight-medium ts-section-title">{{ t('tokenStats.perAgent') }}</span>
        </div>
        <div class="pa-3">
          <div v-if="agentRows.length === 0" class="ts-empty py-4 text-body-2">{{ t('tokenStats.noData') }}</div>

          <div v-else class="ts-agent-rows">
            <div
              v-for="row in agentRows"
              :key="row.agent_id"
              class="ts-agent-row ga-3"
            >
              <div class="ts-agent-name">
                <AgentBadge v-if="row.agent_name" :name="row.agent_name" />
                <span v-else class="ts-dim">—</span>
              </div>

              <div class="ts-bar-wrap">
                <div class="ts-bar-fill" :style="{ width: barWidth(row.total) }" />
                <span class="ts-bar-label ts-mono text-label-medium">{{ formatNumber(row.total) }}</span>
              </div>

              <div class="ts-agent-totals ga-2 ts-mono text-label-medium">
                <span class="ts-in">↓{{ formatNumber(row.tokens_in) }}</span>
                <span class="ts-out">↑{{ formatNumber(row.tokens_out) }}</span>
                <span class="ts-faint">{{ row.session_count }}s</span>
              </div>
            </div>
          </div>
        </div>
      </v-card>

      <!-- Per-session table -->
      <v-card elevation="0" class="ts-section-card">
        <div class="ts-section-header">
          <span class="text-body-2 font-weight-medium ts-section-title">{{ t('tokenStats.perSession') }}</span>
        </div>
        <div v-if="sessionRows.length === 0" class="ts-empty pa-4 text-body-2">{{ t('tokenStats.noData') }}</div>
        <table v-else class="ts-table text-label-medium">
          <thead>
            <tr class="ts-thead-row">
              <th class="ts-th">ID</th>
              <th class="ts-th">{{ t('tokenStats.agent') }}</th>
              <th class="ts-th">{{ t('tokenStats.date') }}</th>
              <th class="ts-th ts-th--right ts-in">↓ In</th>
              <th class="ts-th ts-th--right ts-out">↑ Out</th>
              <th class="ts-th ts-th--right">Total</th>
              <th class="ts-th ts-th--right">{{ t('tokenStats.cost') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in sessionRows"
              :key="s.id"
              class="ts-tbody-row"
            >
              <td class="ts-td ts-faint">#{{ s.id }}</td>
              <td class="ts-td">
                <AgentBadge v-if="s.agent_name" :name="s.agent_name" />
                <span v-else class="ts-dim">—</span>
              </td>
              <td class="ts-td ts-subtle">{{ formatDate(s.started_at) }}</td>
              <td class="ts-td ts-td--right ts-in ts-tabnum ts-mono">{{ formatNumber(s.tokens_in) }}</td>
              <td class="ts-td ts-td--right ts-out ts-tabnum ts-mono">{{ formatNumber(s.tokens_out) }}</td>
              <td class="ts-td ts-td--right ts-secondary ts-semibold ts-tabnum ts-mono">{{ formatNumber(s.total) }}</td>
              <td
                class="ts-td ts-td--right ts-tabnum ts-mono"
                :class="estimateSessionCost(s) !== null ? 'ts-violet' : 'ts-faint'"
                :title="estimateSessionCost(s) === null ? `Cost estimation not available for ${s.cli_type ?? 'unknown'} sessions` : undefined"
              >
                {{ estimateSessionCost(s) !== null ? formatCost(estimateSessionCost(s)!) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </v-card>
    </div>
  </div>
</template>

<style scoped>
.ts-view {
  height: 100%;
  overflow-y: auto;
  background-color: var(--surface-base);
}

.ts-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.ts-title { color: var(--content-primary); margin: 0; }

.ts-filter-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-wrap: wrap;
}
.ts-filter-label { letter-spacing: 0.02em; color: var(--content-faint); }
.ts-period-toggle { height: 28px; }

/* color helpers */
.ts-in  { color: rgb(var(--v-theme-secondary)); }
.ts-out { color: rgb(var(--v-theme-primary)); }
.ts-violet { color: rgb(var(--v-theme-primary)); }
.ts-faint  { color: var(--content-faint); }
.ts-subtle { color: var(--content-subtle); }
.ts-secondary { color: var(--content-secondary); }
.ts-dim { color: var(--content-dim); }
.ts-mono { font-family: ui-monospace, monospace; }
.ts-tabnum { font-variant-numeric: tabular-nums; }
.ts-semibold { font-weight: 600; }

.ts-content {
  display: flex;
  flex-direction: column;
}

.ts-section-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}
.ts-section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
}
.ts-section-title {
  color: var(--content-secondary);
}

/* sparkline bars */
.ts-spark-bars {
  display: flex;
  align-items: flex-end;
  height: 60px;
}
.ts-spark-col {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  cursor: default;
}
.ts-spark-bar {
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: rgba(var(--v-theme-primary), 0.55);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.ts-spark-bar--hovered { background: rgb(var(--v-theme-primary)); }
.ts-spark-zero { width: 100%; height: 2px; border-radius: 2px; background: var(--edge-subtle); }
.ts-spark-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 4px 8px;
  border-radius: var(--shape-xs);
  white-space: nowrap;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: 1px solid var(--edge-default);
  pointer-events: none;
}

.ts-empty { color: var(--content-faint); text-align: center; }

.ts-agent-rows { display: flex; flex-direction: column; gap: 6px; }
.ts-agent-row { display: flex; align-items: center; }
.ts-agent-name {
  flex-shrink: 0;
  width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ts-bar-wrap {
  flex: 1;
  height: 20px;
  background: var(--surface-secondary);
  border-radius: var(--shape-xs);
  overflow: hidden;
  position: relative;
}
.ts-bar-fill {
  height: 100%;
  border-radius: var(--shape-xs);
  background: linear-gradient(to right, rgba(var(--v-theme-secondary),0.65), rgba(var(--v-theme-primary),0.9));
  transition: width var(--md-duration-medium2) var(--md-easing-standard);
}
.ts-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: 0.625rem;
  color: var(--content-secondary);
}
.ts-agent-totals {
  flex-shrink: 0;
  display: flex;
  font-size: 0.625rem;
  width: 160px;
  justify-content: flex-end;
}

.ts-table { width: 100%; border-collapse: collapse; }
.ts-thead-row {
  color: var(--content-faint);
  text-align: left;
  border-bottom: 1px solid var(--edge-subtle);
}
.ts-th { padding: 6px 8px; font-weight: 500; }
.ts-th--right { text-align: right; }
.ts-tbody-row {
  border-bottom: 1px solid rgba(var(--v-theme-surface-secondary), 0.4);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.ts-tbody-row:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }
.ts-td { padding: 6px 8px; }
.ts-td--right { text-align: right; }
</style>
