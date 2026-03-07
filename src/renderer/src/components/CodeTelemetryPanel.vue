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
  <div class="rounded-lg bg-surface-secondary border border-edge-default overflow-hidden flex flex-col">

    <!-- Header -->
    <div class="shrink-0 px-3 py-2 border-b border-edge-subtle flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wider text-content-secondary">
        {{ t('dashboard.codeTelemetry') }}
      </span>
      <button
        class="p-0.5 rounded text-content-tertiary hover:text-content-secondary transition-colors disabled:opacity-40"
        :disabled="loading || !props.projectPath"
        :title="t('dashboard.scan')"
        @click="scan"
      >
        <!-- Refresh icon -->
        <svg
          class="w-3.5 h-3.5"
          :class="loading ? 'animate-spin' : ''"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M4 2a1 1 0 0 1 1 1v2.101a7.002 7.002 0 0 1 11.601 2.566 1 1 0 1 1-1.885.666A5.002 5.002 0 0 0 5.999 7H9a1 1 0 0 1 0 2H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm.008 9.057a1 1 0 0 1 1.276.61A5.002 5.002 0 0 0 14.001 13H11a1 1 0 1 1 0-2h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-2.101a7.002 7.002 0 0 1-11.601-2.566 1 1 0 0 1 .61-1.276z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
    </div>

    <!-- Body -->
    <div class="flex-1 px-3 py-3 flex flex-col gap-3">

      <!-- No project -->
      <div v-if="!props.projectPath" class="flex-1 flex items-center justify-center">
        <p class="text-xs text-content-faint italic">{{ t('common.noProject') }}</p>
      </div>

      <!-- Loading skeleton -->
      <template v-else-if="loading && !data">
        <div class="animate-pulse space-y-2">
          <div class="h-6 w-24 bg-zinc-700/50 rounded" />
          <div class="h-2 w-full bg-zinc-700/50 rounded-full" />
          <div class="h-2 w-3/4 bg-zinc-700/50 rounded-full" />
          <div class="h-2 w-1/2 bg-zinc-700/50 rounded-full" />
        </div>
      </template>

      <!-- Error -->
      <div v-else-if="error" class="flex-1 flex items-center justify-center">
        <p class="text-xs text-red-400">{{ error }}</p>
      </div>

      <!-- Not yet scanned -->
      <div v-else-if="!data" class="flex-1 flex flex-col items-center justify-center gap-2">
        <p class="text-xs text-content-faint text-center italic">{{ t('dashboard.notScanned') }}</p>
        <button
          class="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-content-secondary transition-colors"
          @click="scan"
        >
          {{ t('dashboard.scan') }}
        </button>
      </div>

      <!-- Data -->
      <template v-else>

        <!-- Main LOC metric -->
        <div class="flex items-baseline gap-1.5">
          <span class="text-2xl font-bold text-content-primary tabular-nums leading-tight">
            {{ formatLines(totalLines) }}
          </span>
          <span class="text-xs text-content-tertiary">{{ t('dashboard.linesOfCode') }}</span>
          <span
            v-if="testRatioVal !== null"
            class="ml-auto text-xs font-medium text-amber-400 tabular-nums"
          >
            {{ testRatioVal.toFixed(1) }}% {{ t('dashboard.testRatio') }}
          </span>
        </div>

        <!-- Language bar -->
        <div v-if="displayLangs.length > 0" class="flex flex-col gap-1.5">
          <div class="flex h-2 rounded-full overflow-hidden w-full gap-px">
            <div
              v-for="lang in displayLangs"
              :key="lang.name"
              :style="{ width: lang.percent + '%', backgroundColor: lang.color }"
              :title="`${lang.name} — ${lang.percent.toFixed(1)}%`"
              class="transition-all"
            />
          </div>

          <!-- Lang legend — top 5 -->
          <div class="flex flex-col gap-0.5">
            <div
              v-for="lang in displayLangs"
              :key="lang.name"
              class="flex items-center gap-1.5"
            >
              <span
                class="shrink-0 w-2 h-2 rounded-full"
                :style="{ backgroundColor: lang.color }"
              />
              <span class="text-[11px] text-content-secondary truncate flex-1">{{ lang.name }}</span>
              <span class="text-[11px] text-content-faint tabular-nums shrink-0">
                {{ lang.percent.toFixed(1) }}%
              </span>
            </div>
          </div>
        </div>

      </template>
    </div>
  </div>
</template>
