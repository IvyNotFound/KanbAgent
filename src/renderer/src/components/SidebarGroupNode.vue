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
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
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
  renameGroupInputEl,
  confirmRename,
  cancelRename,
  startRename,
  handleDeleteGroup,
  creatingSubgroupForId,
  newSubgroupName,
  createSubgroupInputEl,
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
const collapsed = ref(false)
const groupContextMenu = ref<{ x: number; y: number } | null>(null)

// ── Computed ──────────────────────────────────────────────────────────────────
/** Agents that belong to this group, sorted by their sort_order within the group. */
const groupAgents = computed<Agent[]>(() => {
  return [...(props.group.members ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(m => store.agents.find(a => a.id === m.agent_id))
    .filter(Boolean) as Agent[]
})

/** Left padding class based on nesting level. */
const indent = computed(() => {
  const sizes = ['pl-0', 'pl-3', 'pl-6', 'pl-9']
  return sizes[Math.min(props.level, sizes.length - 1)]
})

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
    class="mb-1"
    @dragover="onGroupDragOver($event, group.id)"
    @dragleave="onGroupDragLeave"
    @drop="onGroupDrop($event, group.id)"
  >
    <!-- Group header -->
    <div
      :class="[indent, 'flex items-center gap-0.5 mb-0.5 group/header rounded px-1 transition-colors', dragOverGroupId === group.id ? 'bg-violet-500/10 ring-1 ring-violet-500/40' : '']"
      draggable="true"
      @dragstart="onGroupDragStart($event, group)"
      @contextmenu.prevent="openGroupContextMenu"
    >
      <!-- Collapse/expand toggle -->
      <button
        class="w-4 h-4 flex items-center justify-center text-content-dim hover:text-content-secondary transition-colors shrink-0"
        @click.stop="collapsed = !collapsed"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-2.5 h-2.5 transition-transform" :class="collapsed ? '-rotate-90' : ''">
          <path d="M1.5 5.5l6.5 6.5 6.5-6.5z"/>
        </svg>
      </button>

      <!-- Rename input or group name -->
      <template v-if="renamingGroupId === group.id">
        <input
          :ref="(el) => { if (el) renameGroupInputEl = el as HTMLInputElement }"
          v-model="renameGroupName"
          class="flex-1 bg-surface-secondary border border-edge-default rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-content-primary outline-none focus:ring-1 focus:ring-violet-500"
          @keydown.enter="confirmRename(group.id)"
          @keydown.esc="cancelRename"
          @blur="confirmRename(group.id)"
        />
      </template>
      <span
        v-else
        class="flex-1 text-[11px] font-semibold text-content-subtle uppercase tracking-wider cursor-pointer select-none truncate py-0.5"
        @dblclick="startRename(group)"
      >{{ group.name }}</span>

      <!-- Inline action buttons (visible on hover) -->
      <button
        class="w-5 h-5 flex items-center justify-center rounded text-content-dim hover:text-content-secondary hover:bg-surface-secondary transition-colors opacity-0 group-hover/header:opacity-100"
        :title="t('sidebar.renameGroup')"
        @click.stop="startRename(group)"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-2.5 h-2.5"><path d="M9.5 1.5a2.121 2.121 0 0 1 3 3L4 13H1v-3L9.5 1.5z"/></svg>
      </button>
      <button
        class="w-5 h-5 flex items-center justify-center rounded text-content-dim hover:text-red-400 hover:bg-surface-secondary transition-colors opacity-0 group-hover/header:opacity-100"
        :title="t('sidebar.deleteGroup')"
        @click.stop="handleDeleteGroup(group.id)"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-2.5 h-2.5">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
          <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
        </svg>
      </button>
    </div>

    <!-- Drop hint -->
    <div
      v-if="dragOverGroupId === group.id"
      class="mx-1 py-1 text-[10px] text-violet-400/70 text-center border border-dashed border-violet-500/40 rounded mb-1"
    >{{ t('sidebar.dropAgentHere') }}</div>

    <!-- Content (hidden when collapsed) -->
    <div v-if="!collapsed">
      <!-- Inline subgroup creation for this group -->
      <div v-if="creatingSubgroupForId === group.id" :class="[indent, 'pl-3 mb-1 flex items-center gap-1']">
        <input
          :ref="(el) => { if (el) createSubgroupInputEl = el as HTMLInputElement }"
          v-model="newSubgroupName"
          class="flex-1 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-xs text-content-primary outline-none focus:ring-1 focus:ring-violet-500 font-semibold"
          :placeholder="t('sidebar.newGroupPlaceholder')"
          @keydown.enter="confirmCreateSubgroup"
          @keydown.esc="cancelCreateSubgroup"
        />
        <button class="w-6 h-6 flex items-center justify-center rounded text-emerald-400 hover:bg-surface-secondary transition-colors text-xs" @click="confirmCreateSubgroup">✓</button>
        <button class="w-6 h-6 flex items-center justify-center rounded text-content-faint hover:text-content-secondary hover:bg-surface-secondary transition-colors text-xs" @click="cancelCreateSubgroup">✕</button>
      </div>

      <!-- Child groups (recursive) -->
      <div v-if="group.children?.length" :class="[indent, 'pl-2']">
        <SidebarGroupNode
          v-for="child in group.children"
          :key="child.id"
          :group="child"
          :level="level + 1"
        />
      </div>

      <!-- Agents in this group -->
      <div :class="[indent, 'pl-2 space-y-0.5']">
        <div
          v-for="agent in groupAgents"
          :key="agent.id"
          class="group"
          draggable="true"
          @dragstart="onAgentDragStart($event, agent)"
          @contextmenu.prevent="openContextMenu($event, agent)"
        >
          <div class="relative">
            <button
              :class="['w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer pr-[80px]', isAgentSelected(agent.id) ? 'bg-surface-secondary ring-1 ring-content-faint' : 'hover:bg-surface-primary']"
              @click="store.toggleAgentFilter(agent.id)"
            >
              <span class="relative shrink-0 flex items-center justify-center w-4 h-4">
                <svg v-if="tabsStore.isAgentActive(agent.name)" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none" :style="{ color: agentFg(agent.name) }"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/><path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <svg v-else-if="hasOpenTerminal(agent.name) && !tabsStore.isAgentActive(agent.name)" class="w-3.5 h-3.5 animate-pulse" viewBox="0 0 14 14" fill="none" :style="{ color: agentFg(agent.name) }"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>
                <span v-else class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: agentFg(agent.name) }" />
              </span>
              <span :class="['text-sm truncate font-mono', isAgentSelected(agent.id) ? 'text-content-primary' : 'text-content-muted']">{{ agent.name }}</span>
            </button>
            <div class="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <span class="w-5 h-5 flex items-center justify-center cursor-grab text-content-dim" :title="t('sidebar.move')"><svg viewBox="0 0 16 16" fill="currentColor" class="w-2.5 h-2.5"><path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg></span>
              <button class="w-5 h-5 flex items-center justify-center rounded transition-colors text-content-subtle hover:text-content-secondary hover:bg-surface-tertiary" :title="t('sidebar.editAgent')" @click.stop="openEditAgent(agent)"><svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3"><path d="M9.5 1.5a2.121 2.121 0 0 1 3 3L4 13H1v-3L9.5 1.5z"/></svg></button>
              <button class="w-5 h-5 flex items-center justify-center rounded transition-colors" :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }" :title="t('sidebar.launchAgent', { name: agent.name })" @click.stop="openLaunchModal($event, agent)"><svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3"><path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/></svg></button>
            </div>
          </div>
        </div>
        <div v-if="groupAgents.length === 0 && dragOverGroupId !== group.id" class="text-[11px] text-content-dim px-2 py-1 italic">{{ t('sidebar.dropAgentHere') }}</div>
      </div>
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
