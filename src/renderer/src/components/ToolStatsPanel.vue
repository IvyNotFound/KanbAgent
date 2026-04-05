<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToolStats } from '@renderer/composables/useToolStats'
import { toolColor } from '@renderer/composables/useHookEventDisplay'

const { t } = useI18n()
const { toolStats } = useToolStats()

type SortKey = 'calls' | 'errors' | 'errorRate' | 'avgDurationMs'
const sortKey = ref<SortKey>('calls')
const sortDesc = ref(true)

function setSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDesc.value = !sortDesc.value
  } else {
    sortKey.value = key
    sortDesc.value = true
  }
}

const sorted = computed(() => {
  return [...toolStats.value].sort((a, b) => {
    const av = a[sortKey.value] ?? -1
    const bv = b[sortKey.value] ?? -1
    return sortDesc.value ? (bv as number) - (av as number) : (av as number) - (bv as number)
  })
})

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function sortIcon(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDesc.value ? ' ↓' : ' ↑'
}
</script>

<template>
  <div class="tool-stats-panel">
    <!-- Header -->
    <div class="tool-stats-header">
      <h2 class="tool-stats-title text-h6 font-weight-medium">{{ t('toolStats.title') }}</h2>
    </div>
    <!-- Empty state -->
    <div v-if="toolStats.length === 0" class="tool-stats-empty pa-12">
      <p class="tool-stats-empty-text px-4 text-caption">{{ t('toolStats.empty') }}</p>
    </div>

    <!-- Table -->
    <div v-else class="tool-stats-body pa-6">
      <div class="tool-stats-table-wrap">
        <table class="tool-stats-table text-caption">
          <thead>
            <tr class="tool-stats-thead-row">
              <th class="tool-stats-th tool-stats-th--left text-caption font-weight-medium" @click="setSort('calls')">
                {{ t('toolStats.tool') }}
              </th>
              <th class="tool-stats-th text-caption font-weight-medium" @click="setSort('calls')">
                {{ t('toolStats.calls') }}{{ sortIcon('calls') }}
              </th>
              <th class="tool-stats-th text-caption font-weight-medium" @click="setSort('errors')">
                {{ t('toolStats.errors') }}{{ sortIcon('errors') }}
              </th>
              <th class="tool-stats-th text-caption font-weight-medium" @click="setSort('errorRate')">
                {{ t('toolStats.errorRate') }}{{ sortIcon('errorRate') }}
              </th>
              <th class="tool-stats-th text-caption font-weight-medium" @click="setSort('avgDurationMs')">
                {{ t('toolStats.avgDuration') }}{{ sortIcon('avgDurationMs') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in sorted"
              :key="row.name"
              class="tool-stats-row"
            >
              <!-- Tool name -->
              <td class="tool-stats-td py-2 px-4 tool-stats-td--mono" :style="{ color: toolColor(row.name) }">{{ row.name }}</td>
              <!-- Calls -->
              <td class="tool-stats-td py-2 px-4 tool-stats-td--mono tool-stats-td--right tool-stats-td--muted">{{ row.calls }}</td>
              <!-- Errors -->
              <td
                class="tool-stats-td py-2 px-4 tool-stats-td--mono tool-stats-td--right"
                :class="row.errors > 0 ? 'tool-stats-td--error' : 'tool-stats-td--faint'"
              >
                {{ row.errors }}
              </td>
              <!-- Error rate -->
              <td
                class="tool-stats-td py-2 px-4 tool-stats-td--mono tool-stats-td--right"
                :class="row.errorRate > 0 ? 'tool-stats-td--error' : 'tool-stats-td--faint'"
              >
                {{ row.errors > 0 ? (row.errorRate * 100).toFixed(0) + '%' : '—' }}
              </td>
              <!-- Avg duration -->
              <td
                class="tool-stats-td py-2 px-4 tool-stats-td--mono tool-stats-td--right"
                :class="row.avgDurationMs !== null && row.avgDurationMs > 5000 ? 'tool-stats-td--warn' : 'tool-stats-td--faint'"
              >
                {{ formatDuration(row.avgDurationMs) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-stats-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-base);
  color: var(--content-primary);
}
.tool-stats-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.tool-stats-title {
  color: var(--content-primary);
  margin: 0;
}
.tool-stats-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
.tool-stats-empty-text {
  color: var(--content-faint);
  font-style: italic;
  text-align: center;
  margin: 0;
}
.tool-stats-body {
  flex: 1;
  overflow-y: auto;
}
.tool-stats-table-wrap {
  background: var(--surface-secondary);
  border-radius: 8px;
  border: 1px solid var(--edge-default);
  overflow-x: auto;
}
.tool-stats-table {
  width: 100%;
  border-collapse: collapse;
}
.tool-stats-thead-row {
  border-bottom: 1px solid var(--edge-default);
}
.tool-stats-th {
  padding: 10px 16px;
  letter-spacing: 0.02em;
  color: var(--content-muted);
  text-align: right;
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--surface-secondary);
  transition: color 0.15s;
}
.tool-stats-th:hover { color: var(--content-secondary); }
.tool-stats-th--left { text-align: left; }
.tool-stats-row {
  border-bottom: 1px solid rgba(var(--v-theme-surface-tertiary), 0.5);
  transition: background-color 0.15s;
}
.tool-stats-row:last-child { border-bottom: none; }
.tool-stats-row:hover { background: rgba(var(--v-theme-surface-tertiary), 0.3); }
.tool-stats-td--mono { font-family: ui-monospace, monospace; }
.tool-stats-td--right { text-align: right; }
.tool-stats-td--muted { color: var(--content-tertiary); }
.tool-stats-td--faint { color: var(--content-faint); }
.tool-stats-td--error { color: rgb(var(--v-theme-error)); }
.tool-stats-td--warn { color: rgb(var(--v-theme-warning)); }
</style>
