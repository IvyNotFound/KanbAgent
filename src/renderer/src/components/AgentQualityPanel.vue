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
  rows.value.forEach(r => { if (r.agent_scope) set.add(r.agent_scope) })
  return Array.from(set).sort()
})

const filteredRows = computed(() =>
  filterPerimetre.value
    ? rows.value.filter(r => r.agent_scope === filterPerimetre.value)
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
  if (rate === 0) return 'rgb(var(--v-theme-secondary))'
  if (rate < 20) return 'rgb(var(--v-theme-warning))'
  return 'rgb(var(--v-theme-error))'
}

function rateBarClass(rate: number): string {
  if (rate === 0) return 'rate-bar--green'
  if (rate < 20) return 'rate-bar--orange'
  return 'rate-bar--red'
}

onMounted(fetchQuality)
watch(() => store.dbPath, fetchQuality)
</script>

<template>
  <div class="quality-panel">
    <!-- Header -->
    <div class="quality-header py-3 px-4">
      <div class="quality-header-left ga-3">
        <h2 class="quality-title text-caption">{{ t('quality.title') }}</h2>
        <!-- Perimetre filter -->
        <select
          v-if="perimetres.length > 1"
          v-model="filterPerimetre"
          class="quality-select text-caption font-weight-medium"
        >
          <option :value="null">{{ t('quality.all') }}</option>
          <option v-for="p in perimetres" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <v-btn variant="text" size="small" class="text-caption font-weight-medium" @click="fetchQuality">{{ t('quality.refresh') }}</v-btn>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="quality-state pa-8">
      <p class="quality-state-text quality-state-text--pulse text-caption">{{ t('quality.loading') }}</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="quality-state pa-8">
      <p class="quality-state-text quality-state-text--error text-caption">{{ t('quality.error', { msg: error }) }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="filteredRows.length === 0" class="quality-state pa-8">
      <p class="quality-state-text text-caption">{{ t('quality.empty') }}</p>
    </div>

    <template v-else>
      <!-- Global indicator -->
      <div class="quality-global py-3 px-4">
        <div class="quality-global-rate ga-4">
          <span class="quality-rate-label text-caption font-weight-medium">{{ t('quality.rejectionRate') }}</span>
          <span
            class="quality-rate-value"
            :style="{ color: rateColor(globalRejectionRate) }"
          >{{ globalRejectionRate }}%</span>
          <span v-if="!hasRejections" class="quality-no-rejections text-caption font-weight-medium">{{ t('quality.noRejections') }}</span>
        </div>
        <p class="quality-heuristic-note text-caption font-weight-medium mt-1">
          {{ t('quality.heuristicNote') }}
        </p>
      </div>

      <!-- Table -->
      <div class="quality-table py-3 px-4 ga-2">
        <!-- Column headers -->
        <div class="quality-row ga-3 quality-header-row text-caption font-weight-medium pb-1">
          <span>Agent</span>
          <span class="quality-col-right">{{ t('quality.colTotal') }}</span>
          <span class="quality-col-right">{{ t('quality.colRejected') }}</span>
          <span class="quality-col-right">{{ t('quality.colRate') }}</span>
          <span>{{ t('quality.colBar') }}</span>
        </div>

        <!-- Rows -->
        <div
          v-for="row in filteredRows"
          :key="row.agent_id"
          class="quality-row ga-3 quality-data-row"
        >
          <!-- Agent name -->
          <span
            class="quality-agent-name"
            :style="{ color: agentFg(row.agent_name) }"
            :title="row.agent_name"
          >{{ row.agent_name }}</span>

          <!-- Total tasks -->
          <span class="quality-col-mono quality-col-right quality-col-muted">{{ row.total_tasks }}</span>

          <!-- Rejected tasks -->
          <span
            class="quality-col-mono quality-col-right quality-col-bold"
            :style="{ color: row.rejected_tasks > 0 ? rateColor(row.rejection_rate) : 'inherit' }"
          >{{ row.rejected_tasks }}</span>

          <!-- Rate -->
          <span
            class="quality-col-mono quality-col-right"
            :style="{ color: rateColor(row.rejection_rate) }"
          >{{ row.rejection_rate }}%</span>

          <!-- Rate bar -->
          <div class="quality-rate-bar-track">
            <div
              class="quality-rate-bar-fill"
              :class="rateBarClass(row.rejection_rate)"
              :style="{ width: row.rejection_rate + '%' }"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.quality-panel {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  overflow: hidden;
}
.quality-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.quality-header-left {
  display: flex;
  align-items: center;
}
.quality-title {
  font-weight: 600;
  color: var(--content-secondary);
  margin: 0;
}
.quality-select {
  background: var(--surface-secondary);
  border: 1px solid var(--edge-subtle);
  border-radius: 4px;
  padding: 2px 8px;
  color: var(--content-tertiary);
  outline: none;
}
.quality-state {
  display: flex;
  align-items: center;
  justify-content: center;
}
.quality-state-text {
  color: var(--content-faint);
  font-style: italic;
  margin: 0;
}
.quality-state-text--pulse { animation: quality-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.quality-state-text--error { color: rgb(var(--v-theme-error)); }
@keyframes quality-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.quality-global {
  flex-shrink: 0;
  border-bottom: 1px solid var(--edge-subtle);
  background: rgba(0, 0, 0, 0.06);
}
.quality-global-rate {
  display: flex;
  align-items: center;
}
.quality-rate-label {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  font-weight: 600;
}
.quality-rate-value {
  font-size: 18px;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}
.quality-no-rejections {
  color: rgb(var(--v-theme-secondary));
  font-style: italic;
}
.quality-heuristic-note {
  color: var(--content-faint);
  margin: 0;
  font-style: italic;
}
.quality-table {
  display: flex;
  flex-direction: column;
}
.quality-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) 70px 60px 50px minmax(0, 2fr);
  align-items: center;
}
.quality-header-row {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--content-faint);
  border-bottom: 1px solid var(--edge-subtle);
}
.quality-data-row { padding: 2px 0; }
.quality-col-right { text-align: right; }
.quality-agent-name {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quality-col-mono {
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.quality-col-muted { color: var(--content-tertiary); }
.quality-col-bold { font-weight: 600; }
.quality-rate-bar-track {
  height: 6px;
  background: var(--surface-tertiary);
  border-radius: 9999px;
  overflow: hidden;
}
.quality-rate-bar-fill {
  height: 100%;
  border-radius: 9999px;
  transition: width 0.5s;
}
.rate-bar--green { background: rgb(var(--v-theme-secondary)); }
.rate-bar--orange { background: rgb(var(--v-theme-warning)); }
.rate-bar--red { background: rgb(var(--v-theme-error)); }
</style>
