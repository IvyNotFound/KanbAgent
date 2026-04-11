<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import TaskDependencyGraph from './TaskDependencyGraph.vue'
import GitCommitList from './GitCommitList.vue'
import TaskCommentsSection from './TaskCommentsSection.vue'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
import type { TaskAssignee, TaskLink } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()

interface GitCommit { hash: string; date: string; subject: string; author: string; taskIds: number[] }
interface RenderedComment { _html: string; [key: string]: unknown }

const props = defineProps<{
  task: NonNullable<ReturnType<typeof store.selectedTask>>
  valideurAgentName: string | null
  sortedAssignees: TaskAssignee[]
  blockedByLinks: TaskLink[]
  unresolvedBlockers: TaskLink[]
  isBlocked: boolean
  gitCommits: GitCommit[]
  gitCommitsOpen: boolean
  renderedComments: RenderedComment[]
}>()

const emit = defineEmits<{
  (e: 'update:git-commits-open', value: boolean): void
  (e: 'navigate-task', id: number): void
}>()
</script>

<template>
  <div class="task-right-col">
    <!-- T553: Blocked indicator -->
    <div v-if="isBlocked" class="blocked-banner py-2 px-4">
      <p class="section-label mb-1 text-label-medium" style="color: rgb(var(--v-theme-warning));">{{ t('taskDetail.blockedTitle') }}</p>
      <ul class="blocked-list">
        <li
          v-for="link in unresolvedBlockers"
          :key="link.id"
          class="blocked-item text-label-medium"
        >
          #{{ link.from_task === task.id ? link.to_task : link.from_task }}
          {{ link.from_task === task.id ? link.to_titre : link.from_titre }}
        </li>
      </ul>
    </div>

    <!-- Section Agents -->
    <div class="right-section">
      <p class="section-label mb-2 text-label-medium">{{ t('taskDetail.agents') }}</p>
      <div class="d-flex flex-column ga-2">
        <div v-if="task.agent_creator_name" class="d-flex align-center ga-2">
          <span class="meta-label text-label-medium">{{ t('taskDetail.creator') }}</span>
          <AgentBadge :name="task.agent_creator_name" />
        </div>
        <div v-if="task.agent_name" class="d-flex align-center ga-2">
          <span class="meta-label text-label-medium">{{ t('taskDetail.assigned') }}</span>
          <AgentBadge :name="task.agent_name" />
        </div>
        <div v-if="valideurAgentName" class="d-flex align-center ga-2">
          <span class="meta-label text-label-medium">{{ t('taskDetail.validator') }}</span>
          <AgentBadge :name="valideurAgentName" />
        </div>
      </div>
    </div>

    <!-- Section Dependencies -->
    <div class="right-section">
      <p class="section-label mb-2 text-label-medium">{{ t('taskDetail.dependencies') }}</p>
      <TaskDependencyGraph
        :task-id="task.id"
        :links="store.taskLinks"
        @navigate="emit('navigate-task', $event)"
      />
    </div>

    <!-- Section Commits (T761) -->
    <div v-if="gitCommits.length > 0" class="right-section right-section--collapsible">
      <v-btn
        variant="text"
        block
        class="commits-toggle py-3 px-4"
        @click="emit('update:git-commits-open', !gitCommitsOpen)"
      >
        <p class="section-label text-label-medium">
          {{ t('taskDetail.commits') }}
          <span class="meta-count">({{ gitCommits.length }})</span>
        </p>
        <v-icon
          class="toggle-arrow"
          :class="gitCommitsOpen ? 'toggle-arrow--open' : ''"
          size="14"
        >
          mdi-chevron-right
        </v-icon>
      </v-btn>
      <div v-if="gitCommitsOpen" class="commits-content">
        <GitCommitList
          :commits="gitCommits"
          @open-task="emit('navigate-task', $event)"
        />
      </div>
    </div>

    <!-- Section Assignees (read-only — T571) -->
    <div class="right-section">
      <p class="section-label mb-2 text-label-medium">
        {{ t('taskDetail.assignees') }}
      </p>
      <div v-if="sortedAssignees.length > 0" class="d-flex flex-column ga-2">
        <div v-for="a in sortedAssignees" :key="a.agent_id" class="d-flex align-center ga-2">
          <v-avatar
            size="20"
            :style="{ color: agentFg(a.agent_name), backgroundColor: agentBg(a.agent_name) }"
            :title="a.agent_name"
            class="text-overline font-weight-bold"
          >
            {{ a.agent_name.slice(0, 2).toUpperCase() }}
          </v-avatar>
          <span class="text-caption" style="color: var(--content-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ a.agent_name }}</span>
          <span class="text-caption" style="color: var(--content-faint); flex-shrink: 0;">{{ a.role ?? '—' }}</span>
        </div>
      </div>
      <p v-else class="empty-text pt-2 text-caption">
        {{ t('taskDetail.noAssignees') }}
      </p>
    </div>

    <!-- Comments header -->
    <div class="right-section right-section--no-bottom">
      <p class="section-label text-label-medium">
        {{ t('taskDetail.comments') }}
        <span v-if="store.taskComments.length > 0" class="meta-count ml-1">({{ store.taskComments.length }})</span>
      </p>
    </div>

    <TaskCommentsSection :comments="renderedComments" />
  </div>
</template>

<style scoped>
.task-right-col {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.section-label {
  font-weight: 600;
  color: var(--content-subtle);
  letter-spacing: 0.02em;
}
.right-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.right-section--collapsible {
  padding: 0;
}
.right-section--no-bottom {
  padding-bottom: 12px;
}

.blocked-banner {
  border-bottom: 1px solid rgba(var(--v-theme-warning), 0.3);
  background: rgba(var(--v-theme-warning), 0.1);
  flex-shrink: 0;
}
.blocked-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.blocked-item {
  color: rgb(var(--v-theme-warning));
}

.meta-label {
  color: var(--content-secondary);
  width: 56px;
  flex-shrink: 0;
}
.meta-count {
  color: var(--content-faint);
}

.commits-toggle {
  justify-content: space-between !important;
  height: auto !important;
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.toggle-arrow {
  width: 12px;
  height: 12px;
  color: var(--content-faint);
  transition: transform var(--md-duration-short3) var(--md-easing-standard);
}
.toggle-arrow--open {
  transform: rotate(90deg);
}
.commits-content {
  max-height: 160px;
  overflow-y: auto;
  border-top: 1px solid var(--edge-subtle);
}

.empty-text {
  color: var(--content-faint);
  font-style: italic;
}
</style>
