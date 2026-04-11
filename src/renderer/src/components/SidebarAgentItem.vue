<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentAccent } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const props = defineProps<{
  agent: Agent
  isSelected: boolean
  depth?: number
}>()

const emit = defineEmits<{
  select: []
  edit: []
  launch: [event: MouseEvent]
  dragstart: [event: DragEvent]
  contextmenu: [event: MouseEvent]
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()

const isActive = computed(() => tabsStore.isAgentActive(props.agent.name))
const hasOpenTerminal = computed(() =>
  tabsStore.tabs.some(tab => tab.type === 'terminal' && tab.agentName === props.agent.name)
)
const accentColor = computed(() => agentAccent(props.agent.name))
const fgColor = computed(() => agentFg(props.agent.name))
const bgColor = computed(() => agentBg(props.agent.name))
</script>

<template>
  <div
    class="agent-item"
    :style="depth !== undefined ? { paddingLeft: `${depth * 12 + 8}px` } : undefined"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <v-list-item
      density="compact"
      rounded="lg"
      class="px-1"
      :active="isSelected"
      active-color="secondary-container"
      @click="emit('select')"
    >
      <div class="agent-row">
        <span class="agent-status">
          <v-progress-circular
            v-show="isActive"
            indeterminate
            :size="12"
            :width="2"
            :style="{ color: accentColor }"
            class="status-spinner"
          />
          <v-icon
            v-show="hasOpenTerminal && !isActive"
            size="12"
            :style="{ color: accentColor }"
          >mdi-circle-medium</v-icon>
          <span
            v-show="!isActive && !hasOpenTerminal"
            class="status-dot"
            :style="{ backgroundColor: accentColor }"
          />
        </span>
        <span class="agent-name" :class="{ 'agent-name--active': isSelected }">{{ agent.name }}</span>
        <div class="agent-actions">
          <span class="drag-handle" :title="t('sidebar.move')"><v-icon size="12">mdi-drag</v-icon></span>
          <v-btn
            variant="text"
            density="compact"
            size="x-small"
            class="action-btn"
            :title="t('sidebar.editAgent')"
            @click.stop="emit('edit')"
          ><v-icon size="12">mdi-pencil</v-icon></v-btn>
          <v-btn
            variant="text"
            density="compact"
            size="x-small"
            class="action-btn action-btn--launch"
            :style="{ color: fgColor, backgroundColor: bgColor }"
            :title="t('sidebar.launchAgent', { name: agent.name })"
            @click.stop="emit('launch', $event)"
          ><v-icon size="12">mdi-play</v-icon></v-btn>
        </div>
      </div>
    </v-list-item>
  </div>
</template>

<style scoped>
.agent-item {
  margin-bottom: 1px;
}

.agent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

/* Fixed-width status indicator — shows exactly one of spinner / icon / dot */
.agent-status {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  opacity: 0.6;
}

.agent-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.87);
  transition: color var(--md-duration-short3, 100ms) var(--md-easing-standard, ease);
}
.agent-name--active {
  color: rgb(var(--v-theme-on-secondary-container));
  font-weight: 500;
}

/* Agent action buttons — fade in on row hover */
.agent-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--md-duration-short3, 100ms) var(--md-easing-standard, ease);
}
.agent-item:hover .agent-actions {
  opacity: 1;
}

.drag-handle {
  display: flex;
  align-items: center;
  color: var(--content-dim);
  cursor: grab;
  padding: 2px;
}

.action-btn {
  width: 20px !important;
  min-width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  padding: 0 !important;
  color: var(--content-dim) !important;
}
.action-btn--launch {
  border-radius: 4px !important;
}
</style>
