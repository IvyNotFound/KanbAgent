<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import TelemetryLanguageSection from './TelemetryLanguageSection.vue'
import TelemetryStatCards from './TelemetryStatCards.vue'

const { t } = useI18n()
const store = useTasksStore()

interface LangStat {
  name: string
  files: number
  lines: number
  percent: number
  sourceFiles?: number
  testFiles?: number
  sourceLines?: number
  testLines?: number
  blankLines?: number
  commentLines?: number
  codeLines?: number
}

interface TelemetryResult {
  languages: LangStat[]
  totalFiles: number
  totalLines: number
  scannedAt: string
  totalSourceLines?: number
  totalTestLines?: number
  testRatio?: number
  totalBlankLines?: number
  totalCommentLines?: number
  totalCodeLines?: number
  totalSourceFiles?: number
  totalTestFiles?: number
}

const data = ref<TelemetryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const hasAdvancedMetrics = computed(() => data.value?.testRatio != null)

const sourcePercent = computed(() => {
  if (!data.value || !hasAdvancedMetrics.value) return 0
  const total = (data.value.totalSourceLines ?? 0) + (data.value.totalTestLines ?? 0)
  return total > 0 ? Math.round(((data.value.totalSourceLines ?? 0) / total) * 1000) / 10 : 0
})

const testPercent = computed(() => {
  if (!data.value || !hasAdvancedMetrics.value) return 0
  return data.value.testRatio ?? 0
})

const commentPercent = computed(() => {
  if (!data.value || !data.value.totalLines) return 0
  return Math.round(((data.value.totalCommentLines ?? 0) / data.value.totalLines) * 1000) / 10
})

const blankPercent = computed(() => {
  if (!data.value || !data.value.totalLines) return 0
  return Math.round(((data.value.totalBlankLines ?? 0) / data.value.totalLines) * 1000) / 10
})

const codePercent = computed(() => {
  if (!data.value || !data.value.totalLines) return 0
  return Math.round(((data.value.totalCodeLines ?? 0) / data.value.totalLines) * 1000) / 10
})

const hasLangAdvanced = computed(() =>
  data.value?.languages.some((l) => l.sourceLines != null) ?? false,
)

async function scan(): Promise<void> {
  if (!store.projectPath) return
  loading.value = true
  error.value = null
  try {
    data.value = await window.electronAPI.telemetryScan(store.projectPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Scan failed'
  } finally {
    loading.value = false
  }
}

function formatLines(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

onMounted(scan)
</script>

<template>
  <div class="telemetry-view">
    <!-- Header -->
    <div class="telem-header">
      <h2 class="telem-title text-h6 font-weight-medium">{{ t('telemetry.title') }}</h2>
      <v-btn
        variant="text"
        size="small"
        class="telem-rescan-btn ga-2"
        :disabled="loading || !store.projectPath"
        @click="scan"
      >
        <span v-if="loading" class="telem-rescan-loading ga-2">
          <v-progress-circular class="telem-spin" indeterminate :size="16" :width="2" />
          {{ t('telemetry.scanning') }}
        </span>
        <span v-else>{{ t('telemetry.rescan') }}</span>
      </v-btn>
    </div>

    <!-- Scrollable body -->
    <div class="telem-body">
      <!-- No project guard -->
      <div v-if="!store.projectPath" class="telem-state-center telem-subtle ga-3 text-body-2">
        {{ t('telemetry.noProject') }}
      </div>

      <!-- Loading state -->
      <div v-else-if="loading && !data" class="telem-state-center telem-muted ga-3 text-body-2">
        <v-progress-circular class="telem-spin telem-spin-lg" indeterminate :size="32" :width="3" />
        {{ t('telemetry.scanningProject') }}
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="telem-state-center telem-error ga-3 text-body-2">
        {{ error }}
      </div>

      <!-- Data -->
      <template v-else-if="data">
        <!-- Stat cards (extracted) -->
        <TelemetryStatCards :data="data" :has-advanced-metrics="hasAdvancedMetrics" :format-lines="formatLines" />

        <!-- Language breakdown + table (extracted) -->
        <TelemetryLanguageSection :languages="data.languages" :has-lang-advanced="hasLangAdvanced" />

        <!-- Source / Test bar -->
        <v-card v-if="hasAdvancedMetrics" elevation="0" class="telem-metric-card telem-section-card">
          <div class="telem-section-header">
            <span class="text-body-2 font-weight-medium telem-section-title">{{ t('telemetry.sourceVsTests') }}</span>
            <span class="telem-test-pct text-caption text-medium-emphasis">{{ testPercent.toFixed(1) }}% tests</span>
          </div>
          <div class="pa-4 d-flex flex-column ga-2">
            <div class="telem-lang-bar">
              <div
                class="telem-lang-segment"
                :style="{ width: sourcePercent + '%', backgroundColor: 'rgba(var(--v-theme-primary), 0.65)' }"
                :title="`Source — ${sourcePercent.toFixed(1)}%`"
              />
              <div
                class="telem-lang-segment"
                :style="{ width: testPercent + '%', backgroundColor: 'rgb(var(--v-theme-warning))' }"
                :title="`Tests — ${testPercent.toFixed(1)}%`"
              />
            </div>
            <div class="telem-legend-row ga-4 text-caption">
              <span class="telem-legend-item">
                <span class="telem-dot" style="background: rgba(var(--v-theme-primary), 0.65);" />
                {{ t('telemetry.sourceLabel', { percent: sourcePercent.toFixed(1) }) }}
              </span>
              <span class="telem-legend-item">
                <span class="telem-dot" style="background: rgb(var(--v-theme-warning));" />
                {{ t('telemetry.testsLabel', { percent: testPercent.toFixed(1) }) }}
              </span>
            </div>
          </div>
        </v-card>

        <!-- Code quality section -->
        <v-card v-if="hasAdvancedMetrics" elevation="0" class="telem-metric-card telem-section-card">
          <div class="telem-section-header">
            <span class="text-body-2 font-weight-medium telem-section-title">{{ t('telemetry.codeQuality') }}</span>
          </div>
          <div class="pa-4">
            <div class="telem-quality-grid ga-3">
              <v-card elevation="1" class="telem-metric-card">
                <v-card-text class="d-flex align-center ga-3 pa-4">
                  <div class="telem-metric-icon telem-metric-icon--violet">
                    <v-icon size="20" style="color: rgb(var(--v-theme-primary))">mdi-check-circle-outline</v-icon>
                  </div>
                  <div>
                    <div class="text-h6 font-weight-bold tabular-nums lh-tight telem-value--green">{{ codePercent.toFixed(1) }}%</div>
                    <div class="text-caption text-medium-emphasis">{{ t('telemetry.percentRealCode') }}</div>
                  </div>
                </v-card-text>
              </v-card>
              <v-card elevation="1" class="telem-metric-card">
                <v-card-text class="d-flex align-center ga-3 pa-4">
                  <div class="telem-metric-icon telem-metric-icon--cyan">
                    <v-icon size="20" style="color: rgb(var(--v-theme-secondary))">mdi-comment-text-outline</v-icon>
                  </div>
                  <div>
                    <div class="text-h6 font-weight-bold tabular-nums lh-tight telem-value--blue">{{ commentPercent.toFixed(1) }}%</div>
                    <div class="text-caption text-medium-emphasis">{{ t('telemetry.percentComments') }}</div>
                  </div>
                </v-card-text>
              </v-card>
              <v-card elevation="1" class="telem-metric-card">
                <v-card-text class="d-flex align-center ga-3 pa-4">
                  <div class="telem-metric-icon telem-metric-icon--surface">
                    <v-icon size="20" class="text-medium-emphasis">mdi-minus-circle-outline</v-icon>
                  </div>
                  <div>
                    <div class="text-h6 font-weight-bold tabular-nums lh-tight telem-muted">{{ blankPercent.toFixed(1) }}%</div>
                    <div class="text-caption text-medium-emphasis">{{ t('telemetry.percentBlank') }}</div>
                  </div>
                </v-card-text>
              </v-card>
            </div>
          </div>
        </v-card>

        <!-- Footer -->
        <p class="telem-footer text-caption">
          {{ t('telemetry.scannedAt', { date: formatDate(data.scannedAt) }) }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.telemetry-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--surface-base);
  color: var(--content-primary);
}

.telem-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.telem-title {
  color: var(--content-primary);
  margin: 0;
}

.telem-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.telem-body > * {
  flex-shrink: 0;
}

.telem-rescan-btn {
  background: var(--surface-tertiary) !important;
  color: var(--content-secondary) !important;
  border-radius: var(--shape-xs) !important;
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.telem-rescan-btn:hover:not(:disabled) { background: var(--surface-secondary) !important; }
.telem-rescan-loading { display: flex; align-items: center; }

.telem-spin { animation: telemSpin 1s linear infinite; }
.telem-spin { width: 16px; height: 16px; }
.telem-spin-lg { width: 20px; height: 20px; }
@keyframes telemSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.telem-state-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.telem-subtle { color: var(--content-subtle); }
.telem-muted { color: var(--content-muted); }
.telem-error { color: rgb(var(--v-theme-error)); }

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
.telem-metric-icon--violet  { background-color: rgba(var(--v-theme-primary), 0.15); }
.telem-metric-icon--cyan    { background-color: rgba(var(--v-theme-secondary), 0.15); }
.telem-metric-icon--surface { background-color: rgba(var(--v-theme-on-surface), 0.08); }

.lh-tight { line-height: 1.2; }

.telem-value--green { color: rgb(var(--v-theme-primary)); }
.telem-value--blue { color: rgb(var(--v-theme-secondary)); }

.telem-section-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.telem-section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.telem-section-title { color: var(--content-secondary); }

.telem-lang-bar {
  display: flex;
  height: 12px;
  border-radius: var(--shape-full);
  overflow: hidden;
  width: 100%;
}
.telem-lang-segment { transition: width var(--md-duration-medium2) var(--md-easing-standard); }

.telem-legend-row { display: flex; color: var(--content-muted); }
.telem-legend-item { display: flex; align-items: center; gap: 6px; }
.telem-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.telem-quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }

.telem-footer {}
</style>
