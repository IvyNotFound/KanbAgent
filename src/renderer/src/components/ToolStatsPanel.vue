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
</script>

<template>
  <div class="tool-stats-panel">
    <!-- Header -->
    <div class="tool-stats-header">
      <h2 class="text-h6 font-weight-medium">{{ t('toolStats.title') }}</h2>
    </div>

    <!-- Empty state -->
    <div v-if="toolStats.length === 0" class="d-flex flex-column align-center justify-center flex-1 pa-12 ga-3">
      <v-icon size="32" color="medium-emphasis">mdi-tools</v-icon>
      <p class="text-caption text-medium-emphasis font-italic">{{ t('toolStats.empty') }}</p>
    </div>

    <!-- Table -->
    <div v-else class="tool-stats-body pa-6">
      <v-table density="compact" hover class="rounded">
        <thead>
          <tr>
            <th class="text-left text-label-medium ts-th" @click="setSort('calls')">
              {{ t('toolStats.tool') }}
            </th>
            <th class="text-right text-label-medium ts-th" @click="setSort('calls')">
              {{ t('toolStats.calls') }}
              <v-icon v-if="sortKey === 'calls'" size="14">
                {{ sortDesc ? 'mdi-arrow-down' : 'mdi-arrow-up' }}
              </v-icon>
            </th>
            <th class="text-right text-label-medium ts-th" @click="setSort('errors')">
              {{ t('toolStats.errors') }}
              <v-icon v-if="sortKey === 'errors'" size="14">
                {{ sortDesc ? 'mdi-arrow-down' : 'mdi-arrow-up' }}
              </v-icon>
            </th>
            <th class="text-right text-label-medium ts-th" @click="setSort('errorRate')">
              {{ t('toolStats.errorRate') }}
              <v-icon v-if="sortKey === 'errorRate'" size="14">
                {{ sortDesc ? 'mdi-arrow-down' : 'mdi-arrow-up' }}
              </v-icon>
            </th>
            <th class="text-right text-label-medium ts-th" @click="setSort('avgDurationMs')">
              {{ t('toolStats.avgDuration') }}
              <v-icon v-if="sortKey === 'avgDurationMs'" size="14">
                {{ sortDesc ? 'mdi-arrow-down' : 'mdi-arrow-up' }}
              </v-icon>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sorted" :key="row.name">
            <td class="py-2">
              <v-chip
                :color="toolColor(row.name)"
                size="small"
                variant="tonal"
                class="font-weight-medium ts-chip"
              >{{ row.name }}</v-chip>
            </td>
            <td class="text-right text-medium-emphasis ts-mono">{{ row.calls }}</td>
            <td
              class="text-right ts-mono"
              :class="row.errors > 0 ? 'text-error' : 'text-medium-emphasis'"
            >{{ row.errors }}</td>
            <td
              class="text-right ts-mono"
              :class="row.errorRate > 0 ? 'text-error' : 'text-medium-emphasis'"
            >{{ row.errors > 0 ? (row.errorRate * 100).toFixed(0) + '%' : '—' }}</td>
            <td
              class="text-right ts-mono"
              :class="row.avgDurationMs !== null && row.avgDurationMs > 5000 ? 'text-warning' : 'text-medium-emphasis'"
            >{{ formatDuration(row.avgDurationMs) }}</td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </div>
</template>

<style scoped>
.tool-stats-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.tool-stats-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.tool-stats-body {
  flex: 1;
  overflow-y: auto;
}
.ts-th {
  cursor: pointer;
  user-select: none;
}
.ts-mono {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
}
.ts-chip {
  font-family: ui-monospace, monospace;
}
</style>
