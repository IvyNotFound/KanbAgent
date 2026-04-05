<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentAccent } from '@renderer/utils/agentColor'

const { t } = useI18n()
const store = useTasksStore()

interface WorkloadRow {
  agentId: number
  agentName: string
  taskCount: number
  totalEffort: number
  currentTask: string | null
}

// Derived from store.tasks + store.agents — no IPC call needed (T1116)
const rows = computed<WorkloadRow[]>(() => {
  const map = new Map<number, WorkloadRow>()
  for (const agent of store.agents) {
    map.set(agent.id, {
      agentId: agent.id,
      agentName: agent.name,
      taskCount: 0,
      totalEffort: 0,
      currentTask: null,
    })
  }
  for (const task of store.tasks) {
    if (task.status !== 'todo' && task.status !== 'in_progress') continue
    if (task.agent_assigned_id == null) continue
    const row = map.get(task.agent_assigned_id)
    if (!row) continue
    row.taskCount++
    row.totalEffort += task.effort ?? 0
    if (task.status === 'in_progress' && !row.currentTask) row.currentTask = task.title
  }
  return [...map.values()].sort((a, b) => {
    if (b.totalEffort !== a.totalEffort) return b.totalEffort - a.totalEffort
    if (b.taskCount !== a.taskCount) return b.taskCount - a.taskCount
    return a.agentName.localeCompare(b.agentName)
  })
})

const maxEffort = computed(() =>
  rows.value.reduce((max, r) => Math.max(max, r.totalEffort), 1)
)
</script>

<template>
  <div class="wl-view">
    <!-- Header -->
    <div class="wl-header">
      <h2 class="wl-title text-body-2 font-weight-medium">{{ t('workload.title') }}</h2>
      <v-btn variant="text" size="small" class="wl-refresh-btn" @click="store.refresh()">{{ t('common.refresh') }}</v-btn>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="wl-state-center">
      <p class="wl-loading text-body-2">{{ t('common.loading') }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="rows.length === 0" class="wl-state-center">
      <p class="wl-empty text-body-2">{{ t('workload.noAgents') }}</p>
    </div>

    <!-- Table -->
    <div v-else class="wl-table">
      <!-- Column headers -->
      <div class="wl-cols wl-cols-head text-label-medium">
        <span>{{ t('workload.agent') }}</span>
        <span class="wl-right">{{ t('workload.tasks') }}</span>
        <span class="wl-right">{{ t('workload.effort') }}</span>
        <span>{{ t('workload.bar') }}</span>
        <span>{{ t('workload.current') }}</span>
      </div>

      <!-- Rows -->
      <div
        v-for="row in rows"
        :key="row.agentId"
        class="wl-cols wl-cols-row"
      >
        <span class="wl-agent-name" :style="{ color: agentAccent(row.agentName) }">{{ row.agentName }}</span>
        <span class="wl-num wl-right">{{ row.taskCount }}</span>
        <span class="wl-num wl-right">{{ row.totalEffort }}</span>
        <div class="wl-bar-bg">
          <div
            class="wl-bar-fill"
            :style="{
              width: maxEffort > 0 ? (row.totalEffort / maxEffort * 100) + '%' : '0%',
              backgroundColor: agentAccent(row.agentName)
            }"
          />
        </div>
        <span
          v-if="row.currentTask"
          class="wl-current text-label-medium"
          :title="row.currentTask"
        >{{ row.currentTask }}</span>
        <span v-else class="wl-current wl-dash text-label-medium">—</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wl-view {
  display: flex;
  flex-direction: column;
  border-radius: var(--shape-sm);
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  overflow: hidden;
}
.wl-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  background: var(--surface-base);
}
.wl-title { color: var(--content-secondary); }
.wl-refresh-btn {
  color: var(--content-subtle) !important;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}
.wl-refresh-btn:hover { color: var(--content-secondary) !important; }
.wl-state-center { display: flex; align-items: center; justify-content: center; padding: 32px; }
.wl-loading {}
.wl-empty {}
@keyframes wlPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

.wl-table { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.wl-cols {
  display: grid;
  grid-template-columns: minmax(120px,1fr) 60px 60px minmax(0,2fr) minmax(0,1fr);
  gap: 12px;
  align-items: center;
}
.wl-cols-head {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--content-faint);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--edge-subtle);
  align-items: end;
}
.wl-cols-row { }
.wl-right { text-align: right; }
.wl-agent-name {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-num {
  font-size: 12px;
  color: var(--content-tertiary);
  font-family: ui-monospace, monospace;
}
.wl-bar-bg {
  height: 8px;
  background: var(--surface-tertiary);
  border-radius: var(--shape-full);
  overflow: hidden;
}
.wl-bar-fill {
  height: 100%;
  border-radius: var(--shape-full);
  transition: width var(--md-duration-medium4) var(--md-easing-emphasized-decelerate);
}
.wl-current {
  color: var(--content-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-dash { opacity: 0.4; }
</style>
