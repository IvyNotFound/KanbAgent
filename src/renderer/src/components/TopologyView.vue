<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

const { t } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

interface TopologyRow {
  id: number
  name: string
  type: string
  scope: string | null
  session_status: string | null
  session_tokens: number | null
  current_task: string | null
}

// Derived from store.agents + store.tasks — no IPC call needed (T1116)
// session_tokens comes from AGENT_CTE_SQL (tokens_in + tokens_out for active sessions)
const rows = computed<TopologyRow[]>(() => {
  const inProgressTask = new Map<number, string>()
  for (const task of store.tasks) {
    if (task.status === 'in_progress' && task.agent_assigned_id != null) {
      if (!inProgressTask.has(task.agent_assigned_id)) {
        inProgressTask.set(task.agent_assigned_id, task.title)
      }
    }
  }
  return store.agents.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    scope: a.scope,
    session_status: a.session_status ?? null,
    session_tokens: a.session_tokens ?? null,
    current_task: inProgressTask.get(a.id) ?? null,
  })).sort((a, b) => {
    const sa = a.scope ?? '\uffff'
    const sb = b.scope ?? '\uffff'
    if (sa !== sb) return sa.localeCompare(sb)
    if (a.type !== b.type) return a.type.localeCompare(b.type)
    return a.name.localeCompare(b.name)
  })
})

type AgentStatus = 'active' | 'blocked' | 'idle'

function agentStatus(row: TopologyRow): AgentStatus {
  if (!row.session_status) return 'idle'
  if (row.session_status === 'blocked') return 'blocked'
  return 'active'
}

// Group rows by scope — null scope goes into a dedicated "global" bucket
const grouped = computed(() => {
  const groups = new Map<string, TopologyRow[]>()
  for (const row of rows.value) {
    const key = row.scope ?? '__global__'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  // Named perimetres sorted alphabetically, then __global__ at the end
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === '__global__') return 1
    if (b === '__global__') return -1
    return a.localeCompare(b)
  })
})

function onAgentClick(row: TopologyRow): void {
  store.selectedAgentId = row.id
  tabsStore.setActive('backlog')
}
</script>

<template>
  <div class="tp-view">
    <!-- Header -->
    <div class="tp-header">
      <h2 class="tp-title text-h6">{{ t('topology.title') }}</h2>
      <v-btn variant="text" size="small" class="tp-refresh-btn" @click="store.refresh()">{{ t('common.refresh') }}</v-btn>
    </div>

    <!-- Loading -->
    <div v-if="store.loading && rows.length === 0" class="tp-state-center">
      <p class="tp-loading text-body-2">{{ t('common.loading') }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="!store.loading && rows.length === 0" class="tp-state-center">
      <p class="tp-empty text-body-2">{{ t('topology.noAgents') }}</p>
    </div>

    <!-- Columns by perimeter -->
    <div v-else class="tp-scroll">
      <div class="tp-columns">
        <div
          v-for="[perimetre, perimAgents] in grouped"
          :key="perimetre"
          class="tp-column"
        >
          <!-- Column header -->
          <div class="tp-col-header">
            <span
              v-if="perimetre !== '__global__'"
              class="tp-scope-badge"
              :style="{ color: agentFg(perimetre), backgroundColor: agentBg(perimetre), borderColor: agentBorder(perimetre) }"
            >{{ perimetre }}</span>
            <span v-else class="tp-scope-badge tp-scope-badge--global">{{ t('topology.global') }}</span>
            <span class="tp-col-count">{{ perimAgents.length }}</span>
          </div>

          <!-- Agent cards -->
          <div class="tp-cards">
            <v-btn
              v-for="agent in perimAgents"
              :key="agent.id"
              variant="text"
              block
              class="tp-card"
              :class="[
                agentStatus(agent) === 'active'  ? 'tp-card--active'  :
                agentStatus(agent) === 'blocked' ? 'tp-card--blocked' : 'tp-card--idle'
              ]"
              :title="t('topology.filterByAgent', { name: agent.name })"
              @click="onAgentClick(agent)"
            >
              <div class="tp-card-top">
                <span class="tp-agent-name" :style="{ color: agentFg(agent.name) }">{{ agent.name }}</span>
                <span class="tp-status-badge" :class="[
                  agentStatus(agent) === 'active'  ? 'tp-badge--active'  :
                  agentStatus(agent) === 'blocked' ? 'tp-badge--blocked' : 'tp-badge--idle'
                ]">
                  <span class="tp-status-dot" :class="[
                    agentStatus(agent) === 'active'  ? 'tp-dot--active'  :
                    agentStatus(agent) === 'blocked' ? 'tp-dot--blocked' : 'tp-dot--idle'
                  ]"></span>
                  {{ t(`topology.status.${agentStatus(agent)}`) }}
                </span>
              </div>
              <p class="tp-agent-type">{{ agent.type }}</p>
              <p v-if="agent.current_task" class="tp-task text-overline" :title="agent.current_task">{{ agent.current_task }}</p>
              <p v-if="agent.session_tokens != null && agent.session_tokens > 0" class="tp-tokens">
                {{ agent.session_tokens.toLocaleString() }} {{ t('topology.tokens') }}
              </p>
            </v-btn>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tp-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-base);
  overflow: hidden;
}
.tp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--edge-subtle);
}
.tp-title { font-weight: 500; color: var(--content-primary); margin: 0; }
.tp-refresh-btn {
  color: var(--content-subtle) !important;
  transition: color 0.15s;
}
.tp-refresh-btn:hover { color: var(--content-secondary) !important; }
.tp-state-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 48px;
}
.tp-loading {}
.tp-empty {}
@keyframes tpPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

.tp-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.tp-columns { display: flex; gap: 16px; padding: 16px; min-height: 100%; }
.tp-column { display: flex; flex-direction: column; flex: 1; min-width: 180px; max-width: 320px; }
.tp-col-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.tp-scope-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  border: 1px solid;
}
.tp-scope-badge--global {
  color: var(--content-subtle);
  background: var(--surface-secondary);
  border-color: var(--edge-default);
}
.tp-col-count { font-size: 10px; color: var(--content-faint); font-family: ui-monospace, monospace; }

.tp-cards { display: flex; flex-direction: column; gap: 8px; }
.tp-card {
  width: 100% !important;
  text-align: left !important;
  justify-content: flex-start !important;
  align-items: flex-start !important;
  height: auto !important;
  min-height: 0 !important;
  border-radius: 8px !important;
  border: 1px solid !important;
  padding: 10px 12px !important;
  overflow: hidden;
  transition: background 0.15s, border-color 0.15s;
}
.tp-card :deep(.v-btn__content) {
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
}
.tp-card--active  { background: rgba(var(--v-theme-secondary),0.05); border-color: rgba(var(--v-theme-secondary),0.3); }
.tp-card--active:hover  { background: rgba(var(--v-theme-secondary),0.10); }
.tp-card--blocked { background: rgba(var(--v-theme-warning),0.05); border-color: rgba(var(--v-theme-warning),0.3); }
.tp-card--blocked:hover { background: rgba(var(--v-theme-warning),0.10); }
.tp-card--idle    { background: var(--surface-secondary); border-color: var(--edge-subtle); }
.tp-card--idle:hover    { border-color: var(--edge-default); }

.tp-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.tp-agent-name {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-status-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 2px 6px;
  border-radius: 9999px;
}
.tp-badge--active  { background: rgba(var(--v-theme-secondary),0.2); color: rgb(var(--v-theme-secondary)); }
.tp-badge--blocked { background: rgba(var(--v-theme-warning),0.2); color: rgb(var(--v-theme-warning)); }
.tp-badge--idle    { background: var(--surface-tertiary); color: var(--content-faint); }
.tp-status-dot { width: 6px; height: 6px; border-radius: 50%; }
.tp-dot--active  { background: rgb(var(--v-theme-secondary)); }
.tp-dot--blocked { background: rgb(var(--v-theme-warning)); }
.tp-dot--idle    { background: var(--content-faint); }
.tp-agent-type { font-size: 10px; color: var(--content-faint); font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
.tp-task {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  margin: 0;
}
.tp-tokens { font-size: 10px; color: var(--content-faint); font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; margin: 2px 0 0; }
</style>
