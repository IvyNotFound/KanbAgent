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
import { agentFg, agentBg, perimeterFg, perimeterBg } from '@renderer/utils/agentColor'

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

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_COLOR: Record<number, string> = { 1: 'chip-effort-s', 2: 'chip-effort-m', 3: 'chip-effort-l' }

const plainDescription = computed(() => {
  if (!props.task.description) return ''
  return props.task.description
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
})
</script>

<template>
  <v-card
    class="task-card"
    variant="flat"
    :ripple="false"
    :draggable="task.status === 'todo' || task.status === 'in_progress'"
    :style="{
      backgroundColor: 'var(--surface-secondary)',
      border: '1px solid var(--edge-default)',
      borderRadius: 'var(--shape-md)',
    }"
    @click="store.openTask(task)"
    @dragstart="onDragStart"
    @contextmenu="onContextMenu"
  >
    <!-- Card body: unified section with consistent gap between zones -->
    <v-card-text class="card-body pa-4 pb-0">
      <!-- Top row: title + effort/priority badges -->
      <div class="card-top ga-2">
        <div class="card-title-area">
          <p class="card-title text-body-2">{{ task.title }}</p>
        </div>
        <div class="card-badge-row ga-1">
          <v-chip v-if="task.priority === 'critical'" size="x-small" variant="tonal" color="chip-priority-critical">!!</v-chip>
          <v-chip v-if="task.priority === 'high'" size="x-small" variant="tonal" color="chip-priority-high">!</v-chip>
          <v-chip v-if="task.priority === 'normal'" size="x-small" variant="tonal" color="default">—</v-chip>
          <v-chip v-if="task.effort" size="x-small" variant="tonal" :color="EFFORT_COLOR[task.effort]">{{ EFFORT_LABEL[task.effort] }}</v-chip>
        </div>
      </div>

      <!-- Badges: perimeter + agent avatars -->
      <div v-if="task.scope || task.agent_name || assigneeAvatars.length > 0" class="card-meta mt-3">
        <v-chip
          v-if="task.scope"
          size="x-small"
          variant="tonal"
          rounded="sm"
          :style="{
            color: perimeterFg(task.scope),
            backgroundColor: perimeterBg(task.scope),
          }"
        >
          {{ task.scope }}
        </v-chip>
        <!-- Multi-agent avatars (≤3 + overflow badge) -->
        <div v-if="assigneeAvatars.length > 0" class="card-avatars">
          <v-avatar
            v-for="av in visibleAvatars"
            :key="av.agent_id"
            :size="20"
            :style="{ color: agentFg(av.agent_name), backgroundColor: agentBg(av.agent_name) }"
            :title="av.agent_name"
            class="text-caption font-weight-bold"
          >
            {{ av.agent_name.slice(0, 2).toUpperCase() }}
          </v-avatar>
          <v-chip v-if="overflowCount > 0" size="x-small" variant="tonal">+{{ overflowCount }}</v-chip>
        </div>
        <!-- Fallback: single agent badge when no task_agents rows -->
        <AgentBadge v-else-if="task.agent_name" :name="task.agent_name" :perimetre="task.agent_scope" />
      </div>

      <!-- Description excerpt: up to 2 lines, fills body to balance footer -->
      <p v-if="task.description" class="card-description text-body-2 mt-3">{{ plainDescription }}</p>
    </v-card-text>

    <!-- Footer: dates left, #id right -->
    <v-card-text
      class="card-footer-section mt-auto"
      :class="{ 'card-footer-bordered': task.scope || task.agent_name }"
    >
      <div class="card-footer ga-2">
        <div class="card-dates">
          <p class="card-date text-caption">
            <v-icon size="10">mdi-clock-plus-outline</v-icon> {{ formattedCreatedAt }}
          </p>
          <p class="card-date text-caption">
            <v-icon size="10">mdi-clock-edit-outline</v-icon> {{ formattedUpdatedAt }}
          </p>
        </div>
        <span class="card-id">#{{ task.id }}</span>
      </div>
    </v-card-text>
  </v-card>

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
  /* background / border / border-radius set via :style binding — overrides Vuetify without !important */
  cursor: pointer;
  min-height: 96px;
  flex-shrink: 0; /* prevent compression in flex column when many cards present */
  position: relative;
  overflow: hidden;
  transition: box-shadow var(--md-duration-short3) var(--md-easing-standard);
}
/* MD3 state layer — translucent overlay on hover instead of border-color change */
.task-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-color: rgba(var(--v-theme-on-surface), 0);
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
  pointer-events: none;
  z-index: 0;
}
.task-card:hover::after {
  background-color: rgba(var(--v-theme-on-surface), var(--md-state-hover));
}
.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.card-title-area {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}
.card-title {
  color: var(--content-primary);
  font-weight: 500;
  line-height: 1.35;
  min-width: 0;
  word-break: break-word;
}
.card-badge-row {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.card-avatars {
  display: flex;
  align-items: center;
}
/* MD3 avatar group: overlapping stack */
.card-avatars :deep(.v-avatar + .v-avatar) {
  margin-left: -6px;
}
/* :deep() required — v-avatar border has no Vuetify prop; adds MD3 visual separation in overlapping stack */
.card-avatars :deep(.v-avatar) {
  border: 1.5px solid var(--surface-secondary);
}
/* Compact footer: reduces vertical padding vs Vuetify pa-3 default (12px → 6/8px) */
.card-footer-section {
  padding: 8px 16px 10px;
}
/* Increased specificity beats Vuetify v-card-text flex/display overrides (T1607) */
.task-card .card-description {
  color: var(--content-muted);
  line-height: 1.4;
  margin: 0;
  /* T1607: pure max-height + overflow approach — more reliable in Electron/Chromium than -webkit-line-clamp
     which can be defeated by Vuetify v-card-text flex/display overrides on todo/done columns */
  overflow: hidden;
  max-height: calc(2 * 1.4 * 0.875rem); /* 2 lines × line-height × text-body-2 font-size */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}
.card-footer-bordered {
  border-top: 1px solid color-mix(in srgb, var(--edge-subtle) 50%, transparent);
}
.card-dates {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-date {
  color: var(--content-subtle);
  display: flex;
  align-items: center;
  gap: 3px;
}
.card-id {
  font-size: 0.75rem;
  color: var(--content-faint);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  flex-shrink: 0;
}
</style>
