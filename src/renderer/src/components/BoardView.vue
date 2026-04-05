<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { isStale } from '@renderer/utils/staleTask'
import { parseUtcDate } from '@renderer/utils/parseDate'
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

/** Stale tasks: in_progress tasks exceeding the configured threshold (T749). */
const staleTasks = computed(() =>
  (tasks.value.in_progress ?? []).filter(t => isStale(t.started_at, store.staleThresholdMinutes))
)

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
  { key: 'todo'        as const, title: t('columns.todo'),        accentColor: 'rgb(var(--v-theme-warning))' },
  { key: 'in_progress' as const, title: t('columns.in_progress'), accentColor: 'rgb(var(--v-theme-secondary))' },
  { key: 'done'        as const, title: t('columns.done'),        accentColor: 'var(--content-faint)' },
])

const activeAgentName = computed(() =>
  store.selectedAgentId !== null
    ? (store.agents.find(a => Number(a.id) === Number(store.selectedAgentId))?.name ?? null)
    : null
)

function formatDate(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(iso).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })
}

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }

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

    // Check session limit BEFORE changing DB
    if (!canLaunchSession(agent)) {
      const max = agent.max_sessions ?? MAX_AGENT_SESSIONS
      toast.push(t('board.sessionLimitReached', { agent: agent.name, max }), 'warn')
      return
    }

    // All checks passed → update DB then launch (TASK_BLOCKED rolls back optimistic update)
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

</script>

<template>
  <div class="board-root">
    <!-- Header -->
    <div class="board-header py-3 px-5">
      <!-- Sub-tabs -->
      <div class="board-tabs ga-1">
        <v-btn
          v-for="tab in (['backlog', 'archive'] as BoardTab[])"
          :key="tab"
          variant="text"
          size="small"
          class="text-caption" :class="['tab-btn', { active: activeTab === tab }]"
          @click="activeTab = tab"
        >
          {{ tab === 'backlog' ? t('board.backlog') : t('board.archive', { count: store.stats.archived }) }}
        </v-btn>
      </div>

      <!-- Active filters -->
      <div class="board-filters ga-2">
        <span v-if="activeAgentName" class="filter-badge-agent">
          {{ activeAgentName }}
          <v-btn icon="mdi-close" variant="text" size="x-small" density="compact" class="filter-badge-close" @click="store.selectedAgentId = null" />
        </span>
        <span
          v-if="store.selectedPerimetre"
          class="filter-badge-perimeter"
          :style="{ color: agentFg(store.selectedPerimetre), backgroundColor: agentBg(store.selectedPerimetre), borderColor: agentBorder(store.selectedPerimetre) }"
        >
          {{ store.selectedPerimetre }}
          <v-btn icon="mdi-close" variant="text" size="x-small" density="compact" class="filter-badge-close" @click="store.selectedPerimetre = null" />
        </span>
        <div v-if="store.error" class="board-error">{{ store.error }}</div>
      </div>
    </div>

    <!-- Board view: 3 colonnes -->
    <div v-if="activeTab === 'backlog'" class="board-area">
      <!-- Stale tasks alert (T749) -->
      <div v-if="staleTasks.length > 0" class="stale-alert ma-4 mb-0 py-2 px-3 ga-2">
        <span class="stale-icon">⚠</span>
        <div class="stale-content">
          <span class="stale-title">{{ t('board.staleTasks', { count: staleTasks.length }) }}</span>
          <span
            v-for="task in staleTasks"
            :key="task.id"
            class="stale-task ml-2"
            @click="store.openTask(task)"
          >#{{ task.id }} {{ task.title }}</span>
        </div>
      </div>

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
    <div v-else class="archive-area">
      <!-- Loading state -->
      <div v-if="pagination.loading.value && !pagination.archivedTasks.value.length" class="state-centered">
        <p class="state-text">{{ t('common.loading') }}</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!pagination.loading.value && pagination.total.value === 0" class="state-centered">
        <p class="state-text">{{ t('board.noArchived') }}</p>
      </div>

      <!-- Tasks list + pagination -->
      <template v-else>
        <!-- Scrollable tasks list -->
        <div class="archive-list py-3 px-4">
          <div class="archive-groups">
            <!-- Group by agent -->
            <div v-for="[agentName, agentTasks] in archivedGroupsSorted" :key="agentName" class="agent-group">
              <!-- Group header -->
              <div class="agent-group-header ga-2 mb-3">
                <span
                  :class="['agent-badge', { 'agent-badge-unassigned': agentName === UNASSIGNED_SENTINEL }]"
                  :style="agentName !== UNASSIGNED_SENTINEL
                    ? { color: agentFg(agentName), backgroundColor: agentBg(agentName), borderColor: agentBorder(agentName) }
                    : {}"
                >{{ agentName === UNASSIGNED_SENTINEL ? t('board.unassigned') : agentName }}</span>
                <span class="agent-count">{{ agentTasks.length }} {{ t('board.tickets', agentTasks.length) }}</span>
              </div>
              <!-- Tasks in group -->
              <div class="task-list">
                <div
                  v-for="task in agentTasks"
                  :key="task.id"
                  class="archive-card"
                  @click="store.openTask(task)"
                >
                  <!-- Row 1: title + agent badge -->
                  <div class="arc-row1">
                    <p class="arc-title">{{ task.title }}</p>
                    <span
                      v-if="task.agent_name"
                      class="arc-agent"
                      :style="{ color: agentFg(task.agent_name), backgroundColor: agentBg(task.agent_name), borderColor: agentBorder(task.agent_name) }"
                    >{{ task.agent_name }}</span>
                  </div>
                  <!-- Row 2: meta chips (scope, id, effort, date) -->
                  <div class="arc-meta">
                    <span
                      v-if="task.scope"
                      class="arc-scope"
                      :style="{
                        color: perimeterFg(task.scope),
                        backgroundColor: perimeterBg(task.scope),
                        borderColor: perimeterBorder(task.scope)
                      }"
                    >{{ task.scope }}</span>
                    <span class="arc-id">#{{ task.id }}</span>
                    <span v-if="task.effort" class="arc-effort" :class="`arc-effort-${task.effort}`">{{ EFFORT_LABEL[task.effort] }}</span>
                    <span class="arc-date">{{ formatDate(task.updated_at) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination controls -->
        <div class="pagination py-2 px-4">
          <v-btn
            :disabled="pagination.page.value === 0"
            variant="text"
            size="small"
            class="text-caption pag-btn"
            @click="pagination.loadPage(pagination.page.value - 1)"
          >
            {{ t('board.prevPage') }}
          </v-btn>

          <span class="pag-info">
            {{ t('board.pageOf', {
              page: pagination.page.value + 1,
              total: pagination.totalPages.value,
              count: pagination.total.value
            }) }}
          </span>

          <v-btn
            :disabled="pagination.page.value >= pagination.totalPages.value - 1"
            variant="text"
            size="small"
            class="text-caption pag-btn"
            @click="pagination.loadPage(pagination.page.value + 1)"
          >
            {{ t('board.nextPage') }}
          </v-btn>
        </div>
      </template>
    </div>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.board-tabs {
  display: flex;
  align-items: center;
}
.tab-btn {
  font-weight: 500 !important;
  color: var(--content-subtle) !important;
}
.tab-btn.active {
  background-color: var(--surface-tertiary) !important;
  color: var(--content-primary) !important;
}
.board-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.filter-badge-agent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.75rem;
  background-color: rgba(var(--v-theme-primary), 0.2);
  color: rgb(var(--v-theme-primary));
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.filter-badge-perimeter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.75rem;
  border: 1px solid transparent;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.filter-badge-close {
  opacity: 0.7;
  color: inherit !important;
}
.filter-badge-close:hover {
  opacity: 1;
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
.stale-alert {
  flex-shrink: 0;
  background-color: rgba(var(--v-theme-warning), 0.1);
  border: 1px solid rgba(var(--v-theme-warning), 0.3);
  border-radius: 8px;
  display: flex;
  align-items: flex-start;
}
.stale-icon {
  color: rgb(var(--v-theme-warning));
  flex-shrink: 0;
  font-size: 0.875rem;
}
.stale-content {
  flex: 1;
  min-width: 0;
}
.stale-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-warning));
}
.stale-task {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-warning), 0.8);
  cursor: pointer;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}
.stale-task:hover {
  color: rgb(var(--v-theme-warning));
}
.columns-area {
  display: flex;
  flex: 1;
  min-height: 0;
}
.archive-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.state-centered {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.state-text {
  font-size: 0.875rem;
  color: var(--content-faint);
  font-style: italic;
}
.archive-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.archive-groups {
  display: flex;
  flex-direction: column;
}
.agent-group:not(:first-child) {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--edge-subtle);
}
.agent-group-header {
  display: flex;
  align-items: center;
}
.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  border: 1px solid transparent;
}
.agent-badge-unassigned {
  color: var(--content-subtle);
  background-color: var(--surface-secondary);
  border-color: var(--edge-default);
}
.agent-count {
  font-size: 10px;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Archive card */
.archive-card {
  padding: 12px 16px;
  background-color: var(--surface-primary);
  border: 1px solid var(--edge-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color var(--md-duration-short3) var(--md-easing-standard), border-color var(--md-duration-short3) var(--md-easing-standard);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.archive-card:hover {
  background-color: var(--surface-secondary);
  border-color: var(--edge-default);
}
.arc-row1 {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  justify-content: space-between;
}
.arc-title {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  color: var(--content-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}
.archive-card:hover .arc-title {
  color: var(--content-primary);
}
.arc-agent {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 9999px;
  font-size: 0.6875rem;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  border: 1px solid transparent;
  white-space: nowrap;
}
.arc-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.arc-scope {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  border: 1px solid transparent;
}
.arc-id {
  font-size: 11px;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.arc-effort {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.arc-effort-1 {
  color: rgb(var(--v-theme-secondary));
  background-color: rgba(var(--v-theme-secondary), 0.15);
}
.arc-effort-2 {
  color: rgb(var(--v-theme-warning));
  background-color: rgba(var(--v-theme-warning), 0.15);
}
.arc-effort-3 {
  color: rgb(var(--v-theme-error));
  background-color: rgba(var(--v-theme-error), 0.15);
}
.arc-date {
  font-size: 11px;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.pagination {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--edge-subtle);
  background-color: var(--surface-primary);
}
.pag-btn {
  font-weight: 500 !important;
  color: var(--content-tertiary) !important;
}
.pag-info {
  font-size: 11px;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
</style>
