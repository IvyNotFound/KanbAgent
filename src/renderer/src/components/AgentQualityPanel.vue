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
  if (rate === 0) return '#22c55e'    // green-500
  if (rate < 20) return '#f97316'     // orange-500
  return '#ef4444'                     // red-500
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
    <div class="quality-header">
      <div class="quality-header-left">
        <h2 class="quality-title">{{ t('quality.title') }}</h2>
        <!-- Perimetre filter -->
        <select
          v-if="perimetres.length > 1"
          v-model="filterPerimetre"
          class="quality-select"
        >
          <option :value="null">{{ t('quality.all') }}</option>
          <option v-for="p in perimetres" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <button class="quality-refresh-btn" @click="fetchQuality">{{ t('quality.refresh') }}</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="quality-state">
      <p class="quality-state-text quality-state-text--pulse">{{ t('quality.loading') }}</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="quality-state">
      <p class="quality-state-text quality-state-text--error">{{ t('quality.error', { msg: error }) }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="filteredRows.length === 0" class="quality-state">
      <p class="quality-state-text">{{ t('quality.empty') }}</p>
    </div>

    <template v-else>
      <!-- Global indicator -->
      <div class="quality-global">
        <div class="quality-global-rate">
          <span class="quality-rate-label">{{ t('quality.rejectionRate') }}</span>
          <span
            class="quality-rate-value"
            :style="{ color: rateColor(globalRejectionRate) }"
          >{{ globalRejectionRate }}%</span>
          <span v-if="!hasRejections" class="quality-no-rejections">{{ t('quality.noRejections') }}</span>
        </div>
        <p class="quality-heuristic-note">
          {{ t('quality.heuristicNote') }}
        </p>
      </div>

      <!-- Table -->
      <div class="quality-table">
        <!-- Column headers -->
        <div class="quality-row quality-header-row">
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
          class="quality-row quality-data-row"
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
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.quality-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.quality-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--content-secondary);
  margin: 0;
}
.quality-select {
  font-size: 11px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-subtle);
  border-radius: 4px;
  padding: 2px 8px;
  color: var(--content-tertiary);
  outline: none;
}
.quality-refresh-btn {
  font-size: 11px;
  color: var(--content-subtle);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}
.quality-refresh-btn:hover { color: var(--content-secondary); }
.quality-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}
.quality-state-text {
  font-size: 13px;
  color: var(--content-faint);
  font-style: italic;
  margin: 0;
}
.quality-state-text--pulse { animation: quality-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.quality-state-text--error { color: #f87171; }
@keyframes quality-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.quality-global {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  background: rgba(0, 0, 0, 0.06);
}
.quality-global-rate {
  display: flex;
  align-items: center;
  gap: 16px;
}
.quality-rate-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-faint);
  font-weight: 600;
}
.quality-rate-value {
  font-size: 18px;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}
.quality-no-rejections {
  font-size: 11px;
  color: #4ade80;
  font-style: italic;
}
.quality-heuristic-note {
  font-size: 10px;
  color: var(--content-faint);
  margin: 4px 0 0;
  font-style: italic;
}
.quality-table {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.quality-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) 70px 60px 50px minmax(0, 2fr);
  gap: 12px;
  align-items: center;
}
.quality-header-row {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-faint);
  padding-bottom: 4px;
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
.rate-bar--green { background: #22c55e; }
.rate-bar--orange { background: #f97316; }
.rate-bar--red { background: #ef4444; }
</style>
