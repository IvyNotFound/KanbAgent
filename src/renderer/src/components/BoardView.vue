<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import { useLaunchSession } from '@renderer/composables/useLaunchSession'
import { useToast } from '@renderer/composables/useToast'
import StatusColumn from './StatusColumn.vue'

const { t, locale } = useI18n()
const store = useTasksStore()
const { launchAgentTerminal } = useLaunchSession()
const toast = useToast()

type BoardTab = 'backlog' | 'archive'
const activeTab = ref<BoardTab>('backlog')

const emptyTasks = { todo: [], in_progress: [], done: [], archived: [] }
const tasks = computed(() => store.tasksByStatus ?? emptyTasks)

// Auto-switch to Archive tab when backlog is empty but archives exist
const shouldAutoSwitchToArchive = computed(() => {
  const t = tasks.value
  const backlogCount = (t.todo?.length || 0) + (t.in_progress?.length || 0) + (t.done?.length || 0)
  const archiveCount = t.archived?.length || 0
  return backlogCount === 0 && archiveCount > 0
})

// Watch for backlog becoming empty and auto-switch to archive
watch(shouldAutoSwitchToArchive, (shouldSwitch) => {
  if (shouldSwitch) {
    activeTab.value = 'archive'
  }
})

const columns = computed(() => [
  { key: 'todo'        as const, title: t('columns.todo'),        accentClass: 'bg-amber-500' },
  { key: 'in_progress' as const, title: t('columns.in_progress'), accentClass: 'bg-emerald-500' },
  { key: 'done'        as const, title: t('columns.done'),        accentClass: 'bg-content-faint' },
])

const activeAgentName = computed(() =>
  store.selectedAgentId !== null
    ? (store.agents.find(a => Number(a.id) === Number(store.selectedAgentId))?.name ?? null)
    : null
)

function formatDate(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return new Date(iso).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })
}

async function onTaskDropped(taskId: number): Promise<void> {
  const task = store.tasks.find(t => t.id === taskId)
  if (!task) return

  if (!task.agent_assigne_id) {
    toast.push(t('board.noAgentAssigned'), 'warn')
    return
  }

  const agent = store.agents.find(a => a.id === task.agent_assigne_id)
  if (!agent) {
    toast.push(t('board.agentNotFound'), 'error')
    return
  }

  const result = await launchAgentTerminal(agent, task)
  if (result === 'session-limit') {
    toast.push(t('board.sessionLimitReached', { agent: agent.name, max: 3 }), 'warn')
  } else if (result === 'error') {
    toast.push(t('board.launchFailed', { agent: agent.name }), 'error')
  }
}

const UNASSIGNED_SENTINEL = '__unassigned__'

// Lazy computed: only compute when archive tab is active
const archivedByAgent = computed(() => {
  // Only compute if on archive tab to avoid unnecessary recalculations
  if (activeTab.value !== 'archive') return []
  const archived = tasks.value?.archived || []
  if (!archived || archived.length === 0) return []
  const groups = new Map<string, typeof archived>()
  for (const task of archived) {
    const key = task.agent_name ?? UNASSIGNED_SENTINEL
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(task)
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3 border-b border-edge-subtle shrink-0">
      <!-- Sub-tabs -->
      <div class="flex items-center gap-1">
        <button
          v-for="tab in (['backlog', 'archive'] as BoardTab[])"
          :key="tab"
          :class="[
            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
            activeTab === tab
              ? 'bg-surface-tertiary text-content-primary'
              : 'text-content-subtle hover:text-content-tertiary hover:bg-surface-secondary'
          ]"
          @click="activeTab = tab"
        >
          {{ tab === 'backlog' ? t('board.backlog') : t('board.archive', { count: tasks?.archived?.length || 0 }) }}
        </button>
      </div>

      <!-- Active filters -->
      <div class="flex items-center gap-2 flex-wrap">
        <span
          v-if="activeAgentName"
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-mono"
        >
          {{ activeAgentName }}
          <button class="hover:opacity-70 transition-colors" @click="store.selectedAgentId = null">✕</button>
        </span>
        <span
          v-if="store.selectedPerimetre"
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border font-mono"
          :style="{ color: agentFg(store.selectedPerimetre), backgroundColor: agentBg(store.selectedPerimetre), borderColor: agentBorder(store.selectedPerimetre) }"
        >
          {{ store.selectedPerimetre }}
          <button class="hover:opacity-70 transition-colors" @click="store.selectedPerimetre = null">✕</button>
        </span>
        <div v-if="store.error" class="text-xs text-red-400">{{ store.error }}</div>
      </div>
    </div>

    <!-- Board view: 3 colonnes -->
    <div v-if="activeTab === 'backlog'" class="flex-1 min-h-0 p-4">
      <div class="flex gap-3 h-full">
        <StatusColumn
          v-for="col in columns"
          :key="col.key"
          :title="col.title"
          :statut="col.key"
          :tasks="tasks?.[col.key] || []"
          :accent-class="col.accentClass"
          @task-dropped="onTaskDropped"
        />
      </div>
    </div>

    <!-- Archive view -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
      <div v-if="!tasks?.archived?.length" class="flex items-center justify-center h-full">
        <p class="text-sm text-content-faint italic">{{ t('board.noArchived') }}</p>
      </div>
      <div v-else class="flex flex-col gap-4">
        <!-- Group by agent -->
        <div v-for="[agentName, tasks] in archivedByAgent" :key="agentName">
          <!-- Group header -->
          <div class="flex items-center gap-2 mb-2">
            <span
              :class="[
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono border',
                agentName === UNASSIGNED_SENTINEL ? 'text-content-subtle bg-surface-secondary border-edge-default' : ''
              ]"
              :style="agentName !== UNASSIGNED_SENTINEL
                ? { color: agentFg(agentName), backgroundColor: agentBg(agentName), borderColor: agentBorder(agentName) }
                : {}"
            >{{ agentName === UNASSIGNED_SENTINEL ? t('board.unassigned') : agentName }}</span>
            <span class="text-[10px] text-content-faint font-mono">{{ tasks.length }} {{ t('board.tickets', tasks.length) }}</span>
          </div>
          <!-- Tasks in group -->
          <div class="space-y-1.5">
            <button
              v-for="task in tasks"
              :key="task.id"
              class="w-full text-left px-4 py-3 bg-surface-primary hover:bg-surface-secondary border border-edge-subtle hover:border-edge-default rounded-lg transition-colors group"
              @click="store.openTask(task)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-content-tertiary group-hover:text-content-primary truncate transition-colors">{{ task.titre }}</p>
                  <span v-if="task.perimetre" class="text-[10px] font-mono text-content-faint mt-1 block">{{ task.perimetre }}</span>
                </div>
                <div class="shrink-0 text-right">
                  <span class="text-[10px] text-content-faint font-mono">{{ formatDate(task.updated_at) }}</span>
                  <p class="text-[10px] text-content-dim font-mono mt-0.5">#{{ task.id }}</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
