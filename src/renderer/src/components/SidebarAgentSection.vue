<script setup lang="ts">
/**
 * SidebarAgentSection — section agents + groupes de la sidebar (T815/T946).
 * Gère : drag & drop, renommage/création/suppression de groupes, modales agents.
 * Les groupes sont affichés en arbre hiérarchique via SidebarGroupNode (T946).
 */
import { computed, ref, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useAgentsStore } from '@renderer/stores/agents'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
import { useToast } from '@renderer/composables/useToast'
import { useSidebarDragDrop, sidebarDragDropKey } from '@renderer/composables/useSidebarDragDrop'
import { useSidebarGroups, sidebarGroupsKey } from '@renderer/composables/useSidebarGroups'
import LaunchSessionModal from './LaunchSessionModal.vue'
import ContextMenu from './ContextMenu.vue'
import CreateAgentModal from './CreateAgentModal.vue'
import ConfirmModal from './ConfirmModal.vue'
import SidebarGroupNode from './SidebarGroupNode.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import type { Agent } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()
const agentsStore = useAgentsStore()
const tabsStore = useTabsStore()
const { push: pushToast } = useToast()

// ── Composables ───────────────────────────────────────────────────────────────
const dragDrop = useSidebarDragDrop()
const sidebarGroups = useSidebarGroups()

// Provide composable state to SidebarGroupNode children (recursive)
provide(sidebarDragDropKey, dragDrop)
provide(sidebarGroupsKey, sidebarGroups)

const {
  dragOverGroupId,
  onAgentDragStart,
  onGroupDragOver,
  onGroupDragLeave,
  onGroupDrop,
} = dragDrop

const {
  confirmDeleteGroup,
  creatingGroup,
  newGroupName,
  createGroupInputEl,
  startCreateGroup,
  confirmCreateGroup,
  cancelCreateGroup,
  onConfirmDeleteGroup,
} = sidebarGroups

// ── Modal state ───────────────────────────────────────────────────────────────
const launchTarget = ref<Agent | null>(null)
const showCreateAgent = ref(false)
const editAgentTarget = ref<Agent | null>(null)
const contextMenu = ref<{ x: number; y: number; agent: Agent } | null>(null)

// Provide agent interaction callbacks to SidebarGroupNode
provide('openLaunchModal', (event: MouseEvent, agent: Agent) => {
  event.stopPropagation()
  openAgentSession(agent)
})
provide('openContextMenu', (event: MouseEvent, agent: Agent) => {
  event.preventDefault()
  event.stopPropagation()
  contextMenu.value = { x: event.clientX, y: event.clientY, agent }
})
provide('openEditAgent', (agent: Agent) => {
  editAgentTarget.value = agent
})

// ── Computed ──────────────────────────────────────────────────────────────────
const openTerminalAgents = computed(() => {
  const set = new Set<string>()
  for (const tab of tabsStore.tabs) {
    if (tab.type === 'terminal' && tab.agentName) set.add(tab.agentName)
  }
  return set
})

function hasOpenTerminal(agentName: string): boolean {
  return openTerminalAgents.value.has(agentName)
}

const groupedAgentIds = computed(() => {
  const s = new Set<number>()
  for (const g of store.agentGroups)
    for (const m of g.members) s.add(m.agent_id)
  return s
})

const ungroupedAgents = computed(() =>
  store.agents.filter(a => !groupedAgentIds.value.has(a.id))
)

function isAgentSelected(id: number | string): boolean {
  return store.selectedAgentId !== null && Number(store.selectedAgentId) === Number(id)
}

// ── Agent actions ─────────────────────────────────────────────────────────────
function openAgentSession(agent: Agent) {
  const terminalCount = tabsStore.tabs.filter(t => t.type === 'terminal' && t.agentName === agent.name).length
  const maxSessions = agent.max_sessions ?? 1
  if (maxSessions !== -1 && terminalCount >= maxSessions) {
    const existing = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agent.name)
    if (existing) { tabsStore.setActive(existing.id); return }
  }
  launchTarget.value = agent
}

function openLaunchModal(event: MouseEvent, agent: Agent) {
  event.stopPropagation()
  openAgentSession(agent)
}

function openContextMenuLocal(event: MouseEvent, agent: Agent) {
  event.preventDefault()
  event.stopPropagation()
  contextMenu.value = { x: event.clientX, y: event.clientY, agent }
}

function contextMenuItemsFor(agent: Agent): ContextMenuItem[] {
  const terminalCount = tabsStore.tabs.filter(tab => tab.type === 'terminal' && tab.agentName === agent.name).length
  const maxSessions = agent.max_sessions ?? 1
  const multiSession = maxSessions === -1 || maxSessions > 1
  const atLimit = maxSessions !== -1 && terminalCount >= maxSessions
  const primaryLabel = multiSession && !atLimit
    ? t('sidebar.newSession')
    : (hasOpenTerminal(agent.name) ? t('sidebar.goToSession') : t('sidebar.openSession'))
  return [
    { label: primaryLabel, action: () => openAgentSession(agent) },
    { label: t('sidebar.viewLogs'), action: () => tabsStore.addLogs(agent.id) },
    { label: t('sidebar.viewTasks'), action: () => store.toggleAgentFilter(agent.id) },
    { separator: true, label: '', action: () => {} },
    { label: t('sidebar.editAgent'), action: () => { editAgentTarget.value = agent } },
    { label: t('sidebar.duplicateAgent'), action: () => duplicateAgent(agent) },
  ]
}

async function duplicateAgent(agent: Agent): Promise<void> {
  const dbPath = store.dbPath
  if (!dbPath) return
  const result = await window.electronAPI.duplicateAgent(dbPath, agent.id)
  if (result.success) {
    pushToast(t('agent.duplicated', { name: result.name }), 'success')
    await store.refresh()
  } else {
    pushToast(result.error ?? t('agent.duplicateError'), 'error')
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3">
    <div v-if="store.selectedAgentId !== null" class="flex justify-end mb-2">
      <button
        class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        @click="store.selectedAgentId = null"
      >{{ t('sidebar.reset') }}</button>
    </div>

    <!-- Création de groupe inline (top-level) -->
    <div v-if="creatingGroup" class="mb-2 flex items-center gap-1">
      <input
        ref="createGroupInputEl"
        v-model="newGroupName"
        class="flex-1 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-xs text-content-primary outline-none focus:ring-1 focus:ring-violet-500 font-semibold"
        :placeholder="t('sidebar.newGroupPlaceholder')"
        @keydown.enter="confirmCreateGroup"
        @keydown.esc="cancelCreateGroup"
      />
      <button class="w-6 h-6 flex items-center justify-center rounded text-emerald-400 hover:bg-surface-secondary transition-colors text-xs" @click="confirmCreateGroup">✓</button>
      <button class="w-6 h-6 flex items-center justify-center rounded text-content-faint hover:text-content-secondary hover:bg-surface-secondary transition-colors text-xs" @click="cancelCreateGroup">✕</button>
    </div>

    <!-- ── Groupes hiérarchiques ── -->
    <SidebarGroupNode
      v-for="group in agentsStore.agentGroupsTree"
      :key="group.id"
      :group="group"
      :level="0"
    />

    <!-- ── Non groupés ── -->
    <div
      class="mb-2"
      @dragover="onGroupDragOver($event, null)"
      @dragleave="onGroupDragLeave"
      @drop="onGroupDrop($event, null)"
    >
      <div class="flex items-center gap-0.5 mb-0.5 px-1 rounded transition-colors" :class="dragOverGroupId === '__ungrouped__' ? 'bg-violet-500/10 ring-1 ring-violet-500/40' : ''">
        <span class="flex-1 text-[11px] font-semibold text-content-subtle uppercase tracking-wider py-0.5 select-none">{{ t('sidebar.ungrouped') }}</span>
      </div>
      <div v-if="dragOverGroupId === '__ungrouped__'" class="mx-1 py-1 text-[10px] text-violet-400/70 text-center border border-dashed border-violet-500/40 rounded mb-1">{{ t('sidebar.dropAgentHere') }}</div>
      <div class="space-y-0.5">
        <div
          v-for="agent in ungroupedAgents"
          :key="agent.id"
          class="group"
          draggable="true"
          @dragstart="onAgentDragStart($event, agent)"
          @contextmenu.prevent="openContextMenuLocal($event, agent)"
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
              <button class="w-5 h-5 flex items-center justify-center rounded transition-colors text-content-subtle hover:text-content-secondary hover:bg-surface-tertiary" :title="t('sidebar.editAgent')" @click.stop="editAgentTarget = agent"><svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3"><path d="M9.5 1.5a2.121 2.121 0 0 1 3 3L4 13H1v-3L9.5 1.5z"/></svg></button>
              <button class="w-5 h-5 flex items-center justify-center rounded transition-colors" :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }" :title="t('sidebar.launchAgent', { name: agent.name })" @click.stop="openLaunchModal($event, agent)"><svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3"><path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/></svg></button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="ungroupedAgents.length === 0 && store.agents.length > 0 && dragOverGroupId !== '__ungrouped__'" class="text-[11px] text-content-dim px-2 py-1 italic">{{ t('sidebar.dropAgentHere') }}</div>
      <div v-if="store.agents.length === 0" class="text-sm text-content-faint px-2 py-2">{{ t('sidebar.noAgent') }}</div>
    </div>

    <!-- Bouton nouveau groupe -->
    <button
      v-if="!creatingGroup"
      class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-content-faint hover:text-content-tertiary hover:bg-surface-primary transition-colors w-full"
      @click="startCreateGroup"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
      {{ t('sidebar.newGroup') }}
    </button>

    <!-- Bouton ajouter agent -->
    <button
      class="mt-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-content-faint hover:text-content-tertiary hover:bg-surface-primary transition-colors w-full"
      @click="showCreateAgent = true"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
      {{ t('sidebar.addAgent') }}
    </button>
  </div>

  <!-- Modales agents -->
  <LaunchSessionModal v-if="launchTarget" :agent="launchTarget" @close="launchTarget = null" />
  <CreateAgentModal v-if="showCreateAgent" @close="showCreateAgent = false" @created="store.refresh()" @toast="(msg, type) => pushToast(msg, type === 'success' ? 'info' : 'error')" />
  <CreateAgentModal v-if="editAgentTarget" mode="edit" :agent="editAgentTarget" @close="editAgentTarget = null" @saved="editAgentTarget = null; store.refresh()" @toast="(msg, type) => pushToast(msg, type === 'success' ? 'info' : 'error')" />
  <ContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenuItemsFor(contextMenu.agent)" @close="contextMenu = null" />
  <ConfirmModal v-if="confirmDeleteGroup" :title="t('sidebar.deleteGroup')" :message="t('sidebar.deleteGroupDetail')" danger @confirm="onConfirmDeleteGroup" @cancel="confirmDeleteGroup = null" />
</template>
