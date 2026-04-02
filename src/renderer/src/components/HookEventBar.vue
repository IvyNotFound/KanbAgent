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
      class="hook-header cursor-pointer"
      @click="expanded = !expanded"
    >
      <!-- Active tool spinner -->
      <div v-if="activeTool" class="active-tool">
        <v-progress-circular class="spinner" indeterminate :size="16" :width="2" />
        <span class="tool-name-active" :class="toolColor(activeTool)">{{ activeTool }}</span>
        <span class="tool-in-progress">{{ t('hooks.inProgress') }}</span>
      </div>
      <!-- Idle: last event summary -->
      <div v-else-if="events.length > 0" class="event-count">
        <span class="event-count-text">{{ events.length }} event{{ events.length > 1 ? 's' : '' }}</span>
      </div>

      <!-- Spacer -->
      <div class="header-spacer" />

      <!-- Expand/collapse toggle -->
      <button class="toggle-btn">
        {{ expanded ? '▲' : '▼' }}
      </button>
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
        <span class="event-label" :class="rowColor(e)">{{ rowLabel(e) }}</span>
        <span class="event-time">
          {{ new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}
        </span>
      </div>
      <div v-if="events.length === 0" class="no-events">{{ t('hooks.noEvents') }}</div>
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
  background-color: rgba(var(--surface-primary-rgb, 24 24 27), 0.8);
  backdrop-filter: blur(4px);
}

.hook-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  user-select: none;
  transition: background-color 0.15s;
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
  width: 0.75rem;
  height: 0.75rem;
  animation: spin 1s linear infinite;
  color: #fbbf24;
  flex-shrink: 0;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.spinner-track { opacity: 0.25; }
.spinner-arc   { opacity: 0.75; }

.tool-name-active {
  font-size: 0.6875rem;
  font-family: ui-monospace, monospace;
  font-weight: 600;
}

.tool-in-progress {
  font-size: 0.625rem;
  color: var(--content-faint);
}

.event-count-text {
  font-size: 0.625rem;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
}

.header-spacer { flex: 1; }

.toggle-btn {
  font-size: 0.625rem;
  color: var(--content-subtle);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
  font-family: ui-monospace, monospace;
}
.toggle-btn:hover {
  color: var(--content-muted);
}

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
  border-radius: 4px;
  transition: background-color 0.15s;
}
.event-row:hover {
  background-color: var(--surface-secondary);
}

.event-icon {
  font-size: 0.625rem;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}

.event-label {
  font-size: 0.625rem;
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}

.event-time {
  font-size: 0.625rem;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.no-events {
  font-size: 0.625rem;
  color: var(--content-faint);
  font-style: italic;
  padding: 4px 0;
}
</style>
