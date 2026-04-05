<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseUtcDate } from '@renderer/utils/parseDate'

interface GitCommit {
  hash: string
  date: string
  subject: string
  author: string
  taskIds: number[]
}

const props = defineProps<{
  commits: GitCommit[]
  /** When set, only show commits mentioning this task id */
  filterTaskId?: number
}>()

const emit = defineEmits<{
  openTask: [id: number]
}>()

const { locale } = useI18n()

const visibleCommits = computed(() => {
  if (props.filterTaskId == null) return props.commits
  return props.commits.filter(c => c.taskIds.includes(props.filterTaskId!))
})

function formatDate(iso: string): string {
  const d = parseUtcDate(iso)
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' })
}
</script>

<template>
  <div class="commit-list">
    <div
      v-for="commit in visibleCommits"
      :key="commit.hash"
      class="commit-row"
    >
      <!-- Hash -->
      <code class="commit-hash">{{ commit.hash.slice(0, 7) }}</code>

      <!-- Subject + author -->
      <div class="commit-body">
        <p class="commit-subject text-caption">{{ commit.subject }}</p>
        <p class="commit-meta">
          <span>{{ commit.author }}</span>
          <span class="commit-sep">·</span>
          <span>{{ formatDate(commit.date) }}</span>
        </p>
      </div>

      <!-- Task badges -->
      <div class="commit-badges">
        <v-btn
          v-for="id in commit.taskIds"
          :key="id"
          variant="text"
          size="x-small"
          density="compact"
          class="commit-task-badge"
          @click="emit('openTask', id)"
        >T{{ id }}</v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commit-list { overflow-y: auto; }
.commit-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-surface-tertiary), 0.5);
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
}
.commit-row:last-child { border-bottom: none; }
.commit-row:hover { background: rgba(var(--v-theme-surface-tertiary), 0.3); }
.commit-hash {
  font-size: 10px;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  width: 56px;
  flex-shrink: 0;
  margin-top: 2px;
  user-select: all;
}
.commit-body {
  flex: 1;
  min-width: 0;
}
.commit-subject {
  color: var(--content-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}
.commit-meta {
  font-size: 10px;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  margin: 2px 0 0;
}
.commit-sep { margin: 0 4px; opacity: 0.5; }
.commit-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
}
.commit-task-badge {
  font-size: 10px !important;
  font-family: ui-monospace, monospace !important;
  background: rgba(var(--v-theme-primary), 0.2) !important;
  color: rgb(var(--v-theme-primary)) !important;
  border: 1px solid rgba(var(--v-theme-primary), 0.3) !important;
  border-radius: 4px !important;
}
.commit-task-badge:hover { background: rgba(var(--v-theme-primary), 0.3) !important; }
</style>
