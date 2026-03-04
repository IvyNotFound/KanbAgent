<script setup lang="ts">
import { ref, computed } from 'vue'
import { useHookEventsStore, type HookEvent } from '@renderer/stores/hookEvents'
import HookEventPayloadModal from './HookEventPayloadModal.vue'
import { eventIcon, toolColor, eventColor, toolName } from '@renderer/composables/useHookEventDisplay'

const props = defineProps<{
  /** Claude session UUID — used to filter hook events for this stream. */
  sessionId: string | null
}>()

const store = useHookEventsStore()

const expanded = ref(false)
const selectedEvent = ref<HookEvent | null>(null)

// Access state directly (not actions) so createTestingPinia doesn't stub these
const events = computed(() => store.events.filter(e => e.sessionId === props.sessionId))
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
  <div v-if="events.length > 0 || activeTool" class="shrink-0 border-t border-edge-subtle bg-surface-primary/80 backdrop-blur-sm">
    <!-- Header bar: active tool indicator + toggle -->
    <div
      class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-surface-secondary/40 transition-colors"
      @click="expanded = !expanded"
    >
      <!-- Active tool spinner -->
      <div v-if="activeTool" class="flex items-center gap-1.5">
        <svg class="w-3 h-3 animate-spin text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
        </svg>
        <span :class="['text-[11px] font-mono font-semibold', toolColor(activeTool)]">{{ activeTool }}</span>
        <span class="text-[10px] text-content-faint">en cours…</span>
      </div>
      <!-- Idle: last event summary -->
      <div v-else-if="events.length > 0" class="flex items-center gap-1.5">
        <span class="text-[10px] text-content-faint font-mono">{{ events.length }} event{{ events.length > 1 ? 's' : '' }}</span>
      </div>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Expand/collapse toggle -->
      <button class="text-[10px] text-content-subtle hover:text-content-tertiary transition-colors font-mono">
        {{ expanded ? '▲' : '▼' }}
      </button>
    </div>

    <!-- Expanded event list -->
    <div v-if="expanded" class="max-h-36 overflow-y-auto border-t border-edge-subtle/50 px-3 py-1.5 space-y-0.5">
      <div
        v-for="e in [...events].reverse()"
        :key="e.id"
        class="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-surface-secondary/40 rounded px-1 -mx-1 transition-colors"
        @click.stop="selectedEvent = e"
      >
        <span class="text-[10px] text-content-faint font-mono shrink-0">{{ eventIcon(e.event) }}</span>
        <span class="text-[10px] font-mono shrink-0" :class="rowColor(e)">{{ rowLabel(e) }}</span>
        <span class="text-[10px] text-content-faint font-mono ml-auto tabular-nums shrink-0">
          {{ new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}
        </span>
      </div>
      <div v-if="events.length === 0" class="text-[10px] text-content-faint italic py-1">Aucun événement</div>
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
