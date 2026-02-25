<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import TaskCard from './TaskCard.vue'

defineProps<{
  title: string
  statut: string
  tasks: Task[]
  accentClass: string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col flex-1 min-w-0 bg-zinc-900/50 rounded-xl border border-zinc-800">
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
      <div class="flex items-center gap-2">
        <div :class="['w-2 h-2 rounded-full', accentClass]"></div>
        <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">{{ title }}</span>
      </div>
      <span class="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{{ tasks.length }}</span>
    </div>
    <div class="flex-1 overflow-y-auto p-2 space-y-2 min-h-0" style="contain: content; will-change: scroll-position;">
      <TaskCard v-for="task in tasks" :key="task.id" :task="task" />
      <div v-if="tasks.length === 0" class="text-xs text-zinc-600 text-center py-8">{{ t('statusColumn.noTasks') }}</div>
    </div>
  </div>
</template>
