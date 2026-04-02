/**
 * TokenTelemetryPanel — Aggregated token consumption panel.
 * Receives pre-fetched stats (today / 7d / all-time) from DashboardOverview.
 * Handles period tab switching internally.
 */
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

export interface TokenStats {
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  session_count: number
}

const props = defineProps<{
  statsToday: TokenStats
  stats7d: TokenStats
  statsAll: TokenStats
}>()

const { t } = useI18n()

const activeTab = ref<'today' | '7d' | 'all'>('today')

const currentStats = computed(() => {
  if (activeTab.value === '7d') return props.stats7d
  if (activeTab.value === 'all') return props.statsAll
  return props.statsToday
})

const TABS = [
  { key: 'today' as const, i18nKey: 'dashboard.today' },
  { key: '7d' as const, i18nKey: 'dashboard.last7days' },
  { key: 'all' as const, i18nKey: 'dashboard.allTime' },
]

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
</script>

<template>
  <div class="token-panel">
<!-- Header + period tabs -->
    <div class="token-header">
      <span class="token-title">
        {{ t('dashboard.telemetry') }}
      </span>
      <div class="token-tabs">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          class="token-tab"
          :class="{ 'token-tab--active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ t(tab.i18nKey) }}
        </button>
      </div>
    </div>

    <!-- 4 token metrics -->
    <div class="token-metrics">
<!-- Input tokens -->
      <div class="token-metric">
        <span class="token-metric-label">{{ t('dashboard.tokensIn') }}</span>
        <span class="token-metric-value">
          {{ formatTokens(currentStats.tokens_in) }}
        </span>
      </div>

      <!-- Output tokens -->
      <div class="token-metric">
        <span class="token-metric-label">{{ t('dashboard.tokensOut') }}</span>
        <span class="token-metric-value">
          {{ formatTokens(currentStats.tokens_out) }}
        </span>
      </div>

      <!-- Cache read (emerald — économique) -->
      <div class="token-metric">
        <span class="token-metric-label">{{ t('dashboard.tokensCacheRead') }}</span>
        <span class="token-metric-value token-metric-value--cache-read">
          {{ formatTokens(currentStats.tokens_cache_read) }}
        </span>
      </div>

      <!-- Cache write (amber) -->
      <div class="token-metric">
        <span class="token-metric-label">{{ t('dashboard.tokensCacheWrite') }}</span>
        <span class="token-metric-value token-metric-value--cache-write">
          {{ formatTokens(currentStats.tokens_cache_write) }}
        </span>
      </div>
</div>

    <!-- Session count -->
    <div class="token-sessions">
      <span class="token-sessions-text">
        {{ currentStats.session_count }} {{ t('dashboard.tokensSessions') }}
      </span>
    </div>
</div>
</template>

<style scoped>
.token-panel {
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  overflow: hidden;
}
.token-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.token-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-secondary);
}
.token-tabs {
  display: flex;
  gap: 4px;
}
.token-tab {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 500;
  background: transparent;
  border: none;
  color: var(--content-tertiary);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}
.token-tab:hover { color: var(--content-secondary); }
.token-tab--active {
  background: var(--surface-tertiary);
  color: var(--content-primary);
}
/* 4 token metrics */
.token-metrics {
  padding: 12px 16px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.token-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.token-metric-label {
  font-size: 11px;
  color: var(--content-tertiary);
}
.token-metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--content-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.token-metric-value--cache-read { color: #34d399; }
.token-metric-value--cache-write { color: #fbbf24; }
/* Session count */
.token-sessions {
  padding: 0 16px 12px;
}
.token-sessions-text {
  font-size: 11px;
  color: var(--content-faint);
  font-variant-numeric: tabular-nums;
}
</style>
