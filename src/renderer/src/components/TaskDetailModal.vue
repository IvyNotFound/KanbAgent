<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { renderMarkdown as renderMarkdownShared } from '@renderer/utils/renderMarkdown'
import { useCopyCode } from '@renderer/composables/useCopyCode'
import AgentBadge from './AgentBadge.vue'
import TaskDependencyGraph from './TaskDependencyGraph.vue'
import GitCommitList from './GitCommitList.vue'
import { agentFg, agentBg, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'
import type { TaskAssignee, TaskLink } from '@renderer/types'

const { t, locale } = useI18n()
const store = useTasksStore()
const task = computed(() => store.selectedTask)

// ── Agents lookup ─────────────────────────────────────────────────────────────
const valideurAgent = computed(() =>
  store.agents.find(a => a.id === task.value?.agent_validator_id) ?? null
)

const statusLabel = (key: string) => ({
  todo:        t('columns.todo'),
  in_progress: t('columns.in_progress'),
  done:        t('columns.done'),
  archived:    t('columns.archived'),
}[key] ?? key)

const STATUS_COLOR: Record<string, string | undefined> = {
  todo:        'chip-todo',
  in_progress: 'chip-in-progress',
  done:        'chip-done',
  archived:    'chip-archived',
  rejected:    'chip-rejected',
}

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_COLOR: Record<number, string> = { 1: 'chip-effort-s', 2: 'chip-effort-m', 3: 'chip-effort-l' }

const PRIORITY_COLOR: Record<string, string | undefined> = {
  low:      undefined,
  normal:   undefined,
  high:     'chip-priority-high',
  critical: 'chip-priority-critical',
}

const PRIORITY_LABEL: Record<string, string> = {
  low:      'Low',
  normal:   'Normal',
  high:     'High',
  critical: 'Critical',
}

function formatDateFull(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(iso).toLocaleString(dateLocale, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Normaliser les retours à la ligne
function normalizeNewlines(text: string): string {
  return text.replace(/\\n/g, '\n')
}

function renderMarkdown(text: string): string {
  return renderMarkdownShared(normalizeNewlines(text))
}

const taskPanelRef = ref<HTMLElement | null>(null)
useCopyCode(taskPanelRef)

// Computed for description
const renderedDescription = computed(() => {
  if (!task.value?.description) return ''
  return renderMarkdown(task.value.description)
})

// Memoized rendered comments — avoids re-parsing markdown on every render
const renderedComments = computed(() =>
  store.taskComments.map(c => ({ ...c, _html: renderMarkdown(c.content) }))
)

function relativeTime(iso: string): string {
  const diff = Date.now() - parseUtcDate(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('taskDetail.justNow')
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}j`
}

// ── Assignees (ADR-008, read-only — T571) ─────────────────────────────────────
// Synced from store.taskAssignees — display only, no mutation from UI

const assignees = ref<TaskAssignee[]>([])

// Sync display whenever the store loads assignees for the current task
watch(() => store.taskAssignees, (val) => { assignees.value = Array.isArray(val) ? [...val] : [] }, { immediate: true })

const sortedAssignees = computed(() =>
  [...assignees.value].sort((a, b) => {
    if (a.role === 'primary') return -1
    if (b.role === 'primary') return 1
    return 0
  })
)

// ── Blocked status (T553) ─────────────────────────────────────────────────────
// A task is blocked if it is 'todo' and has unresolved blockers (not done/archived)
const blockedByLinks = computed<TaskLink[]>(() => {
  if (!task.value) return []
  const id = task.value.id
  return store.taskLinks.filter(l =>
    (l.type === 'blocks' && l.to_task === id) ||
    (l.type === 'depends_on' && l.from_task === id)
  )
})

const unresolvedBlockers = computed(() => {
  if (!task.value || task.value.status !== 'todo') return []
  return blockedByLinks.value.filter(link => {
    const blockerStatus = link.from_task === task.value!.id ? link.to_status : link.from_status
    return blockerStatus !== 'done' && blockerStatus !== 'archived'
  })
})

const isBlocked = computed(() => unresolvedBlockers.value.length > 0)

// ── Git commits for this task (T761) ─────────────────────────────────────────
interface GitCommit { hash: string; date: string; subject: string; author: string; taskIds: number[] }
const gitCommits = ref<GitCommit[]>([])
const gitCommitsOpen = ref(false)

async function fetchGitCommitsForTask(taskId: number): Promise<void> {
  if (!store.projectPath) return
  try {
    const all = await window.electronAPI.gitLog(store.projectPath, { limit: 200 }) as GitCommit[]
    gitCommits.value = all.filter(c => c.taskIds.includes(taskId))
  } catch { gitCommits.value = [] }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') store.closeTask()
}

watch(task, (val) => {
  if (val) {
    document.removeEventListener('keydown', handleKeydown)
    document.addEventListener('keydown', handleKeydown)
    gitCommits.value = []
    gitCommitsOpen.value = false
    fetchGitCommitsForTask(val.id)
  } else {
    document.removeEventListener('keydown', handleKeydown)
    assignees.value = []
    gitCommits.value = []
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <v-dialog :model-value="!!task" max-width="1400" scrollable @update:model-value="store.closeTask()">
    <!-- v-if="task" ensures content not rendered when task is null (test compat for shallowMount) -->
    <div v-if="task" data-testid="task-detail-panel">
      <!-- Backdrop click handled by v-dialog; keep for test compat -->
      <div class="backdrop-overlay" @click="store.closeTask()"></div>

      <!-- Panel -->
      <div ref="taskPanelRef" class="task-panel elevation-3">

        <!-- Header -->
        <div class="task-header ga-3 py-4 px-5">
          <div class="task-header-left">
            <p class="task-title mb-2 text-body-2">{{ task.title }}</p>
            <div class="d-flex flex-wrap ga-2">
              <v-chip size="small" variant="tonal" :color="STATUS_COLOR[task.status]">
                {{ statusLabel(task.status) }}
              </v-chip>
              <v-chip
                v-if="task.priority && PRIORITY_COLOR[task.priority]"
                size="small"
                variant="tonal"
                :color="PRIORITY_COLOR[task.priority]"
              >
                {{ PRIORITY_LABEL[task.priority] }}
              </v-chip>
              <v-chip
                v-if="task.scope"
                size="small"
                variant="outlined"
                :style="{
                  color: perimeterFg(task.scope),
                  borderColor: perimeterBorder(task.scope),
                  backgroundColor: perimeterBg(task.scope),
                }"
              >{{ task.scope }}</v-chip>
              <v-chip
                v-if="task.effort"
                size="small"
                variant="tonal"
                :color="EFFORT_COLOR[task.effort]"
              >{{ EFFORT_LABEL[task.effort] }}</v-chip>
            </div>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="x-small"
            class="btn-close"
            :style="{ borderRadius: 'var(--shape-xs)', color: 'var(--content-subtle)' }"
            @click="store.closeTask()"
          />
        </div>

        <!-- Body : 2 colonnes -->
        <div class="task-body">

          <!-- Colonne gauche : description + commentaire tâche -->
          <div class="task-left-col py-4 px-5 ga-5">
            <!-- Description -->
            <div v-if="task.description">
              <p class="section-label mb-2 text-label-medium">{{ t('taskDetail.description') }}</p>
              <div class="md-content" v-html="renderedDescription"></div>
            </div>

            <p v-if="!task.description" class="empty-text pt-2 text-caption">
              {{ t('taskDetail.noDescription') }}
            </p>
          </div>

          <!-- Colonne droite : assignés + commentaires -->
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

            <!-- Section Agents (créateur / assigné / valideur) -->
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
                <div v-if="valideurAgent" class="d-flex align-center ga-2">
                  <span class="meta-label text-label-medium">{{ t('taskDetail.validator') }}</span>
                  <AgentBadge :name="valideurAgent.name" />
                </div>
              </div>
            </div>

            <!-- Section Dependencies -->
            <div class="right-section">
              <p class="section-label mb-2 text-label-medium">{{ t('taskDetail.dependencies') }}</p>
              <TaskDependencyGraph
                v-if="task"
                :task-id="task.id"
                :links="store.taskLinks"
                @navigate="(id) => { const t = store.tasks.find(x => x.id === id); if (t) store.openTask(t) }"
              />
            </div>

            <!-- Section Commits liés (T761) — hidden when no commits -->
            <div v-if="gitCommits.length > 0" class="right-section right-section--collapsible">
              <v-btn
                variant="text"
                block
                class="commits-toggle py-3 px-4"
                @click="gitCommitsOpen = !gitCommitsOpen"
              >
                <p class="section-label text-label-medium">
                  {{ t('taskDetail.commits') }}
                  <span class="meta-count">({{ gitCommits.length }})</span>
                </p>
                <v-icon
                  class="toggle-arrow"
                  :class="gitCommitsOpen ? 'toggle-arrow--open' : ''"
                  size="14"
                >mdi-chevron-right</v-icon>
              </v-btn>
              <div v-if="gitCommitsOpen" class="commits-content">
                <GitCommitList
                  :commits="gitCommits"
                  @open-task="(id) => { const t = store.tasks.find(x => x.id === id); if (t) store.openTask(t) }"
                />
              </div>
            </div>

            <!-- Section Assignés (read-only — T571) -->
            <div class="right-section">
              <p class="section-label mb-2 text-label-medium">
                {{ t('taskDetail.assignees') }}
              </p>

              <!-- Assigned agents list — display only -->
              <div v-if="sortedAssignees.length > 0" class="d-flex flex-column ga-2">
                <div v-for="a in sortedAssignees" :key="a.agent_id" class="d-flex align-center ga-2">
                  <v-avatar
                    size="20"
                    :style="{ color: agentFg(a.agent_name), backgroundColor: agentBg(a.agent_name) }"
                    :title="a.agent_name"
                    class="text-overline font-weight-bold"
                  >{{ a.agent_name.slice(0, 2).toUpperCase() }}</v-avatar>
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

            <div class="comments-list pa-3 ga-3">
              <!-- Messages conversation -->
              <div v-for="comment in renderedComments" :key="comment.id">
                <div class="md-bubble text-caption">
                  <div class="comment-bubble-header">
                    <div class="d-flex align-center ga-2" style="min-width: 0; flex: 1; overflow: hidden;">
                      <v-avatar
                        size="32"
                        :style="{ color: agentFg(comment.agent_name ?? 'unknown'), backgroundColor: agentBg(comment.agent_name ?? 'unknown') }"
                        class="text-overline font-weight-bold flex-shrink-0"
                      >{{ (comment.agent_name ?? '?').slice(0, 2).toUpperCase() }}</v-avatar>
                      <span class="comment-author">{{ comment.agent_name ?? '?' }}</span>
                    </div>
                    <span class="comment-time" :title="formatDateFull(comment.created_at)">
                      {{ relativeTime(comment.created_at) }}
                    </span>
                  </div>
                  <div class="comment-bubble-body" v-html="comment._html"></div>
                </div>
              </div>

              <p v-if="store.taskComments.length === 0" class="empty-text text-center py-4 text-caption">
                {{ t('taskDetail.noComments') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="task-footer py-3 px-5 ga-4">
          <div class="d-flex align-center ga-5">
            <p class="text-caption" style="color: var(--content-muted);">
              <span style="color: var(--content-subtle); margin-right: 4px;">{{ t('taskDetail.created') }}</span>{{ formatDateFull(task.created_at) }}
            </p>
            <p class="text-caption" style="color: var(--content-muted);">
              <span style="color: var(--content-subtle); margin-right: 4px;">{{ t('taskDetail.updated') }}</span>{{ formatDateFull(task.updated_at) }}
            </p>
          </div>
          <span class="text-caption font-mono" style="color: var(--content-subtle);">#{{ task.id }}</span>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* Backdrop overlay — kept for test compat (some tests look for click handler) */
.backdrop-overlay {
  position: absolute;
  inset: 0;
}

/* Main panel */
.task-panel {
  position: relative;
  width: 100%;
  max-height: 90vh;
  background: var(--surface-dialog);
  border: 1px solid var(--edge-default);
  border-radius: var(--shape-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: text;
}

/* Header */
.task-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.task-header-left {
  flex: 1;
  min-width: 0;
}
.task-title {
  font-weight: 600;
  color: var(--content-primary);
  line-height: 1.4;
}
.btn-close {
  flex-shrink: 0;
  /* size="x-small" sets 28×28px — border-radius and color via :style binding */
  transition: all var(--md-duration-short3) var(--md-easing-standard);
}

/* Body layout: 2 columns */
.task-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: none;
}
.task-body > .task-left-col {
  border-right: 1px solid var(--edge-subtle);
}

/* Left column */
.task-left-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Right column */
.task-right-col {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Section headings */
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

/* Blocked banner */
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

/* Meta labels */
.meta-label {
  color: var(--content-secondary);
  width: 56px;
  flex-shrink: 0;
}
.meta-count {
  color: var(--content-faint);
}

/* Commits collapsible */
.commits-toggle {
  justify-content: space-between !important; /* override Vuetify v-btn default center — no prop available */
  height: auto !important; /* override Vuetify v-btn fixed height — content drives height here */
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

/* Comments */
.comments-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.comment-bubble-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--edge-subtle);
}
.comment-bubble-body {
  padding: 8px 12px;
}
.comment-author {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comment-time {
  opacity: 0.65;
  flex-shrink: 0;
}

/* md-bubble: keep class for tests */
.md-bubble {
  border-radius: var(--shape-sm);
  line-height: 1.5;
  word-break: break-words;
  border: 1px solid var(--edge-subtle);
  background: var(--surface-card);
  color: var(--content-primary);
}

/* Empty states */
.empty-text {
  color: var(--content-faint);
  font-style: italic;
}

/* Footer */
.task-footer {
  border-top: 1px solid var(--edge-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.font-mono {
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
</style>
