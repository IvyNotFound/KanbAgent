<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import AgentBadge from './AgentBadge.vue'
import { parseUtcDate } from '@renderer/utils/parseDate'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { useLaunchSession, MAX_AGENT_SESSIONS } from '@renderer/composables/useLaunchSession'
import { useToast } from '@renderer/composables/useToast'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { isStale, staleDuration } from '@renderer/utils/staleTask'

const { t, locale } = useI18n()
const props = defineProps<{ task: Task }>()
const store = useTasksStore()
const tabsStore = useTabsStore()
const { launchAgentTerminal, canLaunchSession } = useLaunchSession()
const toast = useToast()

// Multi-agent avatars — read from board-level cache in store (no per-card IPC, T787)
const assigneeAvatars = computed(() => store.boardAssignees.get(props.task.id) ?? [])
const visibleAvatars = computed(() => assigneeAvatars.value.slice(0, 3))
const overflowCount = computed(() => Math.max(0, assigneeAvatars.value.length - 3))

function onDragStart(e: DragEvent): void {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/x-task-id', String(props.task.id))
}

// ── Context menu (right-click relaunch for in_progress tasks) ─────────────────
const contextMenu = ref<{ x: number; y: number } | null>(null)

function onContextMenu(event: MouseEvent): void {
  if (props.task.status !== 'in_progress') return
  event.preventDefault()
  contextMenu.value = { x: event.clientX, y: event.clientY }
}

async function handleRelaunch(): Promise<void> {
  if (!props.task.agent_assigned_id) {
    toast.push(t('board.noAgentAssigned'), 'warn')
    return
  }
  const agent = store.agents.find(a => a.id === props.task.agent_assigned_id)
  if (!agent) {
    toast.push(t('board.agentNotFound'), 'error')
    return
  }
  if (!canLaunchSession(agent)) {
    const max = agent.max_sessions ?? MAX_AGENT_SESSIONS
    toast.push(t('board.sessionLimitReached', { agent: agent.name, max }), 'warn')
    return
  }
  const result = await launchAgentTerminal(agent, props.task)
  if (result === 'error') {
    toast.push(t('board.launchFailed', { agent: agent.name }), 'error')
  }
}

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  if (props.task.status !== 'in_progress') return []
  const alreadyOpen = tabsStore.tabs.some(
    tab => tab.type === 'terminal' && tab.taskId === props.task.id
  )
  return [{
    label: alreadyOpen
      ? t('taskCard.sessionAlreadyOpen')
      : t('taskCard.relaunchAgent'),
    action: alreadyOpen
      ? () => { toast.push(t('taskCard.sessionAlreadyOpenDetail', { id: props.task.id }), 'info') }
      : () => { handleRelaunch() },
  }]
})

function formatDate(iso: string): string {
  const loc = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(iso).toLocaleString(loc, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const formattedCreatedAt = computed(() => formatDate(props.task.created_at))
const formattedUpdatedAt = computed(() => formatDate(props.task.updated_at))

const isStaleTask = computed(() =>
  props.task.status === 'in_progress' && isStale(props.task.started_at, store.staleThresholdMinutes)
)
const staleTooltip = computed(() => {
  const d = staleDuration(props.task.started_at)
  return d ? t('task.staleFor', { duration: d }) : t('task.staleLong')
})

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_CLASS: Record<number, string> = {
  1: 'badge-effort-1',
  2: 'badge-effort-2',
  3: 'badge-effort-3',
}

const PRIORITY_CLASS: Record<string, string> = {
  critical: 'badge-priority-critical',
  high:     'badge-priority-high',
  normal:   'badge-priority-normal',
  low:      '',
}
const PRIORITY_LABEL: Record<string, string> = {
  critical: '!!',
  high:     '!',
  normal:   '—',
  low:      '',
}
</script>

<template>
  <div
    class="task-card"
    :draggable="task.status === 'todo' || task.status === 'in_progress'"
    @click="store.openTask(task)"
    @dragstart="onDragStart"
    @contextmenu="onContextMenu"
  >
    <!-- Top row: title + effort/priority -->
    <div class="card-top">
      <div class="card-title-area">
        <span
          v-if="task.status === 'in_progress'"
          class="card-pulse"
          :title="t('task.running')"
          :aria-label="t('task.running')"
        />
        <p class="card-title">{{ task.title }}</p>
      </div>
      <div class="card-badge-row">
        <span
          v-if="isStaleTask"
          class="badge badge-stale"
          :title="staleTooltip"
        >⚠</span>
        <span
          v-if="task.priority && task.priority !== 'normal' && task.priority !== 'low'"
          :class="['badge', PRIORITY_CLASS[task.priority]]"
        >{{ PRIORITY_LABEL[task.priority] }}</span>
        <span
          v-if="task.effort"
          :class="['badge', EFFORT_CLASS[task.effort]]"
        >{{ EFFORT_LABEL[task.effort] }}</span>
      </div>
    </div>

    <!-- Badges: perimeter + agent avatars -->
    <div v-if="task.scope || task.agent_name || assigneeAvatars.length > 0" class="card-meta">
      <span
        v-if="task.scope"
        class="badge-scope"
        :style="{
          color: perimeterFg(task.scope),
          backgroundColor: perimeterBg(task.scope),
          borderColor: perimeterBorder(task.scope),
        }"
      >{{ task.scope }}</span>
      <!-- Multi-agent avatars (≤3 + overflow badge) -->
      <div v-if="assigneeAvatars.length > 0" class="card-avatars">
        <div
          v-for="av in visibleAvatars"
          :key="av.agent_id"
          class="avatar"
          :style="{ color: agentFg(av.agent_name), backgroundColor: agentBg(av.agent_name), borderColor: agentBorder(av.agent_name) }"
          :title="av.agent_name"
        >{{ av.agent_name.slice(0, 2).toUpperCase() }}</div>
        <div
          v-if="overflowCount > 0"
          class="avatar avatar-overflow"
        >+{{ overflowCount }}</div>
      </div>
      <!-- Fallback: single agent badge when no task_agents rows -->
      <AgentBadge v-else-if="task.agent_name" :name="task.agent_name" :perimetre="task.agent_scope" />
    </div>

    <!-- Footer: dates left, #id right -->
    <div :class="['card-footer', { 'card-footer-bordered': task.scope || task.agent_name }]">
      <div class="card-dates">
        <p class="card-date">
          <span class="date-label">{{ t('taskDetail.created') }}</span> {{ formattedCreatedAt }}
        </p>
        <p class="card-date">
          <span class="date-label">{{ t('taskDetail.updated') }}</span> {{ formattedUpdatedAt }}
        </p>
      </div>
      <span class="card-id">#{{ task.id }}</span>
    </div>
  </div>

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="contextMenuItems"
    @close="contextMenu = null"
  />
</template>

<style scoped>
.task-card {
  background-color: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  transition: border-color 150ms;
}
.task-card:hover {
  border-color: var(--content-faint);
}
.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.card-title-area {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.card-pulse {
  margin-top: 4px;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #22d3ee; /* cyan-400 */
  animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  display: inline-block;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.card-title {
  font-size: 0.875rem;
  color: var(--content-primary);
  font-weight: 500;
  line-height: 1.35;
  min-width: 0;
  word-break: break-word;
}
.card-badge-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
/* Base badge */
.badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  border: 1px solid transparent;
}
.badge-stale {
  background-color: rgba(249, 115, 22, 0.2);
  color: #fb923c; /* orange-400 */
  border-color: rgba(249, 115, 22, 0.3);
}
.badge-effort-1 {
  background-color: rgba(16, 185, 129, 0.2);
  color: #34d399; /* emerald-400 */
  border-color: rgba(16, 185, 129, 0.3);
}
.badge-effort-2 {
  background-color: rgba(245, 158, 11, 0.2);
  color: #fbbf24; /* amber-400 */
  border-color: rgba(245, 158, 11, 0.3);
}
.badge-effort-3 {
  background-color: rgba(239, 68, 68, 0.2);
  color: #f87171; /* red-400 */
  border-color: rgba(239, 68, 68, 0.3);
}
.badge-priority-critical {
  background-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
}
.badge-priority-high {
  background-color: rgba(249, 115, 22, 0.2);
  color: #fb923c;
  border-color: rgba(249, 115, 22, 0.3);
}
.badge-priority-normal {
  background-color: var(--surface-tertiary);
  color: var(--content-muted);
  border-color: var(--edge-default);
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.badge-scope {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  border: 1px solid transparent;
}
.card-avatars {
  display: flex;
  align-items: center;
  gap: 2px;
}
.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  border: 1px solid transparent;
}
.avatar-overflow {
  background-color: var(--surface-tertiary);
  color: var(--content-muted);
  border-color: var(--edge-default);
}
.card-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
}
.card-footer-bordered {
  border-top: 1px solid color-mix(in srgb, var(--edge-default) 50%, transparent);
}
.card-dates {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-date {
  font-size: 0.75rem;
  color: var(--content-subtle);
}
.date-label {
  color: var(--content-muted);
}
.card-id {
  font-size: 0.75rem;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  flex-shrink: 0;
}
</style>
