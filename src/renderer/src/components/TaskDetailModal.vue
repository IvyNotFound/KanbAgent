<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import TaskDependencyGraph from './TaskDependencyGraph.vue'
import GitCommitList from './GitCommitList.vue'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'
import type { TaskAssignee, TaskLink } from '@renderer/types'

// Configure marked for synchronous rendering
marked.setOptions({ async: false })

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

// Semantic class names for status badges (no Tailwind color classes)
const STATUS_BADGE_CLASS: Record<string, string> = {
  todo:        'status-badge status-badge--todo',
  in_progress: 'status-badge status-badge--in-progress',
  done:        'status-badge status-badge--done',
  archived:    'status-badge status-badge--archived',
}

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
// Semantic class names for effort badges
const EFFORT_BADGE_CLASS: Record<number, string> = {
  1: 'effort-badge effort-badge--small',
  2: 'effort-badge effort-badge--medium',
  3: 'effort-badge effort-badge--large',
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

// Render markdown with DOMPurify sanitization
function renderMarkdown(text: string): string {
  const normalized = normalizeNewlines(text)
  const raw = marked.parse(normalized) as string
  return DOMPurify.sanitize(raw)
}

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
  <v-dialog :model-value="!!task" max-width="1152" scrollable @update:model-value="store.closeTask()">
    <!-- v-if="task" ensures content not rendered when task is null (test compat for shallowMount) -->
    <div v-if="task" data-testid="task-detail-panel">
      <!-- Backdrop click handled by v-dialog; keep for test compat -->
      <div class="backdrop-overlay" @click="store.closeTask()"></div>

      <!-- Panel -->
      <div class="task-panel">

        <!-- Header -->
        <div class="task-header">
          <div class="task-header-left">
            <p class="task-title">{{ task.title }}</p>
            <div class="d-flex flex-wrap ga-2">
              <span :class="STATUS_BADGE_CLASS[task.status] ?? 'status-badge'">
                {{ statusLabel(task.status) }}
              </span>
              <span
                v-if="task.scope"
                class="scope-badge"
                :style="{
                  color: perimeterFg(task.scope),
                  backgroundColor: perimeterBg(task.scope),
                  borderColor: perimeterBorder(task.scope),
                }"
              >{{ task.scope }}</span>
              <span
                v-if="task.effort"
                :class="EFFORT_BADGE_CLASS[task.effort] ?? 'effort-badge'"
              >{{ EFFORT_LABEL[task.effort] }}</span>
            </div>
          </div>
          <button class="btn-close" @click="store.closeTask()">✕</button>
        </div>

        <!-- Body : 2 colonnes -->
        <div class="task-body">

          <!-- Colonne gauche : description + commentaire tâche -->
          <div class="task-left-col">
            <!-- Description -->
            <div v-if="task.description">
              <p class="section-label mb-2">{{ t('taskDetail.description') }}</p>
              <div class="md-content" v-html="renderedDescription"></div>
            </div>

            <p v-if="!task.description" class="empty-text">
              {{ t('taskDetail.noDescription') }}
            </p>
          </div>

          <!-- Colonne droite : assignés + commentaires -->
          <div class="task-right-col">

            <!-- T553: Blocked indicator -->
            <div v-if="isBlocked" class="blocked-banner">
              <p class="section-label mb-1" style="color: #fbbf24;">{{ t('taskDetail.blockedTitle') }}</p>
              <ul class="blocked-list">
                <li
                  v-for="link in unresolvedBlockers"
                  :key="link.id"
                  class="blocked-item"
                >
                  #{{ link.from_task === task.id ? link.to_task : link.from_task }}
                  {{ link.from_task === task.id ? link.to_titre : link.from_titre }}
                </li>
              </ul>
            </div>

            <!-- Section Agents (créateur / assigné / valideur) -->
            <div class="right-section">
              <p class="section-label mb-2">{{ t('taskDetail.agents') }}</p>
              <div class="d-flex flex-column ga-2">
                <div v-if="task.agent_creator_name" class="d-flex align-center ga-2">
                  <span class="meta-label">{{ t('taskDetail.creator') }}</span>
                  <AgentBadge :name="task.agent_creator_name" />
                </div>
                <div v-if="task.agent_name" class="d-flex align-center ga-2">
                  <span class="meta-label">{{ t('taskDetail.assigned') }}</span>
                  <AgentBadge :name="task.agent_name" />
                </div>
                <div v-if="valideurAgent" class="d-flex align-center ga-2">
                  <span class="meta-label">{{ t('taskDetail.validator') }}</span>
                  <AgentBadge :name="valideurAgent.name" />
                </div>
              </div>
            </div>

            <!-- Section Dependencies -->
            <div class="right-section">
              <p class="section-label mb-2">{{ t('taskDetail.dependencies') }}</p>
              <TaskDependencyGraph
                v-if="task"
                :task-id="task.id"
                :links="store.taskLinks"
                @navigate="(id) => { const t = store.tasks.find(x => x.id === id); if (t) store.openTask(t) }"
              />
            </div>

            <!-- Section Commits liés (T761) — hidden when no commits -->
            <div v-if="gitCommits.length > 0" class="right-section right-section--collapsible">
              <button
                class="commits-toggle"
                @click="gitCommitsOpen = !gitCommitsOpen"
              >
                <p class="section-label">
                  {{ t('taskDetail.commits') }}
                  <span class="meta-count">({{ gitCommits.length }})</span>
                </p>
                <v-icon
                  class="toggle-arrow"
                  :class="gitCommitsOpen ? 'toggle-arrow--open' : ''"
                  size="14"
                >mdi-chevron-right</v-icon>
              </button>
              <div v-if="gitCommitsOpen" class="commits-content">
                <GitCommitList
                  :commits="gitCommits"
                  @open-task="(id) => { const t = store.tasks.find(x => x.id === id); if (t) store.openTask(t) }"
                />
              </div>
            </div>

            <!-- Section Assignés (read-only — T571) -->
            <div class="right-section">
              <p class="section-label mb-2">
                {{ t('taskDetail.assignees') }}
              </p>

              <!-- Assigned agents list — display only -->
              <div v-if="sortedAssignees.length > 0" class="d-flex flex-column ga-2">
                <div v-for="a in sortedAssignees" :key="a.agent_id" class="d-flex align-center ga-2">
                  <div
                    class="assignee-avatar"
                    :style="{ color: agentFg(a.agent_name), backgroundColor: agentBg(a.agent_name), borderColor: agentBorder(a.agent_name) }"
                    :title="a.agent_name"
                  >{{ a.agent_name.slice(0, 2).toUpperCase() }}</div>
                  <span class="text-caption" style="color: var(--content-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ a.agent_name }}</span>
                  <span class="text-caption" style="color: var(--content-faint); flex-shrink: 0;">{{ a.role ?? '—' }}</span>
                </div>
              </div>
              <p v-else class="empty-text">
                {{ t('taskDetail.noAssignees') }}
              </p>
            </div>

            <!-- Comments header -->
            <div class="right-section right-section--no-bottom">
              <p class="section-label">
                {{ t('taskDetail.comments') }}
                <span v-if="store.taskComments.length > 0" class="meta-count ml-1">({{ store.taskComments.length }})</span>
              </p>
            </div>

            <div class="comments-list">
              <!-- Messages conversation -->
              <div
                v-for="comment in renderedComments"
                :key="comment.id"
                class="d-flex flex-column ga-1"
              >
                <!-- Auteur + temps -->
                <div class="d-flex align-center justify-space-between ga-2 px-1">
                  <span
                    class="comment-author"
                    :style="{ color: agentFg(comment.agent_name ?? 'unknown') }"
                  >{{ comment.agent_name ?? '?' }}</span>
                  <span class="comment-time" :title="formatDateFull(comment.created_at)">
                    {{ relativeTime(comment.created_at) }}
                  </span>
                </div>
                <!-- Bulle -->
                <div
                  class="md-bubble"
                  :style="{
                    color: agentFg(comment.agent_name ?? 'unknown'),
                    backgroundColor: agentBg(comment.agent_name ?? 'unknown'),
                    borderColor: agentBorder(comment.agent_name ?? 'unknown'),
                  }"
                  v-html="comment._html"
                ></div>
              </div>

              <p v-if="store.taskComments.length === 0" class="empty-text text-center py-4">
                {{ t('taskDetail.noComments') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="task-footer">
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
  background: var(--surface-primary);
  border: 1px solid var(--edge-default);
  border-radius: 12px;
  box-shadow: 0 25px 50px rgba(0,0,0,0.5);
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
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.task-header-left {
  flex: 1;
  min-width: 0;
}
.task-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--content-primary);
  line-height: 1.4;
  margin-bottom: 8px;
}
.btn-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--content-subtle);
  cursor: pointer;
  font-size: 14px;
  transition: all 150ms;
}
.btn-close:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}

/* Status badges */
.status-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 9999px;
  border: 1px solid;
  font-weight: 500;
}
.status-badge--todo        { background: rgba(245,158,11,0.2);   color: #fcd34d; border-color: rgba(245,158,11,0.3); }
.status-badge--in-progress { background: rgba(16,185,129,0.2);   color: #6ee7b7; border-color: rgba(16,185,129,0.3); }
.status-badge--done        { background: rgba(113,113,122,0.2);  color: #a1a1aa; border-color: rgba(113,113,122,0.3); }
.status-badge--archived    { background: rgba(139,92,246,0.2);   color: #c4b5fd; border-color: rgba(139,92,246,0.3); }

/* Scope badge */
.scope-badge {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  border: 1px solid;
}

/* Effort badges */
.effort-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  border: 1px solid;
}
.effort-badge--small  { background: rgba(16,185,129,0.2);  color: #6ee7b7; border-color: rgba(16,185,129,0.3); }
.effort-badge--medium { background: rgba(245,158,11,0.2);  color: #fcd34d; border-color: rgba(245,158,11,0.3); }
.effort-badge--large  { background: rgba(239,68,68,0.2);   color: #fca5a5; border-color: rgba(239,68,68,0.3); }

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
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Right column */
.task-right-col {
  width: 288px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Section headings */
.section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
  padding: 8px 16px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.1);
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
  font-size: 10px;
  color: rgba(251, 191, 36, 0.8);
}

/* Meta labels */
.meta-label {
  font-size: 10px;
  color: var(--content-faint);
  width: 56px;
  flex-shrink: 0;
}
.meta-count {
  color: var(--content-faint);
}

/* Commits collapsible */
.commits-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: none;
  border: none;
  cursor: pointer;
  transition: background 150ms;
}
.commits-toggle:hover {
  background: rgba(var(--v-theme-on-surface, 255,255,255), 0.03);
}
.toggle-arrow {
  width: 12px;
  height: 12px;
  color: var(--content-faint);
  transition: transform 150ms;
}
.toggle-arrow--open {
  transform: rotate(90deg);
}
.commits-content {
  max-height: 160px;
  overflow-y: auto;
  border-top: 1px solid var(--edge-subtle);
}

/* Assignee avatar */
.assignee-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  border: 1px solid;
}

/* Comments */
.comments-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.comment-author {
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comment-time {
  font-size: 10px;
  color: var(--content-faint);
  flex-shrink: 0;
}

/* md-bubble: keep class for tests */
.md-bubble {
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-words;
  border: 1px solid;
}

/* Empty states */
.empty-text {
  font-size: 12px;
  color: var(--content-faint);
  font-style: italic;
  padding-top: 8px;
}

/* Footer */
.task-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--edge-subtle);
  background: var(--surface-base);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}
.font-mono {
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
</style>
