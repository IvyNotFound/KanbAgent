<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import type { AgentQualityRow } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()

const rows = ref<AgentQualityRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const globalRejectionRate = computed(() => {
  const total = rows.value.reduce((s, r) => s + r.total_tasks, 0)
  const rejected = rows.value.reduce((s, r) => s + r.rejected_tasks, 0)
  if (total === 0) return 0
  return Math.round((rejected / total) * 1000) / 10
})

const hasRejections = computed(() => rows.value.some(r => r.rejected_tasks > 0))

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

onMounted(fetchQuality)
watch(() => store.dbPath, fetchQuality)
</script>

<template>
  <div class="quality-panel">
    <!-- Header -->
    <div class="quality-header py-3 px-4">
      <h2 class="quality-title text-body-2 font-weight-medium">{{ t('quality.title') }}</h2>
      <v-btn icon="mdi-refresh" variant="text" size="small" color="primary" :title="t('quality.refresh')" @click="fetchQuality" />
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
    <div v-else-if="rows.length === 0" class="quality-state pa-8">
      <p class="quality-state-text text-caption">{{ t('quality.empty') }}</p>
    </div>

    <template v-else>
      <!-- Global indicator -->
      <div class="quality-global py-3 px-4">
        <div class="quality-global-rate">
          <span class="quality-rate-label text-body-2">{{ t('quality.rejectionRate') }}</span>
          <span
            class="quality-rate-value text-h6"
            :style="{ color: rateColor(globalRejectionRate) }"
          >{{ globalRejectionRate }}%</span>
          <span v-if="!hasRejections" class="quality-no-rejections text-body-2">{{ t('quality.noRejections') }}</span>
        </div>
        <p class="quality-heuristic-note text-body-2 mt-1">
          {{ t('quality.heuristicNote') }}
        </p>
      </div>

      <!-- Per-agent table -->
      <div class="quality-table">
        <!-- Column headers -->
        <div class="quality-cols quality-cols-head text-label-medium">
          <span>{{ t('quality.colAgent') }}</span>
          <span class="quality-right quality-col-span">{{ t('quality.colRejections') }}</span>
          <span></span>
          <span class="quality-right">{{ t('quality.colRate') }}</span>
        </div>

        <!-- Rows -->
        <div
          v-for="row in rows"
          :key="row.agent_id"
          class="quality-cols quality-cols-row"
        >
          <AgentBadge :name="row.agent_name" />
          <span class="quality-count quality-right quality-col-span">{{ row.rejected_tasks }}/{{ row.total_tasks }}</span>
          <div class="quality-bar-bg">
            <div
              class="quality-bar-fill"
              :style="{
                width: row.rejection_rate + '%',
                backgroundColor: rateColor(row.rejection_rate)
              }"
            />
          </div>
          <span
            class="quality-rate quality-right"
            :style="{ color: rateColor(row.rejection_rate) }"
          >{{ row.rejection_rate }}%</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.quality-panel {
  display: flex;
  flex-direction: column;
  border-radius: var(--shape-sm);
  background: var(--surface-primary);
  border: 1px solid var(--edge-default);
  overflow: hidden;
}
.quality-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--edge-subtle);
}
.quality-title {
  color: var(--content-secondary);
  margin: 0;
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
}
.quality-global-rate {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quality-rate-label {
  color: var(--content-faint);
}
.quality-rate-value {
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

/* Per-agent table — mirrors .wl-table pattern from WorkloadView */
.quality-table { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.quality-cols {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 60px 60px minmax(0, 2fr) minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
/* Rejection count spans the two numeric columns (2+3) to align bar at col4 with WorkloadView */
.quality-col-span { grid-column: 2 / 4; }
.quality-cols-head {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--content-faint);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--edge-subtle);
  align-items: end;
}
.quality-right { text-align: right; }
.quality-count {
  font-size: 12px;
  color: var(--content-tertiary);
  font-family: ui-monospace, monospace;
}
.quality-rate {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  font-weight: 600;
}
.quality-bar-bg {
  height: 8px;
  background: var(--surface-tertiary);
  border-radius: var(--shape-full);
  overflow: hidden;
}
.quality-bar-fill {
  height: 100%;
  border-radius: var(--shape-full);
  transition: width var(--md-duration-medium4) var(--md-easing-emphasized-decelerate);
}
</style>
