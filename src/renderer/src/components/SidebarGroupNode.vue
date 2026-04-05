<script setup lang="ts">
/**
 * SidebarGroupNode — recursive component rendering one agent group and its children.
 *
 * Injects shared state from SidebarAgentSection (via provide/inject):
 *  - sidebarGroupsKey: rename/delete/subgroup creation state
 *  - sidebarDragDropKey: drag-and-drop state
 *  - 'openLaunchModal': callback to open the launch session modal
 *  - 'openContextMenu': callback to open the agent context menu
 *  - 'openEditAgent': callback to open the edit agent modal
 *
 * Uses defineOptions({ name: 'SidebarGroupNode' }) for recursive self-reference.
 */
import { ref, computed, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentAccent } from '@renderer/utils/agentColor'
import { sidebarGroupsKey } from '@renderer/composables/useSidebarGroups'
import { sidebarDragDropKey } from '@renderer/composables/useSidebarDragDrop'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import type { AgentGroup, Agent } from '@renderer/types'

defineOptions({ name: 'SidebarGroupNode' })

const props = withDefaults(defineProps<{
  group: AgentGroup
  level: number
}>(), { level: 0 })

const { t } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

// Destructure injected state so Vue auto-unwraps refs in the template
const {
  renamingGroupId,
  renameGroupName,
  confirmRename,
  cancelRename,
  startRename,
  handleDeleteGroup,
  creatingSubgroupForId,
  newSubgroupName,
  startCreateSubgroup,
  confirmCreateSubgroup,
  cancelCreateSubgroup,
} = inject(sidebarGroupsKey)!

const {
  dragOverGroupId,
  onAgentDragStart,
  onGroupDragStart,
  onGroupDragOver,
  onGroupDragLeave,
  onGroupDrop,
} = inject(sidebarDragDropKey)!

const openLaunchModal = inject<(event: MouseEvent, agent: Agent) => void>('openLaunchModal')!
const openContextMenu = inject<(event: MouseEvent, agent: Agent) => void>('openContextMenu')!
const openEditAgent = inject<(agent: Agent) => void>('openEditAgent')!

// ── Local state ───────────────────────────────────────────────────────────────
const collapsedKey = `sidebar-group-${props.group.id}`
const collapsed = ref(localStorage.getItem(collapsedKey) === 'true')
watch(collapsed, (val) => localStorage.setItem(collapsedKey, String(val)))

const groupContextMenu = ref<{ x: number; y: number } | null>(null)

// ── Computed ──────────────────────────────────────────────────────────────────
/** Agents that belong to this group, sorted by their sort_order within the group. */
const groupAgents = computed<Agent[]>(() => {
  return [...(props.group.members ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(m => store.agents.find(a => a.id === m.agent_id))
    .filter(Boolean) as Agent[]
})

/** Left padding as inline style — supports unlimited nesting depth (12px per level). */
const indentStyle = computed(() => ({ paddingLeft: `${props.level * 12}px` }))

/** Child content indent: group header indent + 8px (pl-2 equivalent). */
const childContentStyle = computed(() => ({ paddingLeft: `${props.level * 12 + 8}px` }))

/** Subgroup creation input indent: group header indent + 12px (pl-3 equivalent). */
const subgroupInputStyle = computed(() => ({ paddingLeft: `${props.level * 12 + 12}px` }))

/** Guide line left position: aligns with the parent group's chevron icon center. */
const guideLineStyle = computed(() => ({ left: `${(props.level - 1) * 12 + 8}px` }))

function isAgentSelected(id: number): boolean {
  return store.selectedAgentId !== null && Number(store.selectedAgentId) === id
}

function hasOpenTerminal(agentName: string): boolean {
  return tabsStore.tabs.some(tab => tab.type === 'terminal' && tab.agentName === agentName)
}

// ── Group context menu ────────────────────────────────────────────────────────
function openGroupContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  groupContextMenu.value = { x: event.clientX, y: event.clientY }
}

const groupContextMenuItems = computed<ContextMenuItem[]>(() => [
  { label: t('sidebar.renameGroup'), action: () => startRename(props.group) },
  { label: t('sidebar.addSubgroup'), action: () => startCreateSubgroup(props.group.id) },
  { separator: true, label: '', action: () => {} },
  { label: t('sidebar.deleteGroup'), action: () => handleDeleteGroup(props.group.id) },
])
</script>

<template>
  <div
    class="group-node mb-1"
    @dragover="onGroupDragOver($event, group.id)"
    @dragleave="onGroupDragLeave"
    @drop="onGroupDrop($event, group.id)"
  >
    <!-- Vertical hierarchy guide line (non-root groups only) -->
    <div
      v-if="level > 0"
      class="guide-line"
      :style="guideLineStyle"
    />

    <!-- Group header -->
    <div
      :style="indentStyle"
      :class="['group-header', 'px-1', { 'drag-target': dragOverGroupId === group.id }]"
      draggable="true"
      @dragstart="onGroupDragStart($event, group)"
      @contextmenu.prevent="openGroupContextMenu"
    >
      <!-- Collapse/expand toggle -->
      <v-btn variant="text" density="compact" size="x-small" class="collapse-btn" @click.stop="collapsed = !collapsed">
        <v-icon class="chevron-icon" size="14" :style="collapsed ? { transform: 'rotate(-90deg)' } : {}">mdi-chevron-down</v-icon>
      </v-btn>

      <!-- Rename input (MD3 v-text-field) or group name -->
      <template v-if="renamingGroupId === group.id">
        <v-text-field
          v-model="renameGroupName"
          density="compact"
          variant="outlined"
          hide-details
          autofocus
          class="rename-input"
          @keydown.enter="confirmRename(group.id)"
          @keydown.esc="cancelRename"
          @blur="confirmRename(group.id)"
        />
      </template>
      <span
        v-else
        class="text-label-medium"
        :class="['group-name', { 'group-name--deep': level >= 5 }]"
        :title="level >= 5 ? `Profondeur ${level} — organisation complexe` : undefined"
        @dblclick="startRename(group)"
      >{{ group.name }}</span>

      <!-- Inline action buttons (visible on hover) -->
      <v-btn variant="text" density="compact" size="x-small" class="header-btn" :title="t('sidebar.renameGroup')" @click.stop="startRename(group)">
        <v-icon size="12">mdi-pencil</v-icon>
      </v-btn>
      <v-btn variant="text" density="compact" size="x-small" class="header-btn header-btn--danger" :title="t('sidebar.deleteGroup')" @click.stop="handleDeleteGroup(group.id)">
        <v-icon size="12">mdi-delete</v-icon>
      </v-btn>
    </div>

    <!-- Drop hint -->
    <div v-if="dragOverGroupId === group.id" class="drop-hint text-label-medium">{{ t('sidebar.dropAgentHere') }}</div>

    <!-- Content (hidden when collapsed) -->
    <div v-if="!collapsed">
      <!-- Inline subgroup creation (MD3 v-text-field) -->
      <div v-if="creatingSubgroupForId === group.id" :style="subgroupInputStyle" class="subgroup-create-row ga-1 mb-1">
        <v-text-field
          v-model="newSubgroupName"
          density="compact"
          variant="outlined"
          hide-details
          autofocus
          class="group-name-input"
          :placeholder="t('sidebar.newGroupPlaceholder')"
          @keydown.enter="confirmCreateSubgroup"
          @keydown.esc="cancelCreateSubgroup"
        />
        <v-btn variant="text" density="compact" size="x-small" class="icon-btn icon-btn--confirm text-caption" @click="confirmCreateSubgroup">✓</v-btn>
        <v-btn variant="text" density="compact" size="x-small" class="icon-btn icon-btn--cancel text-caption" @click="cancelCreateSubgroup">✕</v-btn>
      </div>

      <!-- Child groups (recursive) -->
      <div v-if="group.children?.length" :style="childContentStyle">
        <SidebarGroupNode
          v-for="child in group.children"
          :key="child.id"
          :group="child"
          :level="level + 1"
        />
      </div>

      <!-- Agents in this group — MD3 v-list + v-list-item (default slot only) -->
      <v-list density="compact" bg-color="transparent" class="pa-0" :style="childContentStyle">
        <div
          v-for="agent in groupAgents"
          :key="agent.id"
          class="agent-item"
          draggable="true"
          @dragstart="onAgentDragStart($event, agent)"
          @contextmenu.prevent="openContextMenu($event, agent)"
        >
          <v-list-item
            density="compact"
            rounded="lg"
            :active="isAgentSelected(agent.id)"
            active-color="secondary-container"
            @click="store.toggleAgentFilter(agent.id)"
          >
            <div class="agent-row">
              <span class="agent-status">
                <v-progress-circular v-if="tabsStore.isAgentActive(agent.name)" class="status-spinner" indeterminate :size="12" :width="2" :style="{ color: agentAccent(agent.name) }" />
                <v-icon v-else-if="hasOpenTerminal(agent.name) && !tabsStore.isAgentActive(agent.name)" class="status-pulse" size="12" :style="{ color: agentAccent(agent.name) }">mdi-circle-medium</v-icon>
                <span v-else class="status-dot" :style="{ backgroundColor: agentAccent(agent.name) }" />
              </span>
              <span :class="['agent-name', isAgentSelected(agent.id) ? 'agent-name--active' : '']">{{ agent.name }}</span>
              <div class="agent-actions ga-1">
                <span class="drag-handle" :title="t('sidebar.move')"><v-icon size="12">mdi-drag</v-icon></span>
                <v-btn variant="text" density="compact" size="x-small" class="action-btn" :title="t('sidebar.editAgent')" @click.stop="openEditAgent(agent)"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                <v-btn variant="text" density="compact" size="x-small" class="action-btn action-btn--launch" :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }" :title="t('sidebar.launchAgent', { name: agent.name })" @click.stop="openLaunchModal($event, agent)"><v-icon size="12">mdi-play</v-icon></v-btn>
              </div>
            </div>
          </v-list-item>
        </div>
        <div v-if="groupAgents.length === 0 && dragOverGroupId !== group.id" class="empty-msg py-1 px-2 text-label-medium">{{ t('sidebar.dropAgentHere') }}</div>
      </v-list>
    </div>
  </div>

  <!-- Group context menu -->
  <ContextMenu
    v-if="groupContextMenu"
    :x="groupContextMenu.x"
    :y="groupContextMenu.y"
    :items="groupContextMenuItems"
    @close="groupContextMenu = null"
  />
</template>

<style scoped>
.group-node {
  position: relative;
}
.guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(var(--v-theme-content-subtle), 0.6);
  pointer-events: none;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 2px;
  border-radius: var(--shape-xs);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
  cursor: pointer;
}
.group-header.drag-target {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.4);
}
.collapse-btn {
  width: 16px !important;
  min-width: 16px !important;
  height: 16px !important;
  min-height: 16px !important;
  flex-shrink: 0;
  color: var(--content-dim) !important;
  padding: 0 !important;
}
.chevron-icon {
  width: 10px;
  height: 10px;
  transition: transform var(--md-duration-short3) var(--md-easing-standard);
}
/* MD3 v-text-field for inline rename — flex: 1 to fill header */
.rename-input {
  flex: 1;
  min-width: 0;
}
.group-name {
  flex: 1;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 0;
  color: var(--content-subtle);
}
.group-name--deep { color: rgb(var(--v-theme-content-subtle)); }
.header-btn {
  width: 20px !important;
  min-width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  padding: 0 !important;
  color: var(--content-dim) !important;
  opacity: 0;
}
.header-btn--danger:hover { color: rgb(var(--v-theme-error)) !important; }
.group-header:hover .header-btn { opacity: 1; }
.drop-hint {
  margin: 0 4px 4px;
  padding: 4px 0;
  color: rgba(var(--v-theme-primary), 0.7);
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: var(--shape-xs);
}
/* MD3 v-text-field for subgroup creation */
.subgroup-create-row {
  display: flex;
  align-items: center;
}
.group-name-input {
  flex: 1;
  min-width: 0;
}
.icon-btn {
  width: 24px !important;
  min-width: 24px !important;
  height: 24px !important;
  min-height: 24px !important;
  padding: 0 !important;
}
.icon-btn--confirm { color: rgb(var(--v-theme-secondary)) !important; }
.icon-btn--cancel { color: var(--content-faint) !important; }
.agent-item { position: relative; }
/* Flex row inside v-list-item default slot */
.agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
/* Status indicator */
.agent-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.status-spinner {
  width: 14px;
  height: 14px;
  animation: spin 1s linear infinite;
}
.status-pulse {
  width: 14px;
  height: 14px;
  animation: pulse 2s ease-in-out infinite;
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: block;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
/* Agent name — takes remaining space */
.agent-name {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  color: var(--content-muted);
}
.agent-name--active { color: var(--content-primary); }
/* Agent action buttons — shown on hover */
.agent-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity var(--md-duration-short3) var(--md-easing-standard);
}
.agent-item:hover .agent-actions { opacity: 1; }
.drag-handle {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: var(--content-dim);
}
.action-btn {
  width: 20px !important;
  min-width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  color: var(--content-subtle) !important;
}
.action-btn--launch:hover { filter: brightness(1.15); }
.empty-msg {
  color: var(--content-dim);
  font-style: italic;
}
</style>
