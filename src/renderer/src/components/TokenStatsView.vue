<script setup lang="ts">
import CostStatsSection from '@renderer/components/CostStatsSection.vue'
import { useTokenStats, estimateSessionCost } from '@renderer/composables/useTokenStats'

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
  <div class="ts-view">

    <!-- ── Period selector ────────────────────────────────────────────── -->
    <div class="ts-period-bar ga-2 pt-3 px-4 pb-2">
      <h2 class="ts-title mr-2 text-h6">{{ t('tokenStats.title') }}</h2>
      <span class="ts-period-label text-caption font-weight-medium">{{ t('tokenStats.period.label') }}</span>
      <div class="ts-period-btns ga-1">
        <v-btn
          v-for="period in PERIODS"
          :key="period.key"
          variant="text"
          size="x-small"
          density="compact"
          class="ts-period-btn text-caption font-weight-medium"
          :class="selectedPeriod === period.key ? 'ts-period-btn--active' : ''"
          @click="selectedPeriod = period.key"
        >
          {{ t(period.labelKey) }}
        </v-btn>
      </div>
    </div>

    <!-- ── Summary cards ──────────────────────────────────────────────── -->
    <div class="ts-cards-row ga-2 py-2 px-4">
      <div class="ts-card ga-1 pa-3">
        <span class="ts-card-label text-caption font-weight-medium">{{ t('tokenStats.total') }}</span>
        <span class="ts-card-value text-body-1">{{ formatNumber(globalStats.total) }}</span>
        <div class="ts-card-sub ts-mono text-caption font-weight-medium">
          <span class="ts-in">↓ {{ formatNumber(globalStats.tokens_in) }}</span>
          <span class="ts-out">↑ {{ formatNumber(globalStats.tokens_out) }}</span>
        </div>
      </div>

      <div class="ts-card ga-1 pa-3">
        <span class="ts-card-label text-caption font-weight-medium">{{ t('tokenStats.sessions') }}</span>
        <span class="ts-card-value text-body-1">{{ globalStats.session_count }}</span>
        <div class="ts-card-sub text-caption font-weight-medium">
          {{ t('tokenStats.avgPerSession') }} {{ formatNumber(avgPerSession) }}
        </div>
      </div>

      <div class="ts-card ga-1 pa-3">
        <span class="ts-card-label text-caption font-weight-medium">{{ t('tokenStats.cache') }}</span>
        <span class="ts-card-value text-body-1">{{ formatNumber(globalStats.tokens_cache_read + globalStats.tokens_cache_write) }}</span>
        <div class="ts-card-sub ts-mono text-caption font-weight-medium">
          <span class="ts-amber">R {{ formatNumber(globalStats.tokens_cache_read) }}</span>
          <span class="ts-violet">W {{ formatNumber(globalStats.tokens_cache_write) }}</span>
        </div>
      </div>

      <div class="ts-card ga-1 pa-3">
        <span class="ts-card-label text-caption font-weight-medium">{{ t('tokenStats.cacheHit') }}</span>
        <span class="ts-card-value ts-tabnum text-body-1" :style="{ color: cacheHitColor }">{{ cacheHitRate }}%</span>
        <div class="ts-card-sub text-caption font-weight-medium">{{ t('tokenStats.cacheHitLabel') }}</div>
      </div>

      <div class="ts-card ga-1 pa-3">
        <span class="ts-card-label text-caption font-weight-medium">{{ t('tokenStats.cost') }}</span>
        <span class="ts-card-value text-body-1">{{ formatCost(estimatedCost) }}</span>
        <div class="ts-card-sub ts-faint text-caption font-weight-medium">{{ t('tokenStats.costNote') }}</div>
      </div>

      <div class="ts-card ga-1 pa-3">
        <span class="ts-card-label text-caption font-weight-medium">{{ t('tokenStats.ratio') }}</span>
        <span class="ts-card-value text-body-1">
          {{ globalStats.total > 0 ? Math.round((globalStats.tokens_out / Math.max(globalStats.total, 1)) * 100) : 0 }}%
        </span>
        <div class="ts-card-sub text-caption font-weight-medium">
          <span class="ts-out">{{ t('tokenStats.outputRatio') }}</span>
        </div>
      </div>
    </div>

    <!-- ── Sparkline 30 days ─────────────────────────────────────────── -->
    <div class="ts-spark-wrap py-2 px-4">
      <div class="ts-spark-header ga-2 mb-1">
        <span class="ts-mini-label text-caption font-weight-medium">{{ t('tokenStats.evolution') }}</span>
      </div>
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
          <div v-if="hoveredSparkBar === i" class="ts-spark-tooltip elevation-2 text-caption font-weight-medium">
            {{ bar.label }} : {{ formatNumber(bar.total) }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── Content (scrollable) ───────────────────────────────────────── -->
    <div class="ts-content py-3 px-4 ga-4">

      <!-- Cost analytics section (T769) -->
      <CostStatsSection :db-path="store.dbPath" :period="costPeriod" />

      <!-- Per-agent table with bars -->
      <section>
        <h3 class="ts-section-title mb-2 text-caption font-weight-medium">{{ t('tokenStats.perAgent') }}</h3>

        <div v-if="agentRows.length === 0" class="ts-empty py-4 text-body-2">{{ t('tokenStats.noData') }}</div>

        <div v-else class="ts-agent-rows">
          <div
            v-for="row in agentRows"
            :key="row.agent_id"
            class="ts-agent-row ga-3"
          >
            <span
              v-if="row.agent_name"
              class="ts-agent-name"
              :style="agentStyles.get(row.agent_name)"
              :title="row.agent_name"
            >{{ row.agent_name }}</span>
            <span v-else class="ts-agent-name ts-dim">—</span>

            <div class="ts-bar-wrap">
              <div class="ts-bar-fill" :style="{ width: barWidth(row.total) }" />
              <span class="ts-bar-label ts-mono text-caption font-weight-medium">{{ formatNumber(row.total) }}</span>
            </div>

            <div class="ts-agent-totals ga-2 ts-mono text-caption font-weight-medium">
              <span class="ts-in">↓{{ formatNumber(row.tokens_in) }}</span>
              <span class="ts-out">↑{{ formatNumber(row.tokens_out) }}</span>
              <span class="ts-faint">{{ row.session_count }}s</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Per-session table -->
      <section>
        <h3 class="ts-section-title mb-2 text-caption font-weight-medium">{{ t('tokenStats.perSession') }}</h3>

        <div v-if="sessionRows.length === 0" class="ts-empty py-4">{{ t('tokenStats.noData') }}</div>

        <table v-else class="ts-table text-caption font-weight-medium">
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
                <span
                  v-if="s.agent_name"
                  class="ts-agent-badge"
                  :style="agentStyles.get(s.agent_name)"
                >{{ s.agent_name }}</span>
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
      </section>
    </div>

    <!-- Refresh button -->
    <div class="ts-footer py-2 px-4">
      <v-btn
        icon
        variant="text"
        density="compact"
        class="ts-refresh-btn"
        :class="{ 'ts-refresh-btn--spinning': loading }"
        :title="t('logs.refresh')"
        @click="refresh"
      >
        <v-icon size="14">mdi-refresh</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.ts-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--surface-base);
  min-height: 0;
}

/* period selector */
.ts-period-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.ts-title { font-weight: 500; color: var(--content-primary); margin: 0; }
.ts-period-label { letter-spacing: 0.02em; color: var(--content-faint); }
.ts-period-btns { display: flex; }
.ts-period-btn {
  padding: 2px 10px !important;
  border-radius: 9999px !important;
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-secondary) !important;
  color: var(--content-secondary) !important;
  transition: border-color 0.15s, color 0.15s;
}
.ts-period-btn:hover { border-color: rgb(var(--v-theme-primary)) !important; color: var(--content-primary) !important; }
.ts-period-btn--active { background: rgb(var(--v-theme-primary)) !important; border-color: rgb(var(--v-theme-primary)) !important; color: #fff !important; }

/* summary cards */
.ts-cards-row {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.ts-card {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}
.ts-card-label {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ts-card-value {
  font-weight: 700;
  color: var(--content-primary);
  font-variant-numeric: tabular-nums;
}
.ts-card-sub {
  color: var(--content-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  gap: 6px;
}

/* color helpers */
.ts-in  { color: rgb(var(--v-theme-secondary)); }
.ts-out { color: rgb(var(--v-theme-primary)); }
.ts-amber  { color: rgb(var(--v-theme-warning)); }
.ts-violet { color: rgb(var(--v-theme-primary)); }
.ts-faint  { color: var(--content-faint); }
.ts-subtle { color: var(--content-subtle); }
.ts-secondary { color: var(--content-secondary); }
.ts-dim { color: var(--content-dim); }
.ts-mono { font-family: ui-monospace, monospace; }
.ts-tabnum { font-variant-numeric: tabular-nums; }
.ts-semibold { font-weight: 600; }
.ts-mini-label { letter-spacing: 0.02em; color: var(--content-faint); }

/* sparkline */
.ts-spark-wrap {
  flex-shrink: 0;
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.ts-spark-header { display: flex; align-items: center; }
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
  background: rgba(var(--v-theme-secondary), 0.4);
  transition: background 0.15s;
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
  border-radius: 4px;
  white-space: nowrap;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: 1px solid var(--edge-default);
  pointer-events: none;
}

/* scrollable content */
.ts-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ts-section-title {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  margin: 0;
}
.ts-empty { color: var(--content-faint); text-align: center; }

/* agent bar rows */
.ts-agent-rows { display: flex; flex-direction: column; gap: 6px; }
.ts-agent-row { display: flex; align-items: center; }
.ts-agent-name {
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
.ts-bar-wrap {
  flex: 1;
  height: 20px;
  background: var(--surface-secondary);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}
.ts-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(to right, rgba(var(--v-theme-secondary),0.6), rgba(var(--v-theme-primary),0.6));
  transition: width 0.3s;
}
.ts-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: 10px;
  color: var(--content-secondary);
}
.ts-agent-totals {
  flex-shrink: 0;
  display: flex;
  font-size: 10px;
  width: 160px;
  justify-content: flex-end;
}

/* session table */
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
  transition: background 0.15s;
}
.ts-tbody-row:hover { background: rgba(var(--v-theme-surface-secondary), 0.4); }
.ts-td { padding: 6px 8px; }
.ts-td--right { text-align: right; }
.ts-agent-badge { padding: 2px 6px; border-radius: 4px; font-weight: 500; }

/* footer */
.ts-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.ts-refresh-btn {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  border-radius: 4px !important;
  color: var(--content-subtle) !important;
  transition: color 0.15s, background 0.15s;
}
.ts-refresh-btn:hover { color: var(--content-secondary) !important; background: var(--surface-secondary) !important; }
.ts-refresh-btn--spinning { animation: tspin 1s linear infinite; }
@keyframes tspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
