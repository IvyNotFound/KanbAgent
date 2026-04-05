<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import TaskCard from './TaskCard.vue'

const props = defineProps<{
  title: string
  statut: string
  tasks: Task[]
  accentColor: string
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
    :class="['column-wrap', { 'drag-over': isDragOver }]"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="column-header">
      <div class="column-title-row ga-2">
        <div class="column-accent" :style="{ backgroundColor: accentColor }"></div>
        <span class="column-title text-caption">{{ title }}</span>
      </div>
      <span class="column-count text-caption">{{ tasks.length }}</span>
    </div>
    <div class="column-body pa-2 ga-2" style="contain: content;">
      <TaskCard v-for="task in tasks" :key="task.id" :task="task" />
      <div v-if="tasks.length === 0" class="column-empty py-8 text-caption">{{ t('statusColumn.noTasks') }}</div>
    </div>
  </div>
</template>

<style scoped>
.column-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background-color: color-mix(in srgb, var(--surface-primary) 50%, transparent);
  border-radius: 12px;
  border: 1px solid var(--edge-subtle);
  transition: border-color var(--md-duration-short3) var(--md-easing-standard), background-color var(--md-duration-short3) var(--md-easing-standard);
}
.column-wrap.drag-over {
  border-color: rgba(var(--v-theme-secondary), 0.6);
  background-color: rgba(var(--v-theme-secondary), 0.05);
}
.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.column-title-row {
  display: flex;
  align-items: center;
}
.column-accent {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.column-title {
  font-weight: 600;
  color: var(--content-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.column-count {
  color: var(--content-subtle);
  background-color: var(--surface-secondary);
  padding: 2px 6px;
  border-radius: 4px;
}
.column-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.column-empty {
  color: var(--content-faint);
  text-align: center;
}
</style>
