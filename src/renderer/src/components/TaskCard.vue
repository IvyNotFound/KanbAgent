<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import AgentBadge from './AgentBadge.vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'

const { t, locale } = useI18n()
defineProps<{ task: Task }>()
const store = useTasksStore()

function formatDate(iso: string): string {
  const loc = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return new Date(iso).toLocaleString(loc, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_BADGE: Record<number, string> = {
  1: 'bg-emerald-500/20 text-emerald-300',
  2: 'bg-amber-500/20 text-amber-300',
  3: 'bg-red-500/20 text-red-300',
}
</script>

<template>
  <div
    class="bg-zinc-800 border border-zinc-700 rounded-lg p-3 hover:border-zinc-600 transition-colors cursor-pointer"
    @click="store.openTask(task)"
  >
    <div class="flex items-start justify-between gap-2 mb-2">
      <p class="text-sm text-zinc-100 font-medium leading-snug flex-1 min-w-0">{{ task.titre }}</p>
      <span class="text-xs text-zinc-400 font-mono shrink-0">#{{ task.id }}</span>
      <span
        v-if="task.effort"
        :class="['text-[10px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0', EFFORT_BADGE[task.effort]]"
      >{{ EFFORT_LABEL[task.effort] }}</span>
    </div>

    <div class="flex flex-wrap gap-1 mb-2">
      <span
        v-if="task.perimetre"
        class="text-xs px-1.5 py-0.5 rounded font-mono border"
        :style="{
          color: perimeterFg(task.perimetre),
          backgroundColor: perimeterBg(task.perimetre),
          borderColor: perimeterBorder(task.perimetre),
        }"
      >{{ task.perimetre }}</span>
      <AgentBadge v-if="task.agent_name" :name="task.agent_name" :perimetre="task.agent_perimetre" />
    </div>

    <!-- Dates -->
    <div class="flex flex-col gap-0.5 mt-2 pt-2 border-t border-zinc-700/50">
      <p class="text-xs text-zinc-500">
        <span class="text-zinc-400">{{ t('taskDetail.created') }}</span> {{ formatDate(task.created_at) }}
      </p>
      <p class="text-xs text-zinc-500">
        <span class="text-zinc-400">{{ t('taskDetail.updated') }}</span> {{ formatDate(task.updated_at) }}
      </p>
    </div>
  </div>
</template>
