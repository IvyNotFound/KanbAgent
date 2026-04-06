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
    <p v-if="!hasLinks" class="no-links text-caption">
      {{ t('taskDetail.noDependencies') }}
    </p>

    <template v-else>
      <!-- Outgoing: this task blocks or depends on -->
      <div v-if="outgoing.length > 0" class="dep-section">
        <p class="dep-section-label text-label-medium">{{ t('taskDetail.blocks') }}</p>
        <div class="dep-list">
          <v-btn
            v-for="link in outgoing"
            :key="link.id"
            variant="text"
            block
            class="dep-row"
            @click="emit('navigate', linkedTaskId(link))"
          >
            <span
              class="dep-status-dot"
              :style="{ backgroundColor: (STATUS_STYLE[linkedTaskStatus(link)] ?? fallbackStatus).color }"
              :title="linkedTaskStatus(link)"
            ></span>
            <span class="dep-id">#{{ linkedTaskId(link) }}</span>
            <span class="dep-title text-caption">{{ linkedTaskTitle(link) }}</span>
          </v-btn>
        </div>
      </div>

      <!-- Incoming: blocked by or depended upon by -->
      <div v-if="incoming.length > 0" class="dep-section">
        <p class="dep-section-label text-label-medium">{{ t('taskDetail.blockedBy') }}</p>
        <div class="dep-list">
          <v-btn
            v-for="link in incoming"
            :key="link.id"
            variant="text"
            block
            class="dep-row"
            @click="emit('navigate', linkedTaskId(link))"
          >
            <span
              class="dep-status-dot"
              :style="{ backgroundColor: (STATUS_STYLE[linkedTaskStatus(link)] ?? fallbackStatus).color }"
              :title="linkedTaskStatus(link)"
            ></span>
            <span class="dep-id">#{{ linkedTaskId(link) }}</span>
            <span class="dep-title text-caption">{{ linkedTaskTitle(link) }}</span>
          </v-btn>
        </div>
      </div>

      <!-- Related: related_to, duplicates -->
      <div v-if="related.length > 0" class="dep-section">
        <p class="dep-section-label text-label-medium">{{ t('taskDetail.relatedTo') }}</p>
        <div class="dep-list">
          <v-btn
            v-for="link in related"
            :key="link.id"
            variant="text"
            block
            class="dep-row"
            @click="emit('navigate', linkedTaskId(link))"
          >
            <span
              class="dep-status-dot"
              :style="{ backgroundColor: (STATUS_STYLE[linkedTaskStatus(link)] ?? fallbackStatus).color }"
              :title="linkedTaskStatus(link)"
            ></span>
            <span class="dep-id">#{{ linkedTaskId(link) }}</span>
            <span class="dep-title text-caption">{{ linkedTaskTitle(link) }}</span>
          </v-btn>
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
  margin: 0;
}

.dep-section {
  margin-bottom: 8px;
  min-height: 48px;
}

.dep-section-label {
  color: var(--content-muted);
  margin: 0 0 8px;
}

.dep-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dep-row {
  gap: 8px !important;
  text-align: left !important;
  justify-content: flex-start !important;
  height: auto !important;
  min-height: 36px !important;
  padding: 6px 10px !important;
}

.dep-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dep-id {
  font-family: ui-monospace, monospace;
  font-size: 0.6875rem;
  color: var(--content-muted);
  flex-shrink: 0;
  min-width: 36px;
  text-align: right;
}

.dep-title {
  color: var(--content-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}
.dep-row:hover .dep-title {
  color: var(--content-primary);
}
</style>
