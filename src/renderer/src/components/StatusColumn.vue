<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@renderer/types'
import TaskCard from './TaskCard.vue'
import TaskTreeNode from './TaskTreeNode.vue'
import { buildTree } from '@renderer/utils/taskTree'

const props = defineProps<{
  title: string
  statut: string
  tasks: Task[]
  accentColor: string
  /** Whether the tree view is active. Controlled externally so all columns share the same mode. */
  treeMode?: boolean
}>()

const emit = defineEmits<{
  (e: 'task-dropped', taskId: number): void
}>()

const { t } = useI18n()

const isDragOver = ref(false)
const isDropTarget = computed(() => props.statut === 'in_progress')

const treeRoots = computed(() => props.treeMode ? buildTree(props.tasks) : [])

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
      <div class="column-title-row">
        <div class="column-accent" :style="{ backgroundColor: accentColor }"></div>
        <span class="column-title">{{ title }}</span>
      </div>
      <span class="column-count">{{ tasks.length }}</span>
    </div>
    <!-- List mode -->
    <div v-if="!treeMode" class="column-body" style="contain: content;">
      <TaskCard v-for="task in tasks" :key="task.id" :task="task" />
      <div v-if="tasks.length === 0" class="column-empty">{{ t('statusColumn.noTasks') }}</div>
    </div>
    <!-- Tree mode -->
    <div v-else class="column-body-tree" style="contain: content;">
      <TaskTreeNode v-for="root in treeRoots" :key="root.id" :node="root" />
      <div v-if="treeRoots.length === 0" class="column-empty">{{ t('statusColumn.noTasks') }}</div>
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
  transition: border-color 150ms, background-color 150ms;
}
.column-wrap.drag-over {
  border-color: rgba(16, 185, 129, 0.6);
  background-color: rgba(16, 185, 129, 0.05);
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
  gap: 8px;
}
.column-accent {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.column-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--content-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.column-count {
  font-size: 0.75rem;
  color: var(--content-subtle);
  background-color: var(--surface-secondary);
  padding: 2px 6px;
  border-radius: 4px;
}
.column-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.column-body-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.column-empty {
  font-size: 0.75rem;
  color: var(--content-faint);
  text-align: center;
  padding: 32px 0;
}
</style>
