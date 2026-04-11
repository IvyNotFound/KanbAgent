<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  total: number
  tokensIn: number
  tokensOut: number
  sessionCount: number
  cacheTotal: number
  cacheRead: number
  cacheWrite: number
  cacheHitRate: number
  cacheHitColor: string
  estimatedCost: number
  avgPerSession: number
  formatNumber: (n: number) => string
  formatCost: (n: number) => string
}>()
</script>

<template>
  <div class="ts-cards-row ga-3 py-3 px-4">
    <!-- Total tokens -->
    <v-card elevation="1" class="ts-metric-card">
      <v-card-text class="d-flex align-center ga-3 pa-4">
        <div class="ts-metric-icon ts-metric-icon--cyan">
          <v-icon size="20" style="color: rgb(var(--v-theme-secondary))">mdi-counter</v-icon>
        </div>
        <div class="ts-metric-content">
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatNumber(total) }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('tokenStats.total') }}</div>
          <div class="ts-card-sub ts-mono text-label-medium">
            <span class="ts-in">↓ {{ formatNumber(tokensIn) }}</span>
            <span class="ts-out">↑ {{ formatNumber(tokensOut) }}</span>
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
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ sessionCount }}</div>
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
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatNumber(cacheTotal) }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('tokenStats.cache') }}</div>
          <div class="ts-card-sub ts-mono text-label-medium">
            <span class="ts-amber">R {{ formatNumber(cacheRead) }}</span>
            <span class="ts-violet">W {{ formatNumber(cacheWrite) }}</span>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <!-- Cache hit rate -->
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
            {{ total > 0 ? Math.round((tokensOut / Math.max(total, 1)) * 100) : 0 }}%
          </div>
          <div class="text-caption text-medium-emphasis">{{ t('tokenStats.ratio') }}</div>
          <div class="ts-card-sub text-label-medium">
            <span class="ts-out">{{ t('tokenStats.outputRatio') }}</span>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.ts-cards-row {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
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
.ts-card-sub {
  color: var(--content-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  gap: 6px;
}
.ts-in  { color: rgb(var(--v-theme-secondary)); }
.ts-out { color: rgb(var(--v-theme-primary)); }
.ts-amber  { color: rgb(var(--v-theme-warning)); }
.ts-violet { color: rgb(var(--v-theme-primary)); }
.ts-faint  { color: var(--content-faint); }
.ts-mono { font-family: ui-monospace, monospace; }
</style>
