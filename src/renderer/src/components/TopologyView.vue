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
  <div class="flex flex-col h-full bg-surface-primary overflow-hidden">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-5 py-3 border-b border-edge-subtle bg-surface-base">
      <h2 class="text-sm font-semibold text-content-secondary">{{ t('topology.title') }}</h2>
      <button
        class="text-xs text-content-subtle hover:text-content-secondary transition-colors"
        @click="store.refresh()"
      >{{ t('common.refresh') }}</button>
    </div>

    <!-- Loading -->
    <div v-if="store.loading && rows.length === 0" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint animate-pulse">{{ t('common.loading') }}</p>
    </div>

    <!-- Empty -->
    <div v-else-if="!store.loading && rows.length === 0" class="flex items-center justify-center flex-1 py-12">
      <p class="text-sm text-content-faint italic">{{ t('topology.noAgents') }}</p>
    </div>

    <!-- Columns by perimeter -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto">
      <div class="flex gap-4 p-4 min-h-full">
        <div
          v-for="[perimetre, perimAgents] in grouped"
          :key="perimetre"
          class="flex flex-col flex-1 min-w-[180px] max-w-xs"
        >
          <!-- Column header -->
          <div class="mb-3 flex items-center gap-2">
            <span
              v-if="perimetre !== '__global__'"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono border"
              :style="{ color: agentFg(perimetre), backgroundColor: agentBg(perimetre), borderColor: agentBorder(perimetre) }"
            >{{ perimetre }}</span>
            <span
              v-else
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono border text-content-subtle bg-surface-secondary border-edge-default"
            >{{ t('topology.global') }}</span>
            <span class="text-[10px] text-content-faint font-mono">{{ perimAgents.length }}</span>
          </div>

          <!-- Agent cards -->
          <div class="flex flex-col gap-2">
            <button
              v-for="agent in perimAgents"
              :key="agent.id"
              class="w-full text-left rounded-lg border px-3 py-2.5 transition-colors hover:border-edge-default group"
              :class="[
                agentStatus(agent) === 'active'
                  ? 'bg-emerald-500/5 border-emerald-500/30 hover:bg-emerald-500/10'
                  : agentStatus(agent) === 'blocked'
                    ? 'bg-orange-500/5 border-orange-500/30 hover:bg-orange-500/10'
                    : 'bg-surface-secondary border-edge-subtle'
              ]"
              :title="t('topology.filterByAgent', { name: agent.name })"
              @click="onAgentClick(agent)"
            >
              <!-- Agent name + status badge -->
              <div class="flex items-center justify-between gap-2 mb-1">
                <span
                  class="text-xs font-mono font-semibold truncate"
                  :style="{ color: agentFg(agent.name) }"
                >{{ agent.name }}</span>
                <!-- Status badge -->
                <span
                  class="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                  :class="[
                    agentStatus(agent) === 'active'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : agentStatus(agent) === 'blocked'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-surface-tertiary text-content-faint'
                  ]"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :class="[
                      agentStatus(agent) === 'active' ? 'bg-emerald-400' :
                      agentStatus(agent) === 'blocked' ? 'bg-orange-400' : 'bg-content-faint'
                    ]"
                  ></span>
                  {{ t(`topology.status.${agentStatus(agent)}`) }}
                </span>
              </div>

              <!-- Agent type -->
              <p class="text-[10px] text-content-faint font-mono truncate">{{ agent.type }}</p>

              <!-- Current task (if active) -->
              <p
                v-if="agent.current_task"
                class="mt-1 text-[10px] text-content-subtle truncate"
                :title="agent.current_task"
              >{{ agent.current_task }}</p>

              <!-- Session tokens (if active) -->
              <p
                v-if="agent.session_tokens != null && agent.session_tokens > 0"
                class="mt-0.5 text-[10px] text-content-faint font-mono tabular-nums"
              >{{ agent.session_tokens.toLocaleString() }} {{ t('topology.tokens') }}</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
