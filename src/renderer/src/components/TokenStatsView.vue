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
    <div class="ts-period-bar ga-2">
      <h2 class="ts-title text-h6 font-weight-medium">{{ t('tokenStats.title') }}</h2>
      <span class="ts-period-label text-label-medium">{{ t('tokenStats.period.label') }}</span>
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
    </div>

    <!-- ── Summary cards ──────────────────────────────────────────────── -->
    <div class="ts-cards-row ga-3 py-3 px-4">
      <!-- Total tokens -->
      <v-card elevation="1" class="ts-metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="ts-metric-icon ts-metric-icon--cyan">
            <v-icon size="20" style="color: rgb(var(--v-theme-secondary))">mdi-counter</v-icon>
          </div>
          <div class="ts-metric-content">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatNumber(globalStats.total) }}</div>
            <div class="text-caption text-medium-emphasis">{{ t('tokenStats.total') }}</div>
            <div class="ts-card-sub ts-mono text-label-medium">
              <span class="ts-in">↓ {{ formatNumber(globalStats.tokens_in) }}</span>
              <span class="ts-out">↑ {{ formatNumber(globalStats.tokens_out) }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Sessions -->
      <v-card elevation="1" class="ts-metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="ts-metric-icon ts-metric-icon--emerald">
            <v-icon size="20" style="color: rgb(var(--v-theme-info))">mdi-play-circle-outline</v-icon>
          </div>
          <div class="ts-metric-content">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ globalStats.session_count }}</div>
            <div class="text-caption text-medium-emphasis">{{ t('tokenStats.sessions') }}</div>
            <div class="ts-card-sub text-label-medium">{{ t('tokenStats.avgPerSession') }} {{ formatNumber(avgPerSession) }}</div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Cache -->
      <v-card elevation="1" class="ts-metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="ts-metric-icon ts-metric-icon--amber">
            <v-icon size="20" style="color: rgb(var(--v-theme-warning))">mdi-cached</v-icon>
          </div>
          <div class="ts-metric-content">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatNumber(globalStats.tokens_cache_read + globalStats.tokens_cache_write) }}</div>
            <div class="text-caption text-medium-emphasis">{{ t('tokenStats.cache') }}</div>
            <div class="ts-card-sub ts-mono text-label-medium">
              <span class="ts-amber">R {{ formatNumber(globalStats.tokens_cache_read) }}</span>
              <span class="ts-violet">W {{ formatNumber(globalStats.tokens_cache_write) }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Cache hit rate — dynamic color via cacheHitColor computed -->
      <v-card elevation="1" class="ts-metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="ts-metric-icon ts-metric-icon--surface">
            <v-icon size="20" :style="{ color: cacheHitColor }">mdi-percent</v-icon>
          </div>
          <div class="ts-metric-content">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight" :style="{ color: cacheHitColor }">{{ cacheHitRate }}%</div>
            <div class="text-caption text-medium-emphasis">{{ t('tokenStats.cacheHit') }}</div>
            <div class="ts-card-sub text-label-medium">{{ t('tokenStats.cacheHitLabel') }}</div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Estimated cost -->
      <v-card elevation="1" class="ts-metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="ts-metric-icon ts-metric-icon--violet">
            <v-icon size="20" style="color: rgb(var(--v-theme-primary))">mdi-currency-usd</v-icon>
          </div>
          <div class="ts-metric-content">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatCost(estimatedCost) }}</div>
            <div class="text-caption text-medium-emphasis">{{ t('tokenStats.cost') }}</div>
            <div class="ts-card-sub ts-faint text-label-medium">{{ t('tokenStats.costNote') }}</div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Output ratio -->
      <v-card elevation="1" class="ts-metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="ts-metric-icon ts-metric-icon--violet">
            <v-icon size="20" style="color: rgb(var(--v-theme-primary))">mdi-arrow-up-circle-outline</v-icon>
          </div>
          <div class="ts-metric-content">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">
              {{ globalStats.total > 0 ? Math.round((globalStats.tokens_out / Math.max(globalStats.total, 1)) * 100) : 0 }}%
            </div>
            <div class="text-caption text-medium-emphasis">{{ t('tokenStats.ratio') }}</div>
            <div class="ts-card-sub text-label-medium">
              <span class="ts-out">{{ t('tokenStats.outputRatio') }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </div>

    <!-- ── Content (scrollable) ───────────────────────────────────────── -->
    <div class="ts-content py-3 px-4 ga-4">
      <!-- ── Sparkline 30 days ─────────────────────────────────────────── -->
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

      <!-- ── Cost analytics section ─────────────────────────────────── -->
      <v-card elevation="0" class="ts-section-card">
        <div class="ts-section-header">
          <span class="text-body-2 font-weight-medium ts-section-title">{{ t('costStats.title') }}</span>
        </div>
        <div class="pa-3">
          <CostStatsSection :db-path="store.dbPath" :period="costPeriod" />
        </div>
      </v-card>

      <!-- ── Per-agent table with bars ──────────────────────────────── -->
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
              <span
                v-if="row.agent_name"
                class="ts-agent-name"
                :style="agentStyles.get(row.agent_name)"
                :title="row.agent_name"
              >{{ row.agent_name }}</span>
              <span v-else class="ts-agent-name ts-dim">—</span>

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

      <!-- ── Per-session table ──────────────────────────────────────── -->
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
      </v-card>
    </div>

    <!-- Refresh button -->
    <div class="ts-footer py-2 px-4">
      <v-btn
        icon="mdi-refresh"
        variant="text"
        size="small"
        :loading="loading"
        :title="t('common.refresh')"
        @click="refresh"
      />
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
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.ts-title { color: var(--content-primary); margin: 0; margin-right: 8px; }
.ts-period-label { letter-spacing: 0.02em; color: var(--content-faint); }
.ts-period-toggle { height: 28px; }

/* summary cards grid */
.ts-cards-row {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}

/* MD3 metric cards */
.ts-metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}
.ts-metric-card:hover {
  border-color: var(--edge-subtle) !important;
}

.ts-metric-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--shape-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ts-metric-icon--cyan    { background-color: rgba(var(--v-theme-secondary), 0.15); }
.ts-metric-icon--violet  { background-color: rgba(var(--v-theme-primary), 0.15); }
.ts-metric-icon--emerald { background-color: rgba(var(--v-theme-info), 0.15); }
.ts-metric-icon--amber   { background-color: rgba(var(--v-theme-warning), 0.15); }
.ts-metric-icon--surface { background-color: rgba(var(--v-theme-on-surface), 0.08); }

.lh-tight { line-height: 1.2; }
.ts-metric-content { min-width: 0; flex: 1; }

/* sub-line in metric cards */
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

/* scrollable content */
.ts-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* widget section cards (sparkline, cost, agent, session) */
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

/* agent bar rows */
.ts-agent-rows { display: flex; flex-direction: column; gap: 6px; }
.ts-agent-row { display: flex; align-items: center; }
.ts-agent-name {
  flex-shrink: 0;
  width: 128px;
  font-size: 0.6875rem;
  padding: 2px 6px;
  border-radius: var(--shape-xs);
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
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.ts-tbody-row:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }
.ts-td { padding: 6px 8px; }
.ts-td--right { text-align: right; }
.ts-agent-badge { padding: 2px 6px; border-radius: var(--shape-xs); font-size: 0.6875rem; font-weight: 500; }

/* footer */
.ts-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
</style>
