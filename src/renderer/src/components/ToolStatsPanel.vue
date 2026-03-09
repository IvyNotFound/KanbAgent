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
  <div class="flex flex-col h-full overflow-hidden bg-surface-base text-content-primary">
    <!-- Header -->
    <div class="shrink-0 flex items-center px-6 py-3 border-b border-edge-default">
      <h2 class="text-xl font-semibold text-content-primary">{{ t('toolStats.title') }}</h2>
    </div>
    <!-- Empty state -->
    <div v-if="toolStats.length === 0" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint italic text-center px-4">{{ t('toolStats.empty') }}</p>
    </div>

    <!-- Table -->
    <div v-else class="flex-1 overflow-y-auto p-6">
      <div class="bg-surface-secondary rounded-lg border border-edge-default overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0">
          <tr class="border-b border-edge-default text-content-muted text-xs uppercase tracking-wide">
            <th class="text-left px-4 py-2.5 cursor-pointer hover:text-content-secondary"
                @click="setSort('calls')">
              {{ t('toolStats.tool') }}
            </th>
            <th class="text-right px-4 py-2.5 cursor-pointer hover:text-content-secondary"
                @click="setSort('calls')">
              {{ t('toolStats.calls') }}{{ sortIcon('calls') }}
            </th>
            <th class="text-right px-4 py-2.5 cursor-pointer hover:text-content-secondary"
                @click="setSort('errors')">
              {{ t('toolStats.errors') }}{{ sortIcon('errors') }}
            </th>
            <th class="text-right px-4 py-2.5 cursor-pointer hover:text-content-secondary"
                @click="setSort('errorRate')">
              {{ t('toolStats.errorRate') }}{{ sortIcon('errorRate') }}
            </th>
            <th class="text-right px-4 py-2.5 cursor-pointer hover:text-content-secondary"
                @click="setSort('avgDurationMs')">
              {{ t('toolStats.avgDuration') }}{{ sortIcon('avgDurationMs') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sorted"
            :key="row.name"
            class="border-b border-edge-default/50 last:border-0 hover:bg-surface-tertiary/30 transition-colors"
          >
            <!-- Tool name -->
            <td class="px-4 py-2 font-mono" :class="toolColor(row.name)">{{ row.name }}</td>
            <!-- Calls -->
            <td class="px-4 py-2 text-right font-mono text-content-tertiary">{{ row.calls }}</td>
            <!-- Errors -->
            <td class="px-4 py-2 text-right font-mono"
                :class="row.errors > 0 ? 'text-red-400' : 'text-content-faint'">
              {{ row.errors }}
            </td>
            <!-- Error rate -->
            <td class="px-4 py-2 text-right font-mono"
                :class="row.errorRate > 0 ? 'text-red-400' : 'text-content-faint'">
              {{ row.errors > 0 ? (row.errorRate * 100).toFixed(0) + '%' : '—' }}
            </td>
            <!-- Avg duration -->
            <td class="px-4 py-2 text-right font-mono"
                :class="row.avgDurationMs !== null && row.avgDurationMs > 5000 ? 'text-amber-400' : 'text-content-faint'">
              {{ formatDuration(row.avgDurationMs) }}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </div>
</template>
