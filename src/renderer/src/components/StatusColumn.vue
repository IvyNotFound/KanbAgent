<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import TaskCard from './TaskCard.vue'

const props = defineProps<{
  title: string
  statut: string
  tasks: Task[]
  accentClass: string
}>()

const emit = defineEmits<{
  (e: 'task-dropped', taskId: number): void
}>()

const { t } = useI18n()

const isDragOver = ref(false)
const isDropTarget = computed(() => props.statut === 'in_progress')

function onDragOver(e: DragEvent): void {
  if (!isDropTarget.value) return
  if (!e.dataTransfer?.types.includes('application/x-task-id')) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  isDragOver.value = true
}

function onDragLeave(): void {
  isDragOver.value = false
}

function onDrop(e: DragEvent): void {
  isDragOver.value = false
  if (!isDropTarget.value) return
  const taskId = e.dataTransfer?.getData('application/x-task-id')
  if (!taskId) return
  e.preventDefault()
  emit('task-dropped', Number(taskId))
}
</script>

<template>
  <div
    :class="[
      'flex flex-col flex-1 min-w-0 bg-surface-primary/50 rounded-xl border transition-colors',
      isDragOver ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-edge-subtle'
    ]"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-edge-subtle">
      <div class="flex items-center gap-2">
        <div :class="['w-2 h-2 rounded-full', accentClass]"></div>
        <span class="text-xs font-semibold text-content-tertiary uppercase tracking-wider">{{ title }}</span>
      </div>
      <span class="text-xs text-content-subtle bg-surface-secondary px-1.5 py-0.5 rounded">{{ tasks.length }}</span>
    </div>
    <div class="flex-1 overflow-y-auto p-2 space-y-2 min-h-0" style="contain: content;">
      <TaskCard v-for="task in tasks" :key="task.id" :task="task" />
      <div v-if="tasks.length === 0" class="text-xs text-content-faint text-center py-8">{{ t('statusColumn.noTasks') }}</div>
    </div>
  </div>
</template>
