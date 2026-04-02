<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
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
const treeMode = ref(false)

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
  { key: 'todo'        as const, title: t('columns.todo'),        accentColor: '#f59e0b' },
  { key: 'in_progress' as const, title: t('columns.in_progress'), accentColor: '#10b981' },
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
    <div class="board-header">
      <!-- Sub-tabs -->
      <div class="board-tabs">
        <button
          v-for="tab in (['backlog', 'archive'] as BoardTab[])"
          :key="tab"
          :class="['tab-btn', { active: activeTab === tab }]"
          @click="activeTab = tab"
        >
          {{ tab === 'backlog' ? t('board.backlog') : t('board.archive', { count: store.stats.archived }) }}
        </button>
      </div>

      <!-- List / Tree toggle (backlog only) -->
      <div v-if="activeTab === 'backlog'" class="view-toggle">
        <button
          :class="['toggle-btn', { active: !treeMode }]"
          :title="t('board.listView')"
          @click="treeMode = false"
        >
          <svg class="toggle-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </button>
        <button
          :class="['toggle-btn', 'toggle-btn-separator', { active: treeMode }]"
          :title="t('board.treeView')"
          @click="treeMode = true"
        >
          <svg class="toggle-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 7h4m0 0v10m0-10h14M7 12h6m0 0v5m0-5h4" />
          </svg>
        </button>
      </div>

      <!-- Active filters -->
      <div class="board-filters">
        <span v-if="activeAgentName" class="filter-badge-agent">
          {{ activeAgentName }}
          <button class="filter-badge-close" @click="store.selectedAgentId = null">✕</button>
        </span>
        <span
          v-if="store.selectedPerimetre"
          class="filter-badge-perimeter"
          :style="{ color: agentFg(store.selectedPerimetre), backgroundColor: agentBg(store.selectedPerimetre), borderColor: agentBorder(store.selectedPerimetre) }"
        >
          {{ store.selectedPerimetre }}
          <button class="filter-badge-close" @click="store.selectedPerimetre = null">✕</button>
        </span>
        <div v-if="store.error" class="board-error">{{ store.error }}</div>
      </div>
    </div>

    <!-- Board view: 3 colonnes -->
    <div v-if="activeTab === 'backlog'" class="board-area">
      <!-- Stale tasks alert (T749) -->
      <div v-if="staleTasks.length > 0" class="stale-alert">
        <span class="stale-icon">⚠</span>
        <div class="stale-content">
          <span class="stale-title">{{ t('board.staleTasks', { count: staleTasks.length }) }}</span>
          <span
            v-for="task in staleTasks"
            :key="task.id"
            class="stale-task"
            @click="store.openTask(task)"
          >#{{ task.id }} {{ task.title }}</span>
        </div>
      </div>

      <div class="columns-area">
        <StatusColumn
          v-for="col in columns"
          :key="col.key"
          :title="col.title"
          :statut="col.key"
          :tasks="tasks?.[col.key] || []"
          :accent-color="col.accentColor"
          :tree-mode="treeMode"
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
        <div class="archive-list">
          <div class="archive-groups">
            <!-- Group by agent -->
            <div v-for="[agentName, agentTasks] in archivedGroupsSorted" :key="agentName" class="agent-group">
              <!-- Group header -->
              <div class="agent-group-header">
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
                <button
                  v-for="task in agentTasks"
                  :key="task.id"
                  class="archive-task-btn"
                  @click="store.openTask(task)"
                >
                  <div class="archive-task-inner">
                    <div class="archive-task-content">
                      <p class="archive-task-title">{{ task.title }}</p>
                      <span v-if="task.scope" class="archive-task-scope">{{ task.scope }}</span>
                    </div>
                    <div class="archive-task-meta">
                      <p class="archive-task-date">{{ formatDate(task.updated_at) }}</p>
                      <p class="archive-task-id">#{{ task.id }}</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination controls -->
        <div class="pagination">
          <button
            :disabled="pagination.page.value === 0"
            :class="['pag-btn', { disabled: pagination.page.value === 0 }]"
            @click="pagination.loadPage(pagination.page.value - 1)"
          >
            {{ t('board.prevPage') }}
          </button>

          <span class="pag-info">
            {{ t('board.pageOf', {
              page: pagination.page.value + 1,
              total: pagination.totalPages.value,
              count: pagination.total.value
            }) }}
          </span>

          <button
            :disabled="pagination.page.value >= pagination.totalPages.value - 1"
            :class="['pag-btn', { disabled: pagination.page.value >= pagination.totalPages.value - 1 }]"
            @click="pagination.loadPage(pagination.page.value + 1)"
          >
            {{ t('board.nextPage') }}
          </button>
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
  padding: 12px 20px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.board-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tab-btn {
  padding: 4px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: 6px;
  transition: background-color 150ms, color 150ms;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
}
.tab-btn:hover {
  color: var(--content-tertiary);
  background-color: var(--surface-secondary);
}
.tab-btn.active {
  background-color: var(--surface-tertiary);
  color: var(--content-primary);
}
.view-toggle {
  display: flex;
  align-items: center;
  border-radius: 6px;
  border: 1px solid var(--edge-subtle);
  overflow: hidden;
  flex-shrink: 0;
}
.toggle-btn {
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 500;
  transition: background-color 150ms, color 150ms;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.toggle-btn:hover {
  color: var(--content-tertiary);
  background-color: var(--surface-secondary);
}
.toggle-btn.active {
  background-color: var(--surface-tertiary);
  color: var(--content-primary);
}
.toggle-btn-separator {
  border-left: 1px solid var(--edge-subtle);
}
.toggle-icon {
  width: 14px;
  height: 14px;
}
.board-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.filter-badge-agent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.75rem;
  background-color: rgba(139, 92, 246, 0.2);
  color: #c4b5fd; /* violet-300 */
  border: 1px solid rgba(139, 92, 246, 0.3);
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
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 150ms;
  color: inherit;
  padding: 0;
}
.filter-badge-close:hover {
  opacity: 1;
}
.board-error {
  font-size: 0.75rem;
  color: #f87171; /* red-400 */
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
  margin: 16px 16px 0;
  padding: 8px 12px;
  background-color: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 8px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.stale-icon {
  color: #fb923c; /* orange-400 */
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
  color: #fdba74; /* orange-300 */
}
.stale-task {
  margin-left: 8px;
  font-size: 0.75rem;
  color: rgba(254, 215, 170, 0.8); /* orange-200/80 */
  cursor: pointer;
  transition: color 150ms;
}
.stale-task:hover {
  color: #fed7aa; /* orange-200 */
}
.columns-area {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 16px;
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
  padding: 12px 16px;
}
.archive-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.agent-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
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
  gap: 6px;
}
.archive-task-btn {
  width: 100%;
  text-align: left;
  padding: 12px 16px;
  background-color: var(--surface-primary);
  border: 1px solid var(--edge-subtle);
  border-radius: 8px;
  transition: background-color 150ms, border-color 150ms;
  cursor: pointer;
}
.archive-task-btn:hover {
  background-color: var(--surface-secondary);
  border-color: var(--edge-default);
}
.archive-task-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.archive-task-content {
  flex: 1;
  min-width: 0;
}
.archive-task-title {
  font-size: 0.875rem;
  color: var(--content-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 150ms;
}
.archive-task-btn:hover .archive-task-title {
  color: var(--content-primary);
}
.archive-task-scope {
  font-size: 10px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  color: var(--content-subtle);
  margin-top: 4px;
  display: block;
}
.archive-task-meta {
  flex-shrink: 0;
  text-align: right;
}
.archive-task-date {
  font-size: 10px;
  color: var(--content-muted);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.archive-task-id {
  font-size: 10px;
  color: var(--content-subtle);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.pagination {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--edge-subtle);
  background-color: var(--surface-primary);
}
.pag-btn {
  padding: 4px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: 6px;
  transition: background-color 150ms, color 150ms;
  color: var(--content-tertiary);
  background: none;
  border: none;
  cursor: pointer;
}
.pag-btn:hover:not(:disabled) {
  color: var(--content-primary);
  background-color: var(--surface-secondary);
}
.pag-btn:disabled,
.pag-btn.disabled {
  color: var(--content-subtle);
  opacity: 0.4;
  cursor: not-allowed;
}
.pag-info {
  font-size: 11px;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
</style>
