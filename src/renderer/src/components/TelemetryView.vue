<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'

const { t } = useI18n()
const store = useTasksStore()

interface LangStat {
  name: string
  color: string
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
      <h2 class="telem-title">{{ t('telemetry.title') }}</h2>
      <button
        class="telem-rescan-btn"
        :disabled="loading || !store.projectPath"
        @click="scan"
      >
        <span v-if="loading" class="telem-rescan-loading">
          <v-progress-circular class="telem-spin" indeterminate :size="16" :width="2" />
          {{ t('telemetry.scanning') }}
        </span>
        <span v-else>{{ t('telemetry.rescan') }}</span>
      </button>
    </div>

    <!-- No project guard -->
    <div v-if="!store.projectPath" class="telem-state-center telem-subtle">
      {{ t('telemetry.noProject') }}
    </div>

    <!-- Loading state -->
    <div v-else-if="loading && !data" class="telem-state-center telem-muted telem-gap">
      <v-progress-circular class="telem-spin telem-spin-lg" indeterminate :size="32" :width="3" />
      {{ t('telemetry.scanningProject') }}
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="telem-state-center telem-error">
      {{ error }}
    </div>

    <!-- Data -->
    <template v-else-if="data">
      <!-- Stat cards -->
      <div class="telem-stat-grid" :class="hasAdvancedMetrics ? 'telem-stat-grid--wide' : ''">
        <div class="telem-stat-card">
          <span class="telem-stat-label">{{ t('telemetry.totalLines') }}</span>
          <span class="telem-stat-value">{{ formatLines(data.totalLines) }}</span>
        </div>
        <div v-if="hasAdvancedMetrics" class="telem-stat-card">
          <span class="telem-stat-label">{{ t('telemetry.realCode') }}</span>
          <span class="telem-stat-value">{{ formatLines(data.totalCodeLines ?? 0) }}</span>
        </div>
        <div class="telem-stat-card">
          <span class="telem-stat-label">{{ t('telemetry.totalFiles') }}</span>
          <span class="telem-stat-value">{{ data.totalFiles.toLocaleString() }}</span>
        </div>
        <div v-if="hasAdvancedMetrics" class="telem-stat-card">
          <span class="telem-stat-label">{{ t('telemetry.testFiles') }}</span>
          <span class="telem-stat-value">{{ (data.totalTestFiles ?? 0).toLocaleString() }}</span>
        </div>
        <div class="telem-stat-card">
          <span class="telem-stat-label">{{ t('telemetry.languages') }}</span>
          <span class="telem-stat-value">{{ data.languages.length }}</span>
        </div>
      </div>

      <!-- Language bar (GitHub-style) -->
      <div class="telem-section">
        <span class="telem-section-label">{{ t('telemetry.languageBreakdown') }}</span>
        <div class="telem-lang-bar">
          <div
            v-for="lang in data.languages"
            :key="lang.name"
            :style="{ width: lang.percent + '%', backgroundColor: lang.color }"
            :title="`${lang.name} — ${lang.percent.toFixed(1)}%`"
            class="telem-lang-segment"
          />
        </div>
        <div class="telem-lang-legend">
          <div
            v-for="lang in data.languages"
            :key="lang.name"
            class="telem-lang-legend-item"
          >
            <span class="telem-dot" :style="{ backgroundColor: lang.color }" />
            {{ lang.name }}
            <span class="telem-subtle">{{ lang.percent.toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <!-- Source / Test bar -->
      <div v-if="hasAdvancedMetrics" class="telem-section">
        <div class="telem-section-header">
          <span class="telem-section-label">{{ t('telemetry.sourceVsTests') }}</span>
          <span class="telem-test-pct">{{ testPercent.toFixed(1) }}% tests</span>
        </div>
        <div class="telem-lang-bar">
          <div
            class="telem-lang-segment"
            :style="{ width: sourcePercent + '%', backgroundColor: '#22c55e' }"
            :title="`Source — ${sourcePercent.toFixed(1)}%`"
          />
          <div
            class="telem-lang-segment"
            :style="{ width: testPercent + '%', backgroundColor: '#f59e0b' }"
            :title="`Tests — ${testPercent.toFixed(1)}%`"
          />
        </div>
        <div class="telem-legend-row">
          <span class="telem-legend-item">
            <span class="telem-dot" style="background:#22c55e;" />
            {{ t('telemetry.sourceLabel', { percent: sourcePercent.toFixed(1) }) }}
          </span>
          <span class="telem-legend-item">
            <span class="telem-dot" style="background:#f59e0b;" />
            {{ t('telemetry.testsLabel', { percent: testPercent.toFixed(1) }) }}
          </span>
        </div>
      </div>

      <!-- Code quality section -->
      <div v-if="hasAdvancedMetrics" class="telem-section">
        <span class="telem-section-label">{{ t('telemetry.codeQuality') }}</span>
        <div class="telem-quality-grid">
          <div class="telem-stat-card">
            <span class="telem-stat-label">{{ t('telemetry.percentRealCode') }}</span>
            <span class="telem-stat-value telem-value--green">{{ codePercent.toFixed(1) }}%</span>
          </div>
          <div class="telem-stat-card">
            <span class="telem-stat-label">{{ t('telemetry.percentComments') }}</span>
            <span class="telem-stat-value telem-value--blue">{{ commentPercent.toFixed(1) }}%</span>
          </div>
          <div class="telem-stat-card">
            <span class="telem-stat-label">{{ t('telemetry.percentBlank') }}</span>
            <span class="telem-stat-value telem-muted">{{ blankPercent.toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <!-- Detailed table -->
      <div class="telem-table-wrap">
        <table class="telem-table">
          <thead>
            <tr class="telem-thead-row">
              <th class="telem-th telem-th--left">{{ t('telemetry.colLanguage') }}</th>
              <th class="telem-th telem-th--right">{{ t('telemetry.colLines') }}</th>
              <th v-if="hasLangAdvanced" class="telem-th telem-th--right">{{ t('telemetry.colSource') }}</th>
              <th v-if="hasLangAdvanced" class="telem-th telem-th--right">{{ t('telemetry.colTests') }}</th>
              <th class="telem-th telem-th--right">{{ t('telemetry.colFiles') }}</th>
              <th class="telem-th telem-th--right">%</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="lang in data.languages"
              :key="lang.name"
              class="telem-tbody-row"
            >
              <td class="telem-td telem-td--lang">
                <span class="telem-dot" :style="{ backgroundColor: lang.color }" />
                <span class="telem-td-text">{{ lang.name }}</span>
              </td>
              <td class="telem-td telem-td--num telem-tertiary">{{ lang.lines.toLocaleString() }}</td>
              <td v-if="hasLangAdvanced" class="telem-td telem-td--num telem-value--green-soft">{{ (lang.sourceLines ?? 0).toLocaleString() }}</td>
              <td v-if="hasLangAdvanced" class="telem-td telem-td--num telem-value--amber-soft">{{ (lang.testLines ?? 0).toLocaleString() }}</td>
              <td class="telem-td telem-td--num telem-tertiary">{{ lang.files.toLocaleString() }}</td>
              <td class="telem-td telem-td--num telem-muted">{{ lang.percent.toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <p class="telem-footer">
        {{ t('telemetry.scannedAt', { date: formatDate(data.scannedAt) }) }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.telemetry-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  background-color: var(--surface-base);
  color: var(--content-primary);
  padding: 24px;
  gap: 24px;
}

.telem-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.telem-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--content-primary);
  margin: 0;
}
.telem-rescan-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 6px;
  background: var(--surface-tertiary);
  color: var(--content-secondary);
  font-size: 14px;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.telem-rescan-btn:hover:not(:disabled) { background: var(--surface-secondary); }
.telem-rescan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.telem-rescan-loading { display: flex; align-items: center; gap: 8px; }

.telem-spin { animation: telemSpin 1s linear infinite; }
.telem-spin-track { opacity: 0.25; }
.telem-spin-fill { opacity: 0.75; }
.telem-spin { width: 16px; height: 16px; }
.telem-spin-lg { width: 20px; height: 20px; }
@keyframes telemSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.telem-state-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  gap: 12px;
}
.telem-subtle { color: var(--content-subtle); }
.telem-muted { color: var(--content-muted); }
.telem-tertiary { color: var(--content-tertiary); }
.telem-error { color: #f87171; }
.telem-gap { gap: 12px; }

/* stat cards */
.telem-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.telem-stat-grid--wide { grid-template-columns: repeat(5, 1fr); }
.telem-stat-card {
  background: var(--surface-secondary);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--edge-default);
}
.telem-stat-label {
  font-size: 11px;
  color: var(--content-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.telem-stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--content-primary);
}
.telem-value--green { color: #4ade80; }
.telem-value--blue { color: #60a5fa; }
.telem-value--green-soft { color: rgba(74, 222, 128, 0.8); }
.telem-value--amber-soft { color: rgba(251, 191, 36, 0.8); }

/* sections */
.telem-section { display: flex; flex-direction: column; gap: 8px; }
.telem-section-header { display: flex; align-items: center; justify-content: space-between; }
.telem-section-label { font-size: 14px; font-weight: 500; color: var(--content-tertiary); }
.telem-test-pct { font-size: 12px; color: #f59e0b; font-weight: 500; }

/* language bar */
.telem-lang-bar {
  display: flex;
  height: 12px;
  border-radius: 9999px;
  overflow: hidden;
  width: 100%;
}
.telem-lang-segment { transition: width 0.3s; }
.telem-lang-legend {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 4px;
  margin-top: 4px;
}
.telem-lang-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--content-muted);
}
.telem-legend-row { display: flex; gap: 16px; font-size: 12px; color: var(--content-muted); }
.telem-legend-item { display: flex; align-items: center; gap: 6px; }
.telem-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

/* quality grid */
.telem-quality-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

/* table */
.telem-table-wrap {
  background: var(--surface-secondary);
  border-radius: 8px;
  border: 1px solid var(--edge-default);
  overflow-x: auto;
}
.telem-table { width: 100%; font-size: 14px; border-collapse: collapse; }
.telem-thead-row {
  border-bottom: 1px solid var(--edge-default);
  color: var(--content-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.telem-th { padding: 10px 16px; font-weight: 600; }
.telem-th--left { text-align: left; }
.telem-th--right { text-align: right; }
.telem-tbody-row {
  border-bottom: 1px solid rgba(63, 63, 70, 0.5);
  transition: background 0.15s;
}
.telem-tbody-row:last-child { border-bottom: none; }
.telem-tbody-row:hover { background: rgba(63, 63, 70, 0.3); }
.telem-td { padding: 8px 16px; }
.telem-td--lang { display: flex; align-items: center; gap: 8px; }
.telem-td--num { text-align: right; font-variant-numeric: tabular-nums; }
.telem-td-text { color: var(--content-secondary); }

.telem-footer { font-size: 12px; color: var(--content-subtle); }
</style>
