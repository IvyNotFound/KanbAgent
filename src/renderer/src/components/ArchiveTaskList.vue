<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { perimeterFg, perimeterBg } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'
import AgentBadge from './AgentBadge.vue'
import type { useArchivedPagination } from '@renderer/composables/useArchivedPagination'

const { t, locale } = useI18n()

// Accept pagination as a prop (the composable result object)
const props = defineProps<{
  pagination: ReturnType<typeof useArchivedPagination>
}>()

const emit = defineEmits<{
  (e: 'open-task', task: unknown): void
}>()

type ArchiveSortMode = 'agent' | 'date'
const archiveSortMode = ref<ArchiveSortMode>('agent')

const UNASSIGNED_SENTINEL = '__unassigned__'

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_COLOR: Record<number, string> = { 1: 'chip-effort-s', 2: 'chip-effort-m', 3: 'chip-effort-l' }

function formatDate(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(iso).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })
}

const archivedGroupsSorted = computed(() => {
  const archived = props.pagination.archivedTasks.value
  if (!archived.length) return [] as [string, typeof archived][]
  const groups = new Map<string, typeof archived>()
  for (const task of archived) {
    const key = task.agent_name ?? UNASSIGNED_SENTINEL
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(task)
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
})

const archivedFlat = computed(() => props.pagination.archivedTasks.value)
</script>

<template>
  <div class="archive-area">
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
      <!-- Sort toggle -->
      <div class="archive-sort-bar px-4 pt-3">
        <v-btn-toggle
          v-model="archiveSortMode"
          mandatory
          density="compact"
          class="archive-sort-toggle"
          aria-label="Archive sort mode"
        >
          <v-btn value="agent" size="x-small" variant="outlined">
            <v-icon start size="14">mdi-account-group</v-icon>
            {{ t('board.sortByAgent') }}
          </v-btn>
          <v-btn value="date" size="x-small" variant="outlined">
            <v-icon start size="14">mdi-sort-calendar-descending</v-icon>
            {{ t('board.sortByDate') }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <!-- Scrollable tasks list -->
      <div class="archive-list py-3 px-4">
        <!-- Mode: grouped by agent -->
        <div v-if="archiveSortMode === 'agent'" class="archive-groups">
          <div v-for="[agentName, agentTasks] in archivedGroupsSorted" :key="agentName" class="agent-group">
            <div class="agent-group-header ga-2 mb-3">
              <AgentBadge v-if="agentName !== UNASSIGNED_SENTINEL" :name="agentName" />
              <span v-else class="agent-badge-unassigned">{{ t('board.unassigned') }}</span>
              <span class="agent-count">{{ agentTasks.length }} {{ t('board.tickets', agentTasks.length) }}</span>
            </div>
            <div class="task-list">
              <div
                v-for="task in agentTasks"
                :key="task.id"
                class="archive-card"
                @click="emit('open-task', task)"
              >
                <div class="arc-row1">
                  <p class="arc-title">{{ task.title }}</p>
                  <AgentBadge v-if="task.agent_name" :name="task.agent_name" />
                </div>
                <div class="arc-meta">
                  <v-chip
                    v-if="task.scope"
                    size="x-small"
                    variant="tonal"
                    rounded="sm"
                    :style="{ color: perimeterFg(task.scope), backgroundColor: perimeterBg(task.scope) }"
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

        <!-- Mode: flat list by date -->
        <div v-else class="task-list">
          <div
            v-for="task in archivedFlat"
            :key="task.id"
            class="archive-card"
            @click="emit('open-task', task)"
          >
            <div class="arc-row1">
              <p class="arc-title">{{ task.title }}</p>
              <AgentBadge v-if="task.agent_name" :name="task.agent_name" />
            </div>
            <div class="arc-meta">
              <v-chip
                v-if="task.scope"
                size="x-small"
                variant="tonal"
                rounded="sm"
                :style="{ color: perimeterFg(task.scope), backgroundColor: perimeterBg(task.scope) }"
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
</template>

<style scoped>
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
.archive-sort-bar {
  flex-shrink: 0;
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
