<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { renderMarkdown as renderMarkdownShared } from '@renderer/utils/renderMarkdown'
import { useCopyCode } from '@renderer/composables/useCopyCode'
import AgentBadge from './AgentBadge.vue'
import TaskDetailRightCol from './TaskDetailRightCol.vue'
import { perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
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

function normalizeNewlines(text: string): string {
  return text.replace(/\\n/g, '\n')
}

function renderMarkdown(text: string): string {
  return renderMarkdownShared(normalizeNewlines(text))
}

const taskPanelRef = ref<HTMLElement | null>(null)
useCopyCode(taskPanelRef)

const renderedDescription = computed(() => {
  if (!task.value?.description) return ''
  return renderMarkdown(task.value.description)
})

// Memoized rendered comments — avoids re-parsing markdown on every render
const renderedComments = computed(() =>
  store.taskComments.map(c => ({ ...c, _html: renderMarkdown(c.content) }))
)

// ── Assignees (ADR-008, read-only — T571) ─────────────────────────────────────
const assignees = ref<TaskAssignee[]>([])

watch(() => store.taskAssignees, (val) => { assignees.value = Array.isArray(val) ? [...val] : [] }, { immediate: true })

const sortedAssignees = computed(() =>
  [...assignees.value].sort((a, b) => {
    if (a.role === 'primary') return -1
    if (b.role === 'primary') return 1
    return 0
  })
)

// ── Blocked status (T553) ─────────────────────────────────────────────────────
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
    return blockerStatus !== 'archived'
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

function navigateTask(id: number) {
  const t = store.tasks.find(x => x.id === id)
  if (t) store.openTask(t)
}
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
              >
                {{ task.scope }}
              </v-chip>
              <v-chip
                v-if="task.effort"
                size="small"
                variant="tonal"
                :color="EFFORT_COLOR[task.effort]"
              >
                {{ EFFORT_LABEL[task.effort] }}
              </v-chip>
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

        <!-- Body: 2 columns -->
        <div class="task-body">
          <!-- Left column: description -->
          <div class="task-left-col py-4 px-5 ga-5">
            <div v-if="task.description">
              <p class="section-label mb-2 text-label-medium">{{ t('taskDetail.description') }}</p>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized via DOMPurify -->
              <div class="md-content" v-html="renderedDescription"></div>
            </div>

            <p v-if="!task.description" class="empty-text pt-2 text-caption">
              {{ t('taskDetail.noDescription') }}
            </p>
          </div>

          <!-- Right column (extracted) -->
          <TaskDetailRightCol
            :task="task"
            :valideur-agent-name="valideurAgent?.name ?? null"
            :sorted-assignees="sortedAssignees"
            :blocked-by-links="blockedByLinks"
            :unresolved-blockers="unresolvedBlockers"
            :is-blocked="isBlocked"
            :git-commits="gitCommits"
            :git-commits-open="gitCommitsOpen"
            :rendered-comments="renderedComments"
            @update:git-commits-open="gitCommitsOpen = $event"
            @navigate-task="navigateTask"
          />
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
.backdrop-overlay {
  position: absolute;
  inset: 0;
}

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
  transition: all var(--md-duration-short3) var(--md-easing-standard);
}

.task-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: none;
}
.task-body > .task-left-col {
  border-right: 1px solid var(--edge-subtle);
}

.task-left-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.section-label {
  font-weight: 600;
  color: var(--content-subtle);
  letter-spacing: 0.02em;
}

.empty-text {
  color: var(--content-faint);
  font-style: italic;
}

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
