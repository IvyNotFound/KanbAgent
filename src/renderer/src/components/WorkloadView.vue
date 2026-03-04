<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg } from '@renderer/utils/agentColor'

const { t } = useI18n()
const store = useTasksStore()

interface WorkloadRow {
  agentId: number
  agentName: string
  taskCount: number
  totalEffort: number
  currentTask: string | null
}

const rows = ref<WorkloadRow[]>([])
const loading = ref(false)

const maxEffort = computed(() =>
  rows.value.reduce((max, r) => Math.max(max, r.totalEffort), 1)
)

async function fetchWorkload(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  try {
    const result = await window.electronAPI.queryDb(
      store.dbPath,
      `SELECT a.id as agentId, a.name as agentName,
              COUNT(t.id) as taskCount,
              COALESCE(SUM(t.effort), 0) as totalEffort,
              MAX(CASE WHEN t.statut = 'in_progress' THEN t.titre ELSE NULL END) as currentTask
       FROM agents a
       LEFT JOIN tasks t ON t.agent_assigne_id = a.id AND t.statut IN ('todo','in_progress')
       GROUP BY a.id, a.name
       ORDER BY totalEffort DESC, taskCount DESC, a.name ASC`,
      []
    ) as WorkloadRow[]
    rows.value = result
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchWorkload)
watch(() => store.dbPath, fetchWorkload)
</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary overflow-y-auto">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-5 py-3 border-b border-edge-subtle bg-surface-base">
      <h2 class="text-sm font-semibold text-content-secondary">{{ t('workload.title') }}</h2>
      <button
        class="text-xs text-content-subtle hover:text-content-secondary transition-colors"
        @click="fetchWorkload"
      >{{ t('common.refresh') }}</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint animate-pulse">{{ t('common.loading') }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="rows.length === 0" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint italic">{{ t('workload.noAgents') }}</p>
    </div>

    <!-- Table -->
    <div v-else class="px-5 py-4 space-y-3">
      <!-- Column headers -->
      <div class="grid grid-cols-[minmax(120px,1fr)_60px_60px_minmax(0,2fr)_minmax(0,1fr)] gap-3 text-[10px] font-semibold uppercase tracking-wider text-content-faint pb-1 border-b border-edge-subtle">
        <span>{{ t('workload.agent') }}</span>
        <span class="text-right">{{ t('workload.tasks') }}</span>
        <span class="text-right">{{ t('workload.effort') }}</span>
        <span>{{ t('workload.bar') }}</span>
        <span>{{ t('workload.current') }}</span>
      </div>

      <!-- Rows -->
      <div
        v-for="row in rows"
        :key="row.agentId"
        class="grid grid-cols-[minmax(120px,1fr)_60px_60px_minmax(0,2fr)_minmax(0,1fr)] gap-3 items-center"
      >
        <!-- Agent name -->
        <span
          class="text-xs font-mono font-semibold truncate"
          :style="{ color: agentFg(row.agentName) }"
        >{{ row.agentName }}</span>

        <!-- Task count -->
        <span class="text-xs text-content-tertiary text-right font-mono">{{ row.taskCount }}</span>

        <!-- Total effort -->
        <span class="text-xs text-content-tertiary text-right font-mono">{{ row.totalEffort }}</span>

        <!-- Effort bar -->
        <div class="h-2 bg-surface-tertiary rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :style="{
              width: maxEffort > 0 ? (row.totalEffort / maxEffort * 100) + '%' : '0%',
              backgroundColor: agentFg(row.agentName)
            }"
          ></div>
        </div>

        <!-- Current in_progress task -->
        <span
          v-if="row.currentTask"
          class="text-[10px] text-content-faint truncate"
          :title="row.currentTask"
        >{{ row.currentTask }}</span>
        <span v-else class="text-[10px] text-content-faint opacity-40">—</span>
      </div>
    </div>
  </div>
</template>
