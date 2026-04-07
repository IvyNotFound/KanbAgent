<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, perimeterFg, perimeterBg } from '@renderer/utils/agentColor'
import { isStale } from '@renderer/utils/staleTask'
import { parseUtcDate } from '@renderer/utils/parseDate'
import { useLaunchSession, MAX_AGENT_SESSIONS } from '@renderer/composables/useLaunchSession'
import { useToast } from '@renderer/composables/useToast'
import { useArchivedPagination } from '@renderer/composables/useArchivedPagination'
import AgentBadge from './AgentBadge.vue'
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
const EFFORT_COLOR: Record<number, string> = { 1: 'chip-effort-s', 2: 'chip-effort-m', 3: 'chip-effort-l' }

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
      <!-- Left spacer (grid balance) -->
      <div class="header-spacer" />

      <!-- Center: MD3 Segmented Button -->
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
      </div>

      <!-- Right: active filters -->
      <div class="header-right ga-2">
        <v-chip
          v-if="activeAgentName"
          size="small"
          variant="tonal"
          color="primary"
          closable
          @click:close="store.selectedAgentId = null"
        >{{ activeAgentName }}</v-chip>
        <v-chip
          v-if="store.selectedPerimetre"
          size="small"
          variant="tonal"
          closable
          :style="{ color: agentFg(store.selectedPerimetre), backgroundColor: agentBg(store.selectedPerimetre) }"
          @click:close="store.selectedPerimetre = null"
        >{{ store.selectedPerimetre }}</v-chip>
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
                <AgentBadge v-if="agentName !== UNASSIGNED_SENTINEL" :name="agentName" />
                <span v-else class="agent-badge-unassigned">{{ t('board.unassigned') }}</span>
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
                    <AgentBadge v-if="task.agent_name" :name="task.agent_name" />
                  </div>
                  <!-- Row 2: meta chips (scope, priority, id, effort, date) -->
                  <div class="arc-meta">
                    <v-chip
                      v-if="task.scope"
                      size="x-small"
                      variant="tonal"
                      rounded="sm"
                      :style="{
                        color: perimeterFg(task.scope),
                        backgroundColor: perimeterBg(task.scope),
                      }"
                    >{{ task.scope }}</v-chip>
                    <v-chip v-if="task.priority === 'critical'" size="x-small" variant="tonal" color="chip-priority-critical">!!</v-chip>
                    <v-chip v-if="task.priority === 'high'" size="x-small" variant="tonal" color="chip-priority-high">!</v-chip>
                    <v-chip size="x-small" variant="tonal" class="arc-id-chip">#{{ task.id }}</v-chip>
                    <v-chip v-if="task.effort" size="x-small" variant="tonal" :color="EFFORT_COLOR[task.effort]">{{ EFFORT_LABEL[task.effort] }}</v-chip>
                    <v-chip size="x-small" variant="tonal" class="arc-date-chip">{{ formatDate(task.updated_at) }}</v-chip>
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
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.header-center {
  display: flex;
  justify-content: center;
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
.stale-alert {
  flex-shrink: 0;
  background-color: rgba(var(--v-theme-warning), 0.1);
  border: 1px solid rgba(var(--v-theme-warning), 0.3);
  border-radius: var(--shape-sm);
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
.agent-badge-unassigned {
  font-size: 0.75rem;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  color: var(--content-subtle);
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
/* Archive card — MD3 state layer via ::after pseudo-element */
.archive-card {
  padding: 12px 16px;
  background-color: var(--surface-primary);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--shape-sm);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.archive-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-color: rgba(var(--v-theme-on-surface), 0);
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
  pointer-events: none;
}
.archive-card:hover {
  border-color: var(--edge-default);
}
.archive-card:hover::after {
  background-color: rgba(var(--v-theme-on-surface), var(--md-state-hover));
}
.arc-row1 {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  justify-content: space-between;
  position: relative;
  z-index: 1;
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
.arc-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}
.arc-id-chip, .arc-date-chip {
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
