<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'

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
  <div class="flex flex-col h-full overflow-auto bg-surface-base text-content-primary p-6 gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-content-primary">Telemetry</h2>
      <button
        class="px-4 py-1.5 rounded bg-surface-tertiary hover:bg-surface-secondary text-sm text-content-secondary transition-colors disabled:opacity-50"
        :disabled="loading || !store.projectPath"
        @click="scan"
      >
        <span v-if="loading" class="flex items-center gap-2">
          <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          Scanning…
        </span>
        <span v-else>Rescan</span>
      </button>
    </div>

    <!-- No project guard -->
    <div v-if="!store.projectPath" class="flex-1 flex items-center justify-center text-content-subtle text-sm">
      Open a project to view telemetry.
    </div>

    <!-- Loading state -->
    <div v-else-if="loading && !data" class="flex-1 flex items-center justify-center text-content-muted text-sm gap-3">
      <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      Scanning project…
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center text-red-400 text-sm">
      {{ error }}
    </div>

    <!-- Data -->
    <template v-else-if="data">
      <!-- Stat cards -->
      <div class="grid grid-cols-3 gap-4" :class="hasAdvancedMetrics ? 'lg:grid-cols-5' : ''">
        <div class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Total Lines</span>
          <span class="text-2xl font-bold text-content-primary">{{ formatLines(data.totalLines) }}</span>
        </div>
        <div v-if="hasAdvancedMetrics" class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Code réel</span>
          <span class="text-2xl font-bold text-content-primary">{{ formatLines(data.totalCodeLines ?? 0) }}</span>
        </div>
        <div class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Total Files</span>
          <span class="text-2xl font-bold text-content-primary">{{ data.totalFiles.toLocaleString() }}</span>
        </div>
        <div v-if="hasAdvancedMetrics" class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Fichiers test</span>
          <span class="text-2xl font-bold text-content-primary">{{ (data.totalTestFiles ?? 0).toLocaleString() }}</span>
        </div>
        <div class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Languages</span>
          <span class="text-2xl font-bold text-content-primary">{{ data.languages.length }}</span>
        </div>
      </div>

      <!-- Language bar (GitHub-style) -->
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-content-tertiary">Language breakdown</span>
        <div class="flex h-3 rounded-full overflow-hidden w-full">
          <div
            v-for="lang in data.languages"
            :key="lang.name"
            :style="{ width: lang.percent + '%', backgroundColor: lang.color }"
            :title="`${lang.name} — ${lang.percent.toFixed(1)}%`"
            class="transition-all"
          />
        </div>
        <!-- Legend -->
        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          <div
            v-for="lang in data.languages"
            :key="lang.name"
            class="flex items-center gap-1.5 text-xs text-content-muted"
          >
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: lang.color }" />
            {{ lang.name }}
            <span class="text-content-subtle">{{ lang.percent.toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <!-- Source / Test bar -->
      <div v-if="hasAdvancedMetrics" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-content-tertiary">Source vs Tests</span>
          <span class="text-xs text-amber-500 font-medium">{{ testPercent.toFixed(1) }}% tests</span>
        </div>
        <div class="flex h-3 rounded-full overflow-hidden w-full">
          <div
            class="transition-all"
            :style="{ width: sourcePercent + '%', backgroundColor: '#22c55e' }"
            :title="`Source — ${sourcePercent.toFixed(1)}%`"
          />
          <div
            class="transition-all"
            :style="{ width: testPercent + '%', backgroundColor: '#f59e0b' }"
            :title="`Tests — ${testPercent.toFixed(1)}%`"
          />
        </div>
        <div class="flex gap-4 text-xs text-content-muted">
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-green-500" />
            Source {{ sourcePercent.toFixed(1) }}%
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-500" />
            Tests {{ testPercent.toFixed(1) }}%
          </span>
        </div>
      </div>

      <!-- Code quality section -->
      <div v-if="hasAdvancedMetrics" class="flex flex-col gap-2">
        <span class="text-sm font-medium text-content-tertiary">Code quality</span>
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-surface-secondary rounded-lg p-3 flex flex-col gap-0.5 border border-edge-default">
            <span class="text-xs text-content-muted uppercase tracking-wide">% Code réel</span>
            <span class="text-xl font-bold text-green-400">{{ codePercent.toFixed(1) }}%</span>
          </div>
          <div class="bg-surface-secondary rounded-lg p-3 flex flex-col gap-0.5 border border-edge-default">
            <span class="text-xs text-content-muted uppercase tracking-wide">% Commentaires</span>
            <span class="text-xl font-bold text-blue-400">{{ commentPercent.toFixed(1) }}%</span>
          </div>
          <div class="bg-surface-secondary rounded-lg p-3 flex flex-col gap-0.5 border border-edge-default">
            <span class="text-xs text-content-muted uppercase tracking-wide">% Lignes vides</span>
            <span class="text-xl font-bold text-content-muted">{{ blankPercent.toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <!-- Detailed table -->
      <div class="bg-surface-secondary rounded-lg border border-edge-default overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-edge-default text-content-muted text-xs uppercase tracking-wide">
              <th class="text-left px-4 py-2.5">Language</th>
              <th class="text-right px-4 py-2.5">Lines</th>
              <th v-if="hasLangAdvanced" class="text-right px-4 py-2.5">Source</th>
              <th v-if="hasLangAdvanced" class="text-right px-4 py-2.5">Tests</th>
              <th class="text-right px-4 py-2.5">Files</th>
              <th class="text-right px-4 py-2.5">%</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="lang in data.languages"
              :key="lang.name"
              class="border-b border-edge-default/50 last:border-0 hover:bg-surface-tertiary/30 transition-colors"
            >
              <td class="px-4 py-2 flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: lang.color }" />
                <span class="text-content-secondary">{{ lang.name }}</span>
              </td>
              <td class="px-4 py-2 text-right text-content-tertiary tabular-nums">{{ lang.lines.toLocaleString() }}</td>
              <td v-if="hasLangAdvanced" class="px-4 py-2 text-right text-green-400/80 tabular-nums">{{ (lang.sourceLines ?? 0).toLocaleString() }}</td>
              <td v-if="hasLangAdvanced" class="px-4 py-2 text-right text-amber-400/80 tabular-nums">{{ (lang.testLines ?? 0).toLocaleString() }}</td>
              <td class="px-4 py-2 text-right text-content-tertiary tabular-nums">{{ lang.files.toLocaleString() }}</td>
              <td class="px-4 py-2 text-right text-content-muted tabular-nums">{{ lang.percent.toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <p class="text-xs text-content-subtle">
        Scanned at {{ formatDate(data.scannedAt) }}
      </p>
    </template>
  </div>
</template>
