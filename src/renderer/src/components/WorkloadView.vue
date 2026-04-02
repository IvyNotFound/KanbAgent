<script setup lang="ts">
import { computed } from 'vue'
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
      <h2 class="wl-title">{{ t('workload.title') }}</h2>
      <button class="wl-refresh-btn" @click="store.refresh()">{{ t('common.refresh') }}</button>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="wl-state-center">
      <p class="wl-loading">{{ t('common.loading') }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="rows.length === 0" class="wl-state-center">
      <p class="wl-empty">{{ t('workload.noAgents') }}</p>
    </div>

    <!-- Table -->
    <div v-else class="wl-table">
      <!-- Column headers -->
      <div class="wl-cols wl-cols-head">
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
        <span class="wl-agent-name" :style="{ color: agentFg(row.agentName) }">{{ row.agentName }}</span>
        <span class="wl-num wl-right">{{ row.taskCount }}</span>
        <span class="wl-num wl-right">{{ row.totalEffort }}</span>
        <div class="wl-bar-bg">
          <div
            class="wl-bar-fill"
            :style="{
              width: maxEffort > 0 ? (row.totalEffort / maxEffort * 100) + '%' : '0%',
              backgroundColor: agentFg(row.agentName)
            }"
          />
        </div>
        <span
          v-if="row.currentTask"
          class="wl-current"
          :title="row.currentTask"
        >{{ row.currentTask }}</span>
        <span v-else class="wl-current wl-dash">—</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wl-view {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
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
.wl-title { font-size: 14px; font-weight: 600; color: var(--content-secondary); margin: 0; }
.wl-refresh-btn {
  font-size: 12px;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}
.wl-refresh-btn:hover { color: var(--content-secondary); }
.wl-state-center { display: flex; align-items: center; justify-content: center; padding: 32px; }
.wl-loading { font-size: 14px; color: var(--content-faint); animation: wlPulse 1.5s ease-in-out infinite; }
.wl-empty { font-size: 14px; color: var(--content-faint); font-style: italic; }
@keyframes wlPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

.wl-table { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.wl-cols {
  display: grid;
  grid-template-columns: minmax(120px,1fr) 60px 60px minmax(0,2fr) minmax(0,1fr);
  gap: 12px;
  align-items: center;
}
.wl-cols-head {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  border-radius: 9999px;
  overflow: hidden;
}
.wl-bar-fill {
  height: 100%;
  border-radius: 9999px;
  transition: width 0.5s;
}
.wl-current {
  font-size: 10px;
  color: var(--content-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-dash { opacity: 0.4; }
</style>
