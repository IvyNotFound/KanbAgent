<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentAccent, agentBorder } from '@renderer/utils/agentColor'

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

const loading = ref(false)
async function refresh(): Promise<void> {
  loading.value = true
  try { await store.refresh() } finally { loading.value = false }
}
</script>

<template>
  <div class="tp-view">
    <!-- Header -->
    <div class="tp-header">
      <h2 class="tp-title text-h6 font-weight-medium">{{ t('topology.title') }}</h2>
      <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loading" :title="t('common.refresh')" @click="refresh" />
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
            <v-chip
              v-if="perimetre !== '__global__'"
              size="small"
              variant="outlined"
              :style="{ color: agentAccent(perimetre), borderColor: agentBorder(perimetre) }"
              class="tp-scope-chip"
            >{{ perimetre }}</v-chip>
            <v-chip
              v-else
              size="small"
              variant="outlined"
              class="tp-scope-chip tp-scope-chip--global"
            >{{ t('topology.global') }}</v-chip>
            <span class="tp-col-count">{{ perimAgents.length }}</span>
          </div>

          <!-- Agent cards -->
          <div class="tp-cards">
            <v-card
              v-for="agent in perimAgents"
              :key="agent.id"
              :variant="agentStatus(agent) === 'idle' ? 'outlined' : 'tonal'"
              :color="agentStatus(agent) === 'active' ? 'primary' : agentStatus(agent) === 'blocked' ? 'warning' : undefined"
              class="tp-card"
              @click="onAgentClick(agent)"
            >
              <div class="tp-card-inner" :title="t('topology.filterByAgent', { name: agent.name })">
                <div class="tp-card-top">
                  <span class="tp-agent-name" :style="{ color: agentAccent(agent.name) }">{{ agent.name }}</span>
                  <v-chip
                    :color="agentStatus(agent) === 'active' ? 'primary' : agentStatus(agent) === 'blocked' ? 'warning' : undefined"
                    size="x-small"
                    variant="tonal"
                    class="tp-status-chip"
                  ><span class="tp-status-dot mr-1" :class="`tp-dot--${agentStatus(agent)}`"></span>{{ t(`topology.status.${agentStatus(agent)}`) }}</v-chip>
                </div>
                <p class="tp-agent-type">{{ agent.type }}</p>
                <p v-if="agent.current_task" class="tp-task text-label-medium" :title="agent.current_task">{{ agent.current_task }}</p>
                <p v-if="agent.session_tokens != null && agent.session_tokens > 0" class="tp-tokens">
                  {{ agent.session_tokens.toLocaleString() }} {{ t('topology.tokens') }}
                </p>
              </div>
            </v-card>
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
  background: var(--surface-primary);
  overflow: hidden;
}
.tp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.tp-title { color: var(--content-primary); margin: 0; }
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

.tp-scroll { flex: 1; min-height: 0; overflow: auto; }
.tp-columns { display: flex; gap: 16px; padding: 16px; min-height: 100%; }
.tp-column { display: flex; flex-direction: column; flex: 1; min-width: 180px; max-width: 320px; }
.tp-col-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }

.tp-scope-chip { font-size: 12px !important; }
.tp-scope-chip--global {
  color: var(--content-subtle) !important;
  border-color: var(--edge-default) !important;
}
.tp-col-count { font-size: 0.6875rem; color: var(--content-faint); }

.tp-cards { display: flex; flex-direction: column; gap: 8px; }
.tp-card {
  width: 100%;
  overflow: hidden;
  cursor: pointer;
}
.tp-card-inner {
  padding: 10px 12px;
}
.tp-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; min-width: 0; }
.tp-agent-name {
  font-size: 0.75rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-status-chip { flex-shrink: 0; }
.tp-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.tp-dot--active  { background: rgb(var(--v-theme-primary)); }
.tp-dot--blocked { background: rgb(var(--v-theme-warning)); }
.tp-dot--idle    { background: var(--content-faint); }
.tp-agent-type { font-size: 0.6875rem; color: var(--content-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
.tp-task { font-size: 0.6875rem; color: var(--content-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; display: block; margin: 2px 0 0; }
.tp-tokens { font-size: 0.6875rem; color: var(--content-faint); font-variant-numeric: tabular-nums; margin: 2px 0 0; }
</style>
