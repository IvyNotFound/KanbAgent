<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface TelemetryData {
  totalLines: number
  totalFiles: number
  languages: unknown[]
  totalCodeLines?: number
  totalTestFiles?: number
}

defineProps<{
  data: TelemetryData
  hasAdvancedMetrics: boolean
  formatLines: (n: number) => string
}>()
</script>

<template>
  <div class="telem-stat-grid ga-4" :class="hasAdvancedMetrics ? 'telem-stat-grid--wide' : ''">
    <!-- Total Lines -->
    <v-card elevation="1" class="telem-metric-card">
      <v-card-text class="d-flex align-center ga-3 pa-4">
        <div class="telem-metric-icon telem-metric-icon--cyan">
          <v-icon size="20" style="color: rgb(var(--v-theme-secondary))">mdi-code-tags</v-icon>
        </div>
        <div>
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatLines(data.totalLines) }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('telemetry.totalLines') }}</div>
        </div>
      </v-card-text>
    </v-card>
    <!-- Real code (advanced only) -->
    <v-card v-if="hasAdvancedMetrics" elevation="1" class="telem-metric-card">
      <v-card-text class="d-flex align-center ga-3 pa-4">
        <div class="telem-metric-icon telem-metric-icon--violet">
          <v-icon size="20" style="color: rgb(var(--v-theme-primary))">mdi-code-braces</v-icon>
        </div>
        <div>
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ formatLines(data.totalCodeLines ?? 0) }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('telemetry.realCode') }}</div>
        </div>
      </v-card-text>
    </v-card>
    <!-- Total Files -->
    <v-card elevation="1" class="telem-metric-card">
      <v-card-text class="d-flex align-center ga-3 pa-4">
        <div class="telem-metric-icon telem-metric-icon--emerald">
          <v-icon size="20" style="color: rgb(var(--v-theme-info))">mdi-file-multiple-outline</v-icon>
        </div>
        <div>
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ data.totalFiles.toLocaleString() }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('telemetry.totalFiles') }}</div>
        </div>
      </v-card-text>
    </v-card>
    <!-- Test Files (advanced only) -->
    <v-card v-if="hasAdvancedMetrics" elevation="1" class="telem-metric-card">
      <v-card-text class="d-flex align-center ga-3 pa-4">
        <div class="telem-metric-icon telem-metric-icon--amber">
          <v-icon size="20" style="color: rgb(var(--v-theme-warning))">mdi-test-tube</v-icon>
        </div>
        <div>
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ (data.totalTestFiles ?? 0).toLocaleString() }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('telemetry.testFiles') }}</div>
        </div>
      </v-card-text>
    </v-card>
    <!-- Languages -->
    <v-card elevation="1" class="telem-metric-card">
      <v-card-text class="d-flex align-center ga-3 pa-4">
        <div class="telem-metric-icon telem-metric-icon--cyan">
          <v-icon size="20" style="color: rgb(var(--v-theme-secondary))">mdi-translate</v-icon>
        </div>
        <div>
          <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ data.languages.length }}</div>
          <div class="text-caption text-medium-emphasis">{{ t('telemetry.languages') }}</div>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.telem-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.telem-stat-grid--wide { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }

.telem-metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}
.telem-metric-card:hover {
  border-color: var(--edge-subtle) !important;
}

.telem-metric-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--shape-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.telem-metric-icon--cyan    { background-color: rgba(var(--v-theme-secondary), 0.15); }
.telem-metric-icon--violet  { background-color: rgba(var(--v-theme-primary), 0.15); }
.telem-metric-icon--emerald { background-color: rgba(var(--v-theme-info), 0.15); }
.telem-metric-icon--amber   { background-color: rgba(var(--v-theme-warning), 0.15); }

.lh-tight { line-height: 1.2; }
</style>
