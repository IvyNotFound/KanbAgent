<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHookEventsStore, type HookEvent } from '@renderer/stores/hookEvents'

const { t } = useI18n()
import HookEventPayloadModal from './HookEventPayloadModal.vue'
import { eventIcon, toolColor, eventColor, toolName } from '@renderer/composables/useHookEventDisplay'

const props = defineProps<{
  /** Claude session UUID — used to filter hook events for this stream. */
  sessionId: string | null
}>()

const store = useHookEventsStore()

const expanded = ref(false)
const selectedEvent = ref<HookEvent | null>(null)

// Use memoized store computed — one shared computed per sessionId across all mounted instances (T963)
const events = store.eventsForSession(props.sessionId)
// Pre-reversed in a computed — avoids spread+reverse allocation on every template render (T793)
const reversedEvents = computed(() => {
  const evts = events.value
  const result: HookEvent[] = []
  for (let i = evts.length - 1; i >= 0; i--) result.push(evts[i])
  return result
})
const activeTool = computed(() => {
  const key = props.sessionId ?? '__global__'
  return store.activeTools[key] ?? null
})

function rowColor(e: HookEvent): string {
  if (e.event === 'PreToolUse' || e.event === 'PostToolUse' || e.event === 'PostToolUseFailure') {
    return toolColor(toolName(e.payload))
  }
  return eventColor(e.event)
}

function rowLabel(e: HookEvent): string {
  if (e.event === 'PreToolUse' || e.event === 'PostToolUse' || e.event === 'PostToolUseFailure') {
    return toolName(e.payload)
  }
  return e.event
}
</script>

<template>
  <!-- Only render if there are events or an active tool -->
  <!-- shrink-0 kept as class name for test selector compatibility -->
  <div v-if="events.length > 0 || activeTool" class="hook-bar shrink-0">
    <!-- Header bar: active tool indicator + toggle -->
    <!-- cursor-pointer kept as class name for test selector compatibility -->
    <div
      class="hook-header cursor-pointer ga-2"
      @click="expanded = !expanded"
    >
      <!-- Active tool spinner -->
      <div v-if="activeTool" class="active-tool">
        <v-progress-circular class="spinner" indeterminate :size="16" :width="2" />
        <span class="tool-name-active" :style="{ color: toolColor(activeTool) }">{{ activeTool }}</span>
        <span class="tool-in-progress text-label-medium">{{ t('hooks.inProgress') }}</span>
      </div>
      <!-- Idle: last event summary -->
      <div v-else-if="events.length > 0" class="event-count">
        <span class="event-count-text">{{ events.length }} event{{ events.length > 1 ? 's' : '' }}</span>
      </div>

      <!-- Spacer -->
      <div class="header-spacer" />

      <!-- Expand/collapse toggle -->
      <v-btn
        variant="text"
        size="x-small"
        density="compact"
        :icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      />
    </div>

    <!-- Expanded event list — max-h-36 kept for test selector compatibility -->
    <div v-if="expanded" class="event-list max-h-36">
      <div
        v-for="e in reversedEvents"
        :key="e.id"
        class="event-row"
        @click.stop="selectedEvent = e"
      >
        <span class="event-icon">{{ eventIcon(e.event) }}</span>
        <span class="event-label" :style="{ color: rowColor(e) }">{{ rowLabel(e) }}</span>
        <span class="event-time">
          {{ new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}
        </span>
      </div>
      <div v-if="events.length === 0" class="no-events py-1 text-label-medium">{{ t('hooks.noEvents') }}</div>
    </div>
  </div>

  <!-- Payload modal -->
  <Teleport to="body">
    <HookEventPayloadModal
      v-if="selectedEvent"
      :event="selectedEvent"
      @close="selectedEvent = null"
    />
  </Teleport>
</template>

<style scoped>
/* Utility classes kept for test selector compatibility */
.shrink-0  { flex-shrink: 0; }
.cursor-pointer { cursor: pointer; }
/* max-h-36 used as identifier in tests */
.max-h-36 {
  max-height: 9rem;
  overflow-y: auto;
}

.hook-bar {
  border-top: 1px solid var(--edge-subtle);
  background-color: var(--surface-primary);
  backdrop-filter: blur(4px);
}

.hook-header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  user-select: none;
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
}
.hook-header:hover {
  background-color: var(--surface-secondary);
}

.active-tool {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spinner {
  color: rgb(var(--v-theme-warning));
  flex-shrink: 0;
}

.tool-name-active {
  font-size: 0.75rem;
  font-weight: 600;
}

.tool-in-progress {
  color: var(--content-faint);
}

.event-count-text {
  font-size: 0.6875rem;
  color: var(--content-faint);
}

.header-spacer { flex: 1; }


.event-list {
  border-top: 1px solid rgba(var(--edge-subtle-rgb, 39 39 42), 0.5);
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.event-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--shape-xs);
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
}
.event-row:hover {
  background-color: var(--surface-secondary);
}

.event-icon {
  font-size: 0.6875rem;
  color: var(--content-faint);
  flex-shrink: 0;
}

.event-label {
  font-size: 0.6875rem;
  flex-shrink: 0;
}

.event-time {
  font-size: 0.6875rem;
  color: var(--content-faint);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.no-events {
  color: var(--content-faint);
  font-style: italic;
}
</style>
