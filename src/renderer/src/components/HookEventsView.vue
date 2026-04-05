<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHookEventsStore, type HookEvent } from '@renderer/stores/hookEvents'

const { t } = useI18n()
import { EVENT_ICON, eventIcon, toolColor, eventColor, toolName } from '@renderer/composables/useHookEventDisplay'
import HookEventPayloadModal from './HookEventPayloadModal.vue'

const store = useHookEventsStore()

const filterTypes = ref<string[]>([])
const selectedEvent = ref<HookEvent | null>(null)

const ALL_TYPES = Object.keys(EVENT_ICON)

// Iterate backwards — newest first, early exit at 200 items (T792)
// Avoids .slice().reverse() O(N) on 2000 events on every hook event
const MAX_DISPLAY = 200
const filtered = computed(() => {
  const types = filterTypes.value
  const evts = store.events
  const result: HookEvent[] = []
  for (let i = evts.length - 1; i >= 0 && result.length < MAX_DISPLAY; i--) {
    const e = evts[i]
    if (!types.length || types.includes(e.event)) result.push(e)
  }
  return result
})

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}

</script>

<template>
  <div class="he-view">
    <!-- Header -->
    <div class="he-header">
      <h2 class="he-title text-h6 font-weight-medium">{{ t('sidebar.hooks') }}</h2>
    </div>
    <!-- Filters bar -->
    <div class="he-filters">
      <span class="he-filter-label text-overline text-medium-emphasis">{{ t('hooks.filters') }}</span>
      <v-chip-group v-model="filterTypes" multiple column>
        <v-chip
          v-for="eventType in ALL_TYPES"
          :key="eventType"
          :value="eventType"
          filter
          size="small"
          color="primary"
          class="he-chip-item"
        >{{ EVENT_ICON[eventType] }} {{ eventType }}</v-chip>
      </v-chip-group>
      <div class="he-spacer" />
      <span class="he-count">{{ filtered.length }} event{{ filtered.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Event list -->
    <div class="he-list">
      <div v-if="filtered.length === 0" class="he-empty text-caption">{{ t('hooks.noEvents') }}</div>
      <div
        v-for="e in filtered"
        :key="e.id"
        class="he-event"
        @click="selectedEvent = e"
      >
        <span class="he-event-icon">{{ eventIcon(e.event) }}</span>
        <span
          class="he-event-type"
          :style="{ color: ['PreToolUse','PostToolUse','PostToolUseFailure'].includes(e.event)
            ? toolColor(toolName(e.payload))
            : eventColor(e.event) }"
        >
          {{ ['PreToolUse','PostToolUse','PostToolUseFailure'].includes(e.event) ? toolName(e.payload) : e.event }}
        </span>
        <span class="he-session-id">{{ e.sessionId ? e.sessionId.slice(0, 8) : '—' }}</span>
        <span class="he-time">{{ relativeTime(e.ts) }}</span>
      </div>
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
.he-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-base);
}
.he-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}
.he-title { color: var(--content-primary); margin: 0; }

.he-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--edge-default);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.he-filter-label {
  color: var(--content-muted);
  margin-right: 4px;
}
.he-chip-item :deep(.v-chip__content) {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.he-spacer { flex: 1; }
.he-count {
  font-size: 11px;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.he-list { flex: 1; overflow-y: auto; padding: 8px 24px; display: flex; flex-direction: column; gap: 2px; }
.he-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--content-faint);
  font-style: italic;
}
.he-event {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.he-event:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }
.he-event-icon {
  font-size: 11px;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}
.he-event-type { font-size: 11px; font-family: ui-monospace, monospace; flex-shrink: 0; }
.he-session-id {
  font-size: 10px;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.he-time {
  font-size: 10px;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
