<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'

const store = useTasksStore()

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
}

const data = ref<TelemetryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

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
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Total Lines</span>
          <span class="text-2xl font-bold text-content-primary">{{ formatLines(data.totalLines) }}</span>
        </div>
        <div class="bg-surface-secondary rounded-lg p-4 flex flex-col gap-1 border border-edge-default">
          <span class="text-xs text-content-muted uppercase tracking-wide">Total Files</span>
          <span class="text-2xl font-bold text-content-primary">{{ data.totalFiles.toLocaleString() }}</span>
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

      <!-- Detailed table -->
      <div class="bg-surface-secondary rounded-lg border border-edge-default overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-edge-default text-content-muted text-xs uppercase tracking-wide">
              <th class="text-left px-4 py-2.5">Language</th>
              <th class="text-right px-4 py-2.5">Lines</th>
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
