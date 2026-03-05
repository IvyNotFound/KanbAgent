<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg } from '@renderer/utils/agentColor'
import type { AgentQualityRow } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()

const rows = ref<AgentQualityRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const filterPerimetre = ref<string | null>(null)

const perimetres = computed<string[]>(() => {
  const set = new Set<string>()
  rows.value.forEach(r => { if (r.agent_perimetre) set.add(r.agent_perimetre) })
  return Array.from(set).sort()
})

const filteredRows = computed(() =>
  filterPerimetre.value
    ? rows.value.filter(r => r.agent_perimetre === filterPerimetre.value)
    : rows.value
)

const globalRejectionRate = computed(() => {
  const total = filteredRows.value.reduce((s, r) => s + r.total_tasks, 0)
  const rejected = filteredRows.value.reduce((s, r) => s + r.rejected_tasks, 0)
  if (total === 0) return 0
  return Math.round((rejected / total) * 1000) / 10
})

const hasRejections = computed(() => filteredRows.value.some(r => r.rejected_tasks > 0))

async function fetchQuality(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  error.value = null
  try {
    const result = await window.electronAPI.tasksQualityStats(store.dbPath)
    if (!result.success) {
      error.value = result.error ?? 'Unknown error'
      rows.value = []
    } else {
      rows.value = result.rows as AgentQualityRow[]
    }
  } catch (err) {
    error.value = String(err)
    rows.value = []
  } finally {
    loading.value = false
  }
}

function rateColor(rate: number): string {
  if (rate === 0) return '#22c55e'    // green-500
  if (rate < 20) return '#f97316'     // orange-500
  return '#ef4444'                     // red-500
}

function rateBarClass(rate: number): string {
  if (rate === 0) return 'bg-green-500'
  if (rate < 20) return 'bg-orange-500'
  return 'bg-red-500'
}

onMounted(fetchQuality)
watch(() => store.dbPath, fetchQuality)
</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary overflow-y-auto">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-5 py-3 border-b border-edge-subtle bg-surface-base">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold text-content-secondary">{{ t('quality.title') }}</h2>
        <!-- Perimetre filter -->
        <select
          v-if="perimetres.length > 1"
          v-model="filterPerimetre"
          class="text-xs bg-surface-secondary border border-edge-subtle rounded px-2 py-0.5 text-content-tertiary focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option :value="null">{{ t('quality.all') }}</option>
          <option v-for="p in perimetres" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <button
        class="text-xs text-content-subtle hover:text-content-secondary transition-colors"
        @click="fetchQuality"
      >{{ t('quality.refresh') }}</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint animate-pulse">{{ t('quality.loading') }}</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-red-400 italic">{{ t('quality.error', { msg: error }) }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="filteredRows.length === 0" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint italic">{{ t('quality.empty') }}</p>
    </div>

    <template v-else>
      <!-- Global indicator -->
      <div class="shrink-0 px-5 py-3 border-b border-edge-subtle bg-surface-base/60">
        <div class="flex items-center gap-4">
          <span class="text-[11px] text-content-faint uppercase tracking-wider font-semibold">{{ t('quality.rejectionRate') }}</span>
          <span
            class="text-lg font-mono font-bold"
            :style="{ color: rateColor(globalRejectionRate) }"
          >{{ globalRejectionRate }}%</span>
          <span v-if="!hasRejections" class="text-[11px] text-green-400 italic">{{ t('quality.noRejections') }}</span>
        </div>
        <p class="text-[10px] text-content-faint mt-1 italic">
          {{ t('quality.heuristicNote') }}
        </p>
      </div>

      <!-- Table -->
      <div class="px-5 py-4 space-y-2">
        <!-- Column headers -->
        <div class="grid grid-cols-[minmax(130px,1fr)_70px_60px_50px_minmax(0,2fr)] gap-3 text-[10px] font-semibold uppercase tracking-wider text-content-faint pb-1 border-b border-edge-subtle">
          <span>Agent</span>
          <span class="text-right">{{ t('quality.colTotal') }}</span>
          <span class="text-right">{{ t('quality.colRejected') }}</span>
          <span class="text-right">{{ t('quality.colRate') }}</span>
          <span>{{ t('quality.colBar') }}</span>
        </div>

        <!-- Rows -->
        <div
          v-for="row in filteredRows"
          :key="row.agent_id"
          class="grid grid-cols-[minmax(130px,1fr)_70px_60px_50px_minmax(0,2fr)] gap-3 items-center py-0.5"
        >
          <!-- Agent name -->
          <span
            class="text-xs font-mono font-semibold truncate"
            :style="{ color: agentFg(row.agent_name) }"
            :title="row.agent_name"
          >{{ row.agent_name }}</span>

          <!-- Total tasks -->
          <span class="text-xs text-content-tertiary text-right font-mono">{{ row.total_tasks }}</span>

          <!-- Rejected tasks -->
          <span
            class="text-xs text-right font-mono font-semibold"
            :style="{ color: row.rejected_tasks > 0 ? rateColor(row.rejection_rate) : 'inherit' }"
          >{{ row.rejected_tasks }}</span>

          <!-- Rate -->
          <span
            class="text-xs text-right font-mono"
            :style="{ color: rateColor(row.rejection_rate) }"
          >{{ row.rejection_rate }}%</span>

          <!-- Rate bar -->
          <div class="h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="rateBarClass(row.rejection_rate)"
              :style="{ width: row.rejection_rate + '%' }"
            ></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
