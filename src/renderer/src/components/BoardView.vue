<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentAccent } from '@renderer/utils/agentColor'
import { useLaunchSession, MAX_AGENT_SESSIONS } from '@renderer/composables/useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { useToast } from '@renderer/composables/useToast'
import { useArchivedPagination } from '@renderer/composables/useArchivedPagination'
import AgentBadge from './AgentBadge.vue'
import StatusColumn from './StatusColumn.vue'
import ArchiveTaskList from './ArchiveTaskList.vue'

const { t } = useI18n()
const store = useTasksStore()
const { launchAgentTerminal, launchReviewSession, canLaunchSession } = useLaunchSession()
const tabsStore = useTabsStore()
const toast = useToast()
const pagination = useArchivedPagination()

type BoardTab = 'backlog' | 'archive'
const activeTab = ref<BoardTab>('backlog')

const emptyTasks = { todo: [], in_progress: [], done: [], archived: [], rejected: [] }
const tasks = computed(() => store.tasksByStatus ?? emptyTasks)

const reviewAgent = computed(() => store.agents.find(a => a.type === 'review') ?? null)

const canReview = computed(() => {
  if (!reviewAgent.value) return false
  if ((tasks.value.done?.length ?? 0) === 0) return false
  if (tabsStore.hasAgentTerminal(reviewAgent.value.name)) return false
  return canLaunchSession(reviewAgent.value)
})

async function onReviewClick(): Promise<void> {
  if (!reviewAgent.value) return
  const doneTasks = tasks.value.done ?? []
  if (!doneTasks.length) return
  const ok = await launchReviewSession(reviewAgent.value, doneTasks)
  if (!ok) toast.push(t('board.reviewLaunchFailed'), 'error')
}

const shouldAutoSwitchToArchive = computed(() => {
  const t = tasks.value
  const backlogCount = (t.todo?.length || 0) + (t.in_progress?.length || 0) + (t.done?.length || 0)
  return backlogCount === 0 && store.stats.archived > 0
})

watch(shouldAutoSwitchToArchive, (shouldSwitch) => {
  if (shouldSwitch) activeTab.value = 'archive'
})

watch(activeTab, (tab) => {
  if (tab === 'archive') pagination.loadPage(0)
})

const columns = computed(() => [
  { key: 'todo'        as const, title: t('columns.todo'),        accentColor: 'rgb(var(--v-theme-chip-todo))' },
  { key: 'in_progress' as const, title: t('columns.in_progress'), accentColor: 'rgb(var(--v-theme-chip-in-progress))' },
  { key: 'done'        as const, title: t('columns.done'),        accentColor: 'rgb(var(--v-theme-chip-done))' },
])

const activeAgentName = computed(() =>
  store.selectedAgentId !== null
    ? (store.agents.find(a => Number(a.id) === Number(store.selectedAgentId))?.name ?? null)
    : null
)

async function onTaskDropped(taskId: number, targetStatut: string): Promise<void> {
  const task = store.tasks.find(t => t.id === taskId)
  if (!task) return
  if (task.status === 'in_progress') return

  if (targetStatut === 'in_progress') {
    if (!task.agent_assigned_id) {
      toast.push(t('board.noAgentAssigned'), 'warn')
      return
    }

    const agent = store.agents.find(a => a.id === task.agent_assigned_id)
    if (!agent) {
      toast.push(t('board.agentNotFound'), 'error')
      return
    }

    if (!canLaunchSession(agent)) {
      const max = agent.max_sessions ?? MAX_AGENT_SESSIONS
      toast.push(t('board.sessionLimitReached', { agent: agent.name, max }), 'warn')
      return
    }

    try {
      await store.setTaskStatut(taskId, 'in_progress')
    } catch (err) {
      if (err instanceof Error && err.message === 'TASK_BLOCKED') {
        const blockers = (err as Error & { blockers: Array<{ id: number; title: string; status: string }> }).blockers
        const blockerList = blockers.map(b => `#${b.id} ${b.title} (${b.status})`).join(', ')
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
</script>

<template>
  <div class="board-root">
    <!-- Header -->
    <div class="board-header py-3 px-5">
      <div class="header-spacer" />

      <div class="header-center">
        <v-btn-toggle
          v-model="activeTab"
          mandatory
          density="compact"
          class="board-tabs"
        >
          <v-btn value="backlog" size="small" variant="outlined">
            {{ t('board.backlog') }}
          </v-btn>
          <v-btn value="archive" size="small" variant="outlined">
            {{ t('board.archive', { count: store.stats.archived }) }}
          </v-btn>
        </v-btn-toggle>

        <v-btn
          v-if="reviewAgent"
          size="small"
          variant="tonal"
          :color="agentAccent('review')"
          :disabled="!canReview"
          @click="onReviewClick"
        >
          <v-icon start size="16">mdi-check-decagram</v-icon>
          {{ t('board.review') }}
        </v-btn>
      </div>

      <div class="header-right ga-2">
        <v-chip
          v-if="activeAgentName"
          size="small"
          variant="tonal"
          color="primary"
          closable
          @click:close="store.selectedAgentId = null"
        >
          {{ activeAgentName }}
        </v-chip>
        <v-chip
          v-if="store.selectedPerimetre"
          size="small"
          variant="tonal"
          closable
          :style="{ color: agentFg(store.selectedPerimetre), backgroundColor: agentBg(store.selectedPerimetre) }"
          @click:close="store.selectedPerimetre = null"
        >
          {{ store.selectedPerimetre }}
        </v-chip>
        <div v-if="store.error" class="board-error">{{ store.error }}</div>
      </div>
    </div>

    <!-- Board view: 3 colonnes -->
    <div v-if="activeTab === 'backlog'" class="board-area">
      <div class="columns-area pa-4 ga-3">
        <StatusColumn
          v-for="col in columns"
          :key="col.key"
          :title="col.title"
          :statut="col.key"
          :tasks="tasks?.[col.key] || []"
          :accent-color="col.accentColor"
          @task-dropped="(taskId) => onTaskDropped(taskId, col.key)"
        />
      </div>
    </div>

    <!-- Archive view -->
    <ArchiveTaskList
      v-else
      :pagination="pagination"
      @open-task="(task) => store.openTask(task as Parameters<typeof store.openTask>[0])"
    />
  </div>
</template>

<style scoped>
.board-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.board-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.header-center {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.header-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.board-error {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-error));
}
.board-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.columns-area {
  display: flex;
  flex: 1;
  min-height: 0;
}
</style>
