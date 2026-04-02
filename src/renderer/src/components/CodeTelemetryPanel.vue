/**
 * CodeTelemetryPanel — Compact code telemetry widget for DashboardOverview.
 *
 * Displays LOC, test ratio, and top-5 language breakdown from telemetryScan IPC.
 * Auto-scans on mount if projectPath is available. Refresh button re-triggers scan.
 *
 * @prop {string | null} projectPath - Absolute path to the project folder.
 */
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  projectPath: string | null
}>()

interface LangStat {
  name: string
  color: string
  files: number
  lines: number
  percent: number
}

interface TelemetryResult {
  languages: LangStat[]
  totalFiles: number
  totalLines: number
  scannedAt: string
  totalCodeLines?: number
  testRatio?: number
  totalSourceFiles?: number
  totalTestFiles?: number
}

const data = ref<TelemetryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function scan(): Promise<void> {
  if (!props.projectPath) return
  loading.value = true
  error.value = null
  try {
    data.value = await window.electronAPI.telemetryScan(props.projectPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => { if (props.projectPath) scan() })
watch(() => props.projectPath, (v) => { if (v) scan() })

function formatLines(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Top 5 languages; remainder summed as "Others". */
const displayLangs = computed(() => {
  if (!data.value?.languages?.length) return []
  const sorted = [...data.value.languages].sort((a, b) => b.percent - a.percent)
  const top = sorted.slice(0, 5)
  const rest = sorted.slice(5)
  if (rest.length > 0) {
    const othersPercent = rest.reduce((s, l) => s + l.percent, 0)
    top.push({ name: t('dashboard.others'), color: '#6b7280', files: 0, lines: 0, percent: othersPercent })
  }
  return top
})

const totalLines = computed(() => data.value?.totalCodeLines ?? data.value?.totalLines ?? 0)
const testRatioVal = computed(() => data.value?.testRatio ?? null)
</script>

<template>
  <div class="telemetry-panel">
<!-- Header -->
    <div class="telemetry-header">
      <span class="telemetry-title">
        {{ t('dashboard.codeTelemetry') }}
      </span>
      <button
        class="telemetry-refresh-btn"
        :disabled="loading || !props.projectPath"
        :title="t('dashboard.scan')"
        @click="scan"
      >
        <!-- Refresh icon -->
        <v-icon
          class="telemetry-refresh-icon"
          :class="{ 'telemetry-refresh-icon--spin': loading }"
          size="18"
        >mdi-refresh</v-icon>
      </button>
    </div>

    <!-- Body -->
    <div class="telemetry-body">
<!-- No project -->
      <div v-if="!props.projectPath" class="telemetry-center">
        <p class="telemetry-empty-text">{{ t('common.noProject') }}</p>
      </div>

      <!-- Loading skeleton -->
      <template v-else-if="loading && !data">
        <div class="telemetry-skeleton">
          <div class="telemetry-skeleton-block telemetry-skeleton-block--wide" />
          <div class="telemetry-skeleton-block telemetry-skeleton-block--full" />
          <div class="telemetry-skeleton-block telemetry-skeleton-block--3q" />
          <div class="telemetry-skeleton-block telemetry-skeleton-block--half" />
        </div>
      </template>

      <!-- Error -->
      <div v-else-if="error" class="telemetry-center">
        <p class="telemetry-error-text">{{ error }}</p>
      </div>

      <!-- Not yet scanned -->
      <div v-else-if="!data" class="telemetry-not-scanned">
        <p class="telemetry-empty-text">{{ t('dashboard.notScanned') }}</p>
        <button class="telemetry-scan-btn" @click="scan">
          {{ t('dashboard.scan') }}
        </button>
      </div>

      <!-- Data -->
      <template v-else>
<!-- Main LOC metric -->
        <div class="telemetry-loc-row">
          <span class="telemetry-loc-value">
            {{ formatLines(totalLines) }}
          </span>
          <span class="telemetry-loc-label">{{ t('dashboard.linesOfCode') }}</span>
          <span
            v-if="testRatioVal !== null"
            class="telemetry-test-ratio"
          >
            {{ testRatioVal.toFixed(1) }}% {{ t('dashboard.testRatio') }}
          </span>
        </div>

        <!-- Language bar -->
        <div v-if="displayLangs.length > 0" class="telemetry-lang-section">
          <div class="telemetry-lang-bar">
            <div
              v-for="lang in displayLangs"
              :key="lang.name"
              :style="{ width: lang.percent + '%', backgroundColor: lang.color }"
              :title="`${lang.name} — ${lang.percent.toFixed(1)}%`"
              class="telemetry-lang-segment"
            />
          </div>

          <!-- Lang legend — top 5 -->
          <div class="telemetry-lang-legend">
            <div
              v-for="lang in displayLangs"
              :key="lang.name"
              class="telemetry-lang-item"
            >
              <span
                class="telemetry-lang-dot"
                :style="{ backgroundColor: lang.color }"
              />
              <span class="telemetry-lang-name">{{ lang.name }}</span>
              <span class="telemetry-lang-pct">
                {{ lang.percent.toFixed(1) }}%
              </span>
            </div>
          </div>
        </div>
</template>
    </div>
  </div>
</template>

<style scoped>
.telemetry-panel {
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.telemetry-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.telemetry-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-secondary);
}
.telemetry-refresh-btn {
  padding: 2px;
  border-radius: 4px;
  color: var(--content-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}
.telemetry-refresh-btn:hover:not(:disabled) { color: var(--content-secondary); }
.telemetry-refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.telemetry-refresh-icon {
  width: 14px;
  height: 14px;
  display: block;
}
.telemetry-refresh-icon--spin { animation: telemetry-spin 1s linear infinite; }
@keyframes telemetry-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.telemetry-body {
  flex: 1;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.telemetry-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.telemetry-empty-text {
  font-size: 11px;
  color: var(--content-faint);
  font-style: italic;
  margin: 0;
  text-align: center;
}
.telemetry-error-text {
  font-size: 11px;
  color: #f87171;
  margin: 0;
}
.telemetry-not-scanned {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.telemetry-scan-btn {
  padding: 4px 12px;
  font-size: 11px;
  border-radius: 4px;
  background: var(--surface-tertiary);
  border: 1px solid var(--edge-default);
  color: var(--content-secondary);
  cursor: pointer;
  transition: background-color 0.15s;
}
.telemetry-scan-btn:hover { background: var(--edge-default); }
/* Skeleton loader */
.telemetry-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: telemetry-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes telemetry-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.telemetry-skeleton-block {
  height: 8px;
  border-radius: 9999px;
  background: rgba(63, 63, 70, 0.5);
}
.telemetry-skeleton-block--wide { height: 24px; width: 96px; }
.telemetry-skeleton-block--full { width: 100%; }
.telemetry-skeleton-block--3q { width: 75%; }
.telemetry-skeleton-block--half { width: 50%; }
/* LOC metric */
.telemetry-loc-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.telemetry-loc-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--content-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.telemetry-loc-label {
  font-size: 11px;
  color: var(--content-tertiary);
}
.telemetry-test-ratio {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: #fbbf24;
  font-variant-numeric: tabular-nums;
}
/* Language bar */
.telemetry-lang-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.telemetry-lang-bar {
  display: flex;
  height: 8px;
  border-radius: 9999px;
  overflow: hidden;
  width: 100%;
  gap: 1px;
}
.telemetry-lang-segment { transition: width 0.3s; }
.telemetry-lang-legend {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.telemetry-lang-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.telemetry-lang-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
}
.telemetry-lang-name {
  font-size: 11px;
  color: var(--content-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.telemetry-lang-pct {
  font-size: 11px;
  color: var(--content-faint);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
