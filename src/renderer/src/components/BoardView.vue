<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import { useLaunchSession, MAX_AGENT_SESSIONS } from '@renderer/composables/useLaunchSession'
import { useToast } from '@renderer/composables/useToast'
import { useArchivedPagination } from '@renderer/composables/useArchivedPagination'
import StatusColumn from './StatusColumn.vue'

const { t, locale } = useI18n()
const store = useTasksStore()
const { launchAgentTerminal, canLaunchSession } = useLaunchSession()
const toast = useToast()
const pagination = useArchivedPagination()

type BoardTab = 'backlog' | 'archive'
const activeTab = ref<BoardTab>('backlog')

const emptyTasks = { todo: [], in_progress: [], done: [], archived: [] }
const tasks = computed(() => store.tasksByStatus ?? emptyTasks)

// Auto-switch to Archive tab when backlog is empty but archives exist
// Uses stats.archived (from GROUP BY query) since archived tasks are excluded from refresh()
const shouldAutoSwitchToArchive = computed(() => {
  const t = tasks.value
  const backlogCount = (t.todo?.length || 0) + (t.in_progress?.length || 0) + (t.done?.length || 0)
  return backlogCount === 0 && store.stats.archived > 0
})

// Watch for backlog becoming empty and auto-switch to archive
watch(shouldAutoSwitchToArchive, (shouldSwitch) => {
  if (shouldSwitch) {
    activeTab.value = 'archive'
  }
})

// Load page 0 when switching to archive tab
watch(activeTab, (tab) => {
  if (tab === 'archive') {
    pagination.loadPage(0)
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

async function onTaskDropped(taskId: number, targetStatut: string): Promise<void> {
  const task = store.tasks.find(t => t.id === taskId)
  if (!task) return
  if (task.statut === 'in_progress') return

  if (targetStatut === 'in_progress') {
    if (!task.agent_assigne_id) {
      toast.push(t('board.noAgentAssigned'), 'warn')
      return
    }

    const agent = store.agents.find(a => a.id === task.agent_assigne_id)
    if (!agent) {
      toast.push(t('board.agentNotFound'), 'error')
      return
    }

    // Check session limit BEFORE changing DB
    if (!canLaunchSession(agent.name)) {
      toast.push(t('board.sessionLimitReached', { agent: agent.name, max: MAX_AGENT_SESSIONS }), 'warn')
      return
    }

    // All checks passed → update DB then launch (TASK_BLOCKED rolls back optimistic update)
    try {
      await store.setTaskStatut(taskId, 'in_progress')
    } catch (err) {
      if (err instanceof Error && err.message === 'TASK_BLOCKED') {
        const blockers = (err as Error & { blockers: Array<{ id: number; titre: string; statut: string }> }).blockers
        const blockerList = blockers.map(b => `#${b.id} ${b.titre} (${b.statut})`).join(', ')
        toast.push(t('board.taskBlocked', { blockers: blockerList }), 'warn')
      }
      return
    }
    const result = await launchAgentTerminal(agent, task)
    if (result === 'error') {
      toast.push(t('board.launchFailed', { agent: agent.name }), 'error')
    }
  }
}

const UNASSIGNED_SENTINEL = '__unassigned__'

// Group and sort archived tasks by agent — depends only on task data, not on page index.
// Sorting happens here once when the data changes, not on every pagination UI interaction.
const archivedGroupsSorted = computed(() => {
  const archived = pagination.archivedTasks.value
  if (!archived.length) return [] as [string, typeof archived][]
  const groups = new Map<string, typeof archived>()
  for (const task of archived) {
    const key = task.agent_name ?? UNASSIGNED_SENTINEL
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(task)
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
})

// Expose grouped data for the template — pagination slicing is handled at DB level by loadPage()
const archivedByAgent = computed(() => archivedGroupsSorted.value)
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
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
          {{ tab === 'backlog' ? t('board.backlog') : t('board.archive', { count: store.stats.archived }) }}
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
          @task-dropped="(taskId) => onTaskDropped(taskId, col.key)"
        />
      </div>
    </div>

    <!-- Archive view -->
    <div v-else class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <!-- Loading state -->
      <div v-if="pagination.loading.value && !pagination.archivedTasks.value.length" class="flex items-center justify-center flex-1">
        <p class="text-sm text-content-faint italic">{{ t('common.loading') }}</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!pagination.loading.value && pagination.total.value === 0" class="flex items-center justify-center flex-1">
        <p class="text-sm text-content-faint italic">{{ t('board.noArchived') }}</p>
      </div>

      <!-- Tasks list + pagination -->
      <template v-else>
        <!-- Scrollable tasks list -->
        <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <div class="flex flex-col gap-4">
            <!-- Group by agent -->
            <div v-for="[agentName, agentTasks] in archivedByAgent" :key="agentName">
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
                <span class="text-[10px] text-content-faint font-mono">{{ agentTasks.length }} {{ t('board.tickets', agentTasks.length) }}</span>
              </div>
              <!-- Tasks in group -->
              <div class="space-y-1.5">
                <button
                  v-for="task in agentTasks"
                  :key="task.id"
                  class="w-full text-left px-4 py-3 bg-surface-primary hover:bg-surface-secondary border border-edge-subtle hover:border-edge-default rounded-lg transition-colors group"
                  @click="store.openTask(task)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-content-tertiary group-hover:text-content-primary truncate transition-colors">{{ task.titre }}</p>
                      <span v-if="task.perimetre" class="text-[10px] font-mono text-content-subtle mt-1 block">{{ task.perimetre }}</span>
                    </div>
                    <div class="shrink-0 text-right space-y-0.5">
                      <p class="text-[10px] text-content-muted font-mono tabular-nums">{{ formatDate(task.updated_at) }}</p>
                      <p class="text-[10px] text-content-subtle font-mono">#{{ task.id }}</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination controls -->
        <div class="shrink-0 flex items-center justify-between px-4 py-2 border-t border-edge-subtle bg-surface-primary">
          <button
            :disabled="pagination.page.value === 0"
            :class="[
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              pagination.page.value === 0
                ? 'text-content-subtle opacity-40 cursor-not-allowed'
                : 'text-content-tertiary hover:text-content-primary hover:bg-surface-secondary'
            ]"
            @click="pagination.loadPage(pagination.page.value - 1)"
          >
            {{ t('board.prevPage') }}
          </button>

          <span class="text-[11px] text-content-faint font-mono tabular-nums">
            {{ t('board.pageOf', {
              page: pagination.page.value + 1,
              total: pagination.totalPages.value,
              count: pagination.total.value
            }) }}
          </span>

          <button
            :disabled="pagination.page.value >= pagination.totalPages.value - 1"
            :class="[
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              pagination.page.value >= pagination.totalPages.value - 1
                ? 'text-content-subtle opacity-40 cursor-not-allowed'
                : 'text-content-tertiary hover:text-content-primary hover:bg-surface-secondary'
            ]"
            @click="pagination.loadPage(pagination.page.value + 1)"
          >
            {{ t('board.nextPage') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
