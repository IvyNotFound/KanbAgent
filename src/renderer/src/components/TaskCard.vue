<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import AgentBadge from './AgentBadge.vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'

const { t, locale } = useI18n()
const props = defineProps<{ task: Task }>()
const store = useTasksStore()

// Multi-agent avatars (lazy-loaded on mount)
interface AssigneeAvatar { agent_id: number; agent_name: string; role: string | null }
const assigneeAvatars = ref<AssigneeAvatar[]>([])
const visibleAvatars = computed(() => assigneeAvatars.value.slice(0, 3))
const overflowCount = computed(() => Math.max(0, assigneeAvatars.value.length - 3))

onMounted(async () => {
  if (!store.dbPath || !props.task.id) return
  try {
    const res = await window.electronAPI.getTaskAssignees(store.dbPath, props.task.id)
    if (res.success) assigneeAvatars.value = res.assignees as AssigneeAvatar[]
  } catch {
    // silent: fallback to agent_assigne_id badge
  }
})

function onDragStart(e: DragEvent): void {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/x-task-id', String(props.task.id))
}

function formatDate(iso: string): string {
  const loc = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return new Date(iso).toLocaleString(loc, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const formattedCreatedAt = computed(() => formatDate(props.task.created_at))
const formattedUpdatedAt = computed(() => formatDate(props.task.updated_at))

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_BADGE: Record<number, string> = {
  1: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  2: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  3: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal:   'bg-surface-tertiary text-content-muted border-edge-default',
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
    class="bg-surface-secondary border border-edge-default rounded-lg p-3 hover:border-content-faint transition-colors cursor-pointer min-h-[120px] flex flex-col"
    :draggable="task.statut === 'todo' || task.statut === 'in_progress'"
    @click="store.openTask(task)"
    @dragstart="onDragStart"
  >
    <!-- Top row: title + effort/priority -->
    <div class="flex items-start justify-between gap-2 mb-2">
      <p class="text-sm text-content-primary font-medium leading-snug flex-1 min-w-0">{{ task.titre }}</p>
      <div class="flex items-center gap-1 shrink-0">
        <span
          v-if="task.priority && task.priority !== 'normal' && task.priority !== 'low'"
          :class="['text-xs font-bold px-1.5 py-0.5 rounded font-mono border', PRIORITY_BADGE[task.priority]]"
        >{{ PRIORITY_LABEL[task.priority] }}</span>
        <span
          v-if="task.effort"
          :class="['text-xs font-bold px-1.5 py-0.5 rounded font-mono border', EFFORT_BADGE[task.effort]]"
        >{{ EFFORT_LABEL[task.effort] }}</span>
      </div>
    </div>

    <!-- Badges: perimeter + agent avatars -->
    <div v-if="task.perimetre || task.agent_name || assigneeAvatars.length > 0" class="flex flex-wrap gap-1 mb-2">
      <span
        v-if="task.perimetre"
        class="text-xs px-1.5 py-0.5 rounded font-mono border"
        :style="{
          color: perimeterFg(task.perimetre),
          backgroundColor: perimeterBg(task.perimetre),
          borderColor: perimeterBorder(task.perimetre),
        }"
      >{{ task.perimetre }}</span>
      <!-- Multi-agent avatars (≤3 + overflow badge) -->
      <div v-if="assigneeAvatars.length > 0" class="flex items-center gap-0.5">
        <div
          v-for="av in visibleAvatars"
          :key="av.agent_id"
          class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border"
          :style="{ color: agentFg(av.agent_name), backgroundColor: agentBg(av.agent_name), borderColor: agentBorder(av.agent_name) }"
          :title="av.agent_name"
        >{{ av.agent_name.slice(0, 2).toUpperCase() }}</div>
        <div
          v-if="overflowCount > 0"
          class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold bg-surface-tertiary text-content-muted border border-edge-default"
        >+{{ overflowCount }}</div>
      </div>
      <!-- Fallback: single agent badge when no task_agents rows -->
      <AgentBadge v-else-if="task.agent_name" :name="task.agent_name" :perimetre="task.agent_perimetre" />
    </div>

    <!-- Footer: dates left, #id right -->
    <div :class="['flex items-end justify-between gap-2 mt-auto pt-2', (task.perimetre || task.agent_name) && 'border-t border-edge-default/50']">
      <div class="flex flex-col gap-0.5">
        <p class="text-xs text-content-subtle">
          <span class="text-content-muted">{{ t('taskDetail.created') }}</span> {{ formattedCreatedAt }}
        </p>
        <p class="text-xs text-content-subtle">
          <span class="text-content-muted">{{ t('taskDetail.updated') }}</span> {{ formattedUpdatedAt }}
        </p>
      </div>
      <span class="text-xs text-content-faint font-mono shrink-0">#{{ task.id }}</span>
    </div>
  </div>
</template>
