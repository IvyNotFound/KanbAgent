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
  <div class="rounded-lg bg-surface-secondary border border-edge-default overflow-hidden">

    <!-- Header + period tabs -->
    <div class="shrink-0 px-3 py-2 border-b border-edge-subtle flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wider text-content-secondary">
        {{ t('dashboard.telemetry') }}
      </span>
      <div class="flex gap-1">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          class="px-2 py-0.5 text-[11px] rounded font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'bg-zinc-700 text-content-primary'
            : 'text-content-tertiary hover:text-content-secondary'"
          @click="activeTab = tab.key"
        >
          {{ t(tab.i18nKey) }}
        </button>
      </div>
    </div>

    <!-- 4 token metrics -->
    <div class="px-3 py-3 grid grid-cols-4 gap-4">

      <!-- Input tokens -->
      <div class="flex flex-col gap-0.5">
        <span class="text-[11px] text-content-tertiary">{{ t('dashboard.tokensIn') }}</span>
        <span class="text-lg font-bold text-content-primary tabular-nums leading-tight">
          {{ formatTokens(currentStats.tokens_in) }}
        </span>
      </div>

      <!-- Output tokens -->
      <div class="flex flex-col gap-0.5">
        <span class="text-[11px] text-content-tertiary">{{ t('dashboard.tokensOut') }}</span>
        <span class="text-lg font-bold text-content-primary tabular-nums leading-tight">
          {{ formatTokens(currentStats.tokens_out) }}
        </span>
      </div>

      <!-- Cache read (emerald — économique) -->
      <div class="flex flex-col gap-0.5">
        <span class="text-[11px] text-content-tertiary">{{ t('dashboard.tokensCacheRead') }}</span>
        <span class="text-lg font-bold text-emerald-400 tabular-nums leading-tight">
          {{ formatTokens(currentStats.tokens_cache_read) }}
        </span>
      </div>

      <!-- Cache write (amber) -->
      <div class="flex flex-col gap-0.5">
        <span class="text-[11px] text-content-tertiary">{{ t('dashboard.tokensCacheWrite') }}</span>
        <span class="text-lg font-bold text-amber-400 tabular-nums leading-tight">
          {{ formatTokens(currentStats.tokens_cache_write) }}
        </span>
      </div>

    </div>

    <!-- Session count -->
    <div class="px-3 pb-2">
      <span class="text-[11px] text-content-faint tabular-nums">
        {{ currentStats.session_count }} {{ t('dashboard.tokensSessions') }}
      </span>
    </div>

  </div>
</template>
