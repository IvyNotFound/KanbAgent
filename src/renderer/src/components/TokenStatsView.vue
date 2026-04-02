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
    <div class="ts-period-bar">
      <h2 class="ts-title">{{ t('tokenStats.title') }}</h2>
      <span class="ts-period-label">{{ t('tokenStats.period.label') }}</span>
      <div class="ts-period-btns">
        <button
          v-for="period in PERIODS"
          :key="period.key"
          class="ts-period-btn"
          :class="selectedPeriod === period.key ? 'ts-period-btn--active' : ''"
          @click="selectedPeriod = period.key"
        >
          {{ t(period.labelKey) }}
        </button>
      </div>
    </div>

    <!-- ── Summary cards ──────────────────────────────────────────────── -->
    <div class="ts-cards-row">
      <div class="ts-card">
        <span class="ts-card-label">{{ t('tokenStats.total') }}</span>
        <span class="ts-card-value">{{ formatNumber(globalStats.total) }}</span>
        <div class="ts-card-sub ts-mono">
          <span class="ts-in">↓ {{ formatNumber(globalStats.tokens_in) }}</span>
          <span class="ts-out">↑ {{ formatNumber(globalStats.tokens_out) }}</span>
        </div>
      </div>

      <div class="ts-card">
        <span class="ts-card-label">{{ t('tokenStats.sessions') }}</span>
        <span class="ts-card-value">{{ globalStats.session_count }}</span>
        <div class="ts-card-sub">
          {{ t('tokenStats.avgPerSession') }} {{ formatNumber(avgPerSession) }}
        </div>
      </div>

      <div class="ts-card">
        <span class="ts-card-label">{{ t('tokenStats.cache') }}</span>
        <span class="ts-card-value">{{ formatNumber(globalStats.tokens_cache_read + globalStats.tokens_cache_write) }}</span>
        <div class="ts-card-sub ts-mono">
          <span class="ts-amber">R {{ formatNumber(globalStats.tokens_cache_read) }}</span>
          <span class="ts-violet">W {{ formatNumber(globalStats.tokens_cache_write) }}</span>
        </div>
      </div>

      <div class="ts-card">
        <span class="ts-card-label">{{ t('tokenStats.cacheHit') }}</span>
        <span class="ts-card-value ts-tabnum" :class="cacheHitColor">{{ cacheHitRate }}%</span>
        <div class="ts-card-sub">{{ t('tokenStats.cacheHitLabel') }}</div>
      </div>

      <div class="ts-card">
        <span class="ts-card-label">{{ t('tokenStats.cost') }}</span>
        <span class="ts-card-value">{{ formatCost(estimatedCost) }}</span>
        <div class="ts-card-sub ts-faint">{{ t('tokenStats.costNote') }}</div>
      </div>

      <div class="ts-card">
        <span class="ts-card-label">{{ t('tokenStats.ratio') }}</span>
        <span class="ts-card-value">
          {{ globalStats.total > 0 ? Math.round((globalStats.tokens_out / Math.max(globalStats.total, 1)) * 100) : 0 }}%
        </span>
        <div class="ts-card-sub">
          <span class="ts-out">{{ t('tokenStats.outputRatio') }}</span>
        </div>
      </div>
    </div>

    <!-- ── Sparkline 30 days ─────────────────────────────────────────── -->
    <div class="ts-spark-wrap">
      <div class="ts-spark-header">
        <span class="ts-mini-label">{{ t('tokenStats.evolution') }}</span>
      </div>
      <div class="ts-spark-bars">
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
          <div v-if="hoveredSparkBar === i" class="ts-spark-tooltip">
            {{ bar.label }} : {{ formatNumber(bar.total) }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── Content (scrollable) ───────────────────────────────────────── -->
    <div class="ts-content">

      <!-- Cost analytics section (T769) -->
      <CostStatsSection :db-path="store.dbPath" :period="costPeriod" />

      <!-- Per-agent table with bars -->
      <section>
        <h3 class="ts-section-title">{{ t('tokenStats.perAgent') }}</h3>

        <div v-if="agentRows.length === 0" class="ts-empty">{{ t('tokenStats.noData') }}</div>

        <div v-else class="ts-agent-rows">
          <div
            v-for="row in agentRows"
            :key="row.agent_id"
            class="ts-agent-row"
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
              <span class="ts-bar-label ts-mono">{{ formatNumber(row.total) }}</span>
            </div>

            <div class="ts-agent-totals ts-mono">
              <span class="ts-in">↓{{ formatNumber(row.tokens_in) }}</span>
              <span class="ts-out">↑{{ formatNumber(row.tokens_out) }}</span>
              <span class="ts-faint">{{ row.session_count }}s</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Per-session table -->
      <section>
        <h3 class="ts-section-title">{{ t('tokenStats.perSession') }}</h3>

        <div v-if="sessionRows.length === 0" class="ts-empty">{{ t('tokenStats.noData') }}</div>

        <table v-else class="ts-table">
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
    <div class="ts-footer">
      <button
        class="ts-refresh-btn"
        :class="{ 'ts-refresh-btn--spinning': loading }"
        :title="t('logs.refresh')"
        @click="refresh"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
      </button>
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
  gap: 8px;
  padding: 12px 16px 8px;
}
.ts-title { font-size: 20px; font-weight: 600; color: var(--content-primary); margin: 0 8px 0 0; }
.ts-period-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--content-faint); }
.ts-period-btns { display: flex; gap: 4px; }
.ts-period-btn {
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 11px;
  border: 1px solid var(--edge-default);
  background: var(--surface-secondary);
  color: var(--content-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.ts-period-btn:hover { border-color: #6d28d9; color: var(--content-primary); }
.ts-period-btn--active { background: #6d28d9; border-color: #6d28d9; color: #fff; }

/* summary cards */
.ts-cards-row {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.ts-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}
.ts-card-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ts-card-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--content-primary);
  font-variant-numeric: tabular-nums;
}
.ts-card-sub {
  font-size: 10px;
  color: var(--content-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  gap: 6px;
}

/* color helpers */
.ts-in  { color: #34d399; }
.ts-out { color: #38bdf8; }
.ts-amber  { color: #fbbf24; }
.ts-violet { color: #a78bfa; }
.ts-faint  { color: var(--content-faint); }
.ts-subtle { color: var(--content-subtle); }
.ts-secondary { color: var(--content-secondary); }
.ts-dim { color: var(--content-dim); }
.ts-mono { font-family: ui-monospace, monospace; }
.ts-tabnum { font-variant-numeric: tabular-nums; }
.ts-semibold { font-weight: 600; }
.ts-mini-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--content-faint); }

/* sparkline */
.ts-spark-wrap {
  flex-shrink: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.ts-spark-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.ts-spark-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
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
  background: rgba(52, 211, 153, 0.4);
  transition: background 0.15s;
}
.ts-spark-bar--hovered { background: #6d28d9; }
.ts-spark-zero { width: 100%; height: 2px; border-radius: 2px; background: var(--edge-subtle); }
.ts-spark-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  white-space: nowrap;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: 1px solid var(--edge-default);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  pointer-events: none;
}

/* scrollable content */
.ts-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ts-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-faint);
  margin: 0 0 8px;
}
.ts-empty { font-size: 14px; color: var(--content-faint); padding: 16px 0; text-align: center; }

/* agent bar rows */
.ts-agent-rows { display: flex; flex-direction: column; gap: 6px; }
.ts-agent-row { display: flex; align-items: center; gap: 12px; }
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
  background: linear-gradient(to right, rgba(52,211,153,0.6), rgba(56,189,248,0.6));
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
  gap: 8px;
  font-size: 10px;
  width: 160px;
  justify-content: flex-end;
}

/* session table */
.ts-table { width: 100%; font-size: 11px; border-collapse: collapse; }
.ts-thead-row {
  color: var(--content-faint);
  text-align: left;
  border-bottom: 1px solid var(--edge-subtle);
}
.ts-th { padding: 6px 8px; font-weight: 500; }
.ts-th--right { text-align: right; }
.ts-tbody-row {
  border-bottom: 1px solid rgba(39, 39, 42, 0.4);
  transition: background 0.15s;
}
.ts-tbody-row:hover { background: rgba(39, 39, 42, 0.4); }
.ts-td { padding: 6px 8px; }
.ts-td--right { text-align: right; }
.ts-agent-badge { padding: 2px 6px; border-radius: 4px; font-weight: 500; }

/* footer */
.ts-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 16px;
  border-top: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.ts-refresh-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.ts-refresh-btn:hover { color: var(--content-secondary); background: var(--surface-secondary); }
.ts-refresh-btn--spinning { animation: tspin 1s linear infinite; }
@keyframes tspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
