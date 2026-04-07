<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TaskLink } from '@renderer/types'

const { t } = useI18n()

const props = defineProps<{
  taskId: number
  links: TaskLink[]
}>()

const emit = defineEmits<{
  (e: 'navigate', taskId: number): void
}>()

const STATUS_STYLE: Record<string, { color: string; background: string; border: string }> = {
  todo:        { color: 'rgb(var(--v-theme-warning))',   background: 'rgba(var(--v-theme-warning),0.12)',   border: 'rgba(var(--v-theme-warning),0.3)' },
  in_progress: { color: 'rgb(var(--v-theme-secondary))', background: 'rgba(var(--v-theme-secondary),0.12)', border: 'rgba(var(--v-theme-secondary),0.3)' },
  done:        { color: 'rgb(var(--v-theme-content-muted))', background: 'rgba(var(--v-theme-content-subtle),0.12)', border: 'rgba(var(--v-theme-content-subtle),0.3)' },
  archived:    { color: 'rgb(var(--v-theme-content-subtle))', background: 'rgba(var(--v-theme-content-faint),0.12)', border: 'rgba(var(--v-theme-content-faint),0.3)' },
}

const fallbackStatus = STATUS_STYLE.todo

/** Tasks this task blocks or that this task depends on (outgoing) */
const outgoing = computed(() =>
  props.links.filter(l =>
    (l.type === 'blocks' && l.from_task === props.taskId) ||
    (l.type === 'depends_on' && l.to_task === props.taskId)
  )
)

/** Tasks that block this task or that this task depends on (incoming) */
const incoming = computed(() =>
  props.links.filter(l =>
    (l.type === 'blocks' && l.to_task === props.taskId) ||
    (l.type === 'depends_on' && l.from_task === props.taskId)
  )
)

/** Symmetric links: related_to, duplicates */
const related = computed(() =>
  props.links.filter(l =>
    (l.type === 'related_to' || l.type === 'duplicates') &&
    (l.from_task === props.taskId || l.to_task === props.taskId)
  )
)

const hasLinks = computed(() =>
  outgoing.value.length > 0 || incoming.value.length > 0 || related.value.length > 0
)

function linkedTaskId(link: TaskLink): number {
  return link.from_task === props.taskId ? link.to_task : link.from_task
}

function linkedTaskTitle(link: TaskLink): string {
  return link.from_task === props.taskId ? link.to_title : link.from_title
}

function linkedTaskStatus(link: TaskLink): string {
  return link.from_task === props.taskId ? link.to_status : link.from_status
}

</script>

<template>
  <div class="dep-graph">
    <!-- No links -->
    <p v-if="!hasLinks" class="no-links">
      {{ t('taskDetail.noDependencies') }}
    </p>

    <template v-else>
      <!-- Outgoing: this task blocks or depends on -->
      <div v-if="outgoing.length > 0" class="dep-section">
        <p class="dep-section-label text-label-medium">{{ t('taskDetail.blocks') }}</p>
        <div class="dep-list">
          <button
            v-for="link in outgoing"
            :key="link.id"
            type="button"
            class="dep-row"
            @click="emit('navigate', linkedTaskId(link))"
          >
            <span
              class="dep-status-dot"
              :style="{ backgroundColor: (STATUS_STYLE[linkedTaskStatus(link)] ?? fallbackStatus).color }"
              :title="linkedTaskStatus(link)"
            ></span>
            <span class="dep-id">#{{ linkedTaskId(link) }}</span>
            <span class="dep-title">{{ linkedTaskTitle(link) }}</span>
          </button>
        </div>
      </div>

      <!-- Incoming: blocked by or depended upon by -->
      <div v-if="incoming.length > 0" class="dep-section">
        <p class="dep-section-label text-label-medium">{{ t('taskDetail.blockedBy') }}</p>
        <div class="dep-list">
          <button
            v-for="link in incoming"
            :key="link.id"
            type="button"
            class="dep-row"
            @click="emit('navigate', linkedTaskId(link))"
          >
            <span
              class="dep-status-dot"
              :style="{ backgroundColor: (STATUS_STYLE[linkedTaskStatus(link)] ?? fallbackStatus).color }"
              :title="linkedTaskStatus(link)"
            ></span>
            <span class="dep-id">#{{ linkedTaskId(link) }}</span>
            <span class="dep-title">{{ linkedTaskTitle(link) }}</span>
          </button>
        </div>
      </div>

      <!-- Related: related_to, duplicates -->
      <div v-if="related.length > 0" class="dep-section">
        <p class="dep-section-label text-label-medium">{{ t('taskDetail.relatedTo') }}</p>
        <div class="dep-list">
          <button
            v-for="link in related"
            :key="link.id"
            type="button"
            class="dep-row"
            @click="emit('navigate', linkedTaskId(link))"
          >
            <span
              class="dep-status-dot"
              :style="{ backgroundColor: (STATUS_STYLE[linkedTaskStatus(link)] ?? fallbackStatus).color }"
              :title="linkedTaskStatus(link)"
            ></span>
            <span class="dep-id">#{{ linkedTaskId(link) }}</span>
            <span class="dep-title">{{ linkedTaskTitle(link) }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dep-graph {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.no-links {
  color: var(--content-faint);
  font-style: italic;
  font-size: 0.8125rem;
  margin: 0;
}

.dep-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dep-section-label {
  color: var(--content-muted);
  margin: 0 0 4px;
}

.dep-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Native button replaces v-btn block — gives full control over text wrapping */
.dep-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
  color: inherit;
}

/* MD3 state layer on hover */
.dep-row:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
}

.dep-row:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.4);
  outline-offset: 1px;
}

.dep-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  /* align dot to center of first text line (0.8125rem * 1.5 line-height ≈ 18px → center at ~9px → top ~5px) */
  margin-top: 5px;
}

.dep-id {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--content-muted);
  flex-shrink: 0;
  min-width: 32px;
  text-align: right;
  line-height: 1.5;
}

.dep-title {
  font-size: 0.8125rem; /* body-small MD3 — was 0.6875rem (text-caption) */
  color: var(--content-secondary);
  min-width: 0; /* critical: allows flex child to shrink below content width */
  overflow-wrap: break-word;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.5;
  text-align: left;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}

.dep-row:hover .dep-title {
  color: var(--content-primary);
}
</style>
