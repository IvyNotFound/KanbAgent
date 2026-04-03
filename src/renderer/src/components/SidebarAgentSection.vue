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
  <div class="agent-section py-3 px-4">
    <div v-if="store.selectedAgentId !== null" class="reset-row mb-2">
      <v-btn variant="text" size="small" color="primary" class="reset-btn text-caption" @click="store.selectedAgentId = null">{{ t('sidebar.reset') }}</v-btn>
    </div>

    <!-- Création de groupe inline (top-level) -->
    <div v-if="creatingGroup" class="group-create-row ga-1 mb-2">
      <input
        ref="createGroupInputEl"
        v-model="newGroupName"
        class="group-name-input py-1 px-2 text-caption"
        :placeholder="t('sidebar.newGroupPlaceholder')"
        @keydown.enter="confirmCreateGroup"
        @keydown.esc="cancelCreateGroup"
      />
      <v-btn variant="text" size="small" density="compact" class="icon-btn icon-btn--confirm text-caption" @click="confirmCreateGroup">✓</v-btn>
      <v-btn variant="text" size="small" density="compact" class="icon-btn icon-btn--cancel text-caption" @click="cancelCreateGroup">✕</v-btn>
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
      class="ungrouped-zone mb-2"
      @dragover="onGroupDragOver($event, null)"
      @dragleave="onGroupDragLeave"
      @drop="onGroupDrop($event, null)"
    >
      <div class="section-header px-1" :class="{ 'drag-target': dragOverGroupId === '__ungrouped__' }">
        <span class="section-label text-caption font-weight-medium">{{ t('sidebar.ungrouped') }}</span>
      </div>
      <div v-if="dragOverGroupId === '__ungrouped__'" class="drop-hint text-caption font-weight-medium">{{ t('sidebar.dropAgentHere') }}</div>
      <div class="agents-list">
        <div
          v-for="agent in ungroupedAgents"
          :key="agent.id"
          class="agent-item"
          draggable="true"
          @dragstart="onAgentDragStart($event, agent)"
          @contextmenu.prevent="openContextMenuLocal($event, agent)"
        >
          <div class="agent-row-wrap">
            <v-btn
              variant="text"
              block
              :class="['agent-btn', isAgentSelected(agent.id) ? 'agent-btn--selected' : '']"
              @click="store.toggleAgentFilter(agent.id)"
            >
              <span class="agent-status">
                <v-progress-circular v-if="tabsStore.isAgentActive(agent.name)" class="status-spinner" indeterminate :size="12" :width="2" :style="{ color: agentFg(agent.name) }" />
                <v-icon v-else-if="hasOpenTerminal(agent.name) && !tabsStore.isAgentActive(agent.name)" class="status-pulse" size="12" :style="{ color: agentFg(agent.name) }">mdi-circle-medium</v-icon>
                <span v-else class="status-dot" :style="{ backgroundColor: agentFg(agent.name) }" />
              </span>
              <span :class="['agent-name', isAgentSelected(agent.id) ? 'agent-name--active' : '']">{{ agent.name }}</span>
            </v-btn>
            <div class="agent-actions ga-1">
              <span class="drag-handle" :title="t('sidebar.move')"><v-icon size="12" class="icon-xs">mdi-drag</v-icon></span>
              <v-btn variant="text" density="compact" size="x-small" class="action-btn" :title="t('sidebar.editAgent')" @click.stop="editAgentTarget = agent"><v-icon size="12" class="icon-sm">mdi-pencil</v-icon></v-btn>
              <v-btn variant="text" density="compact" size="x-small" class="action-btn action-btn--launch" :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }" :title="t('sidebar.launchAgent', { name: agent.name })" @click.stop="openLaunchModal($event, agent)"><v-icon size="12" class="icon-sm">mdi-play</v-icon></v-btn>
            </div>
          </div>
        </div>
      </div>
      <div v-if="ungroupedAgents.length === 0 && store.agents.length > 0 && dragOverGroupId !== '__ungrouped__'" class="empty-msg py-1 px-2 text-caption font-weight-medium">{{ t('sidebar.dropAgentHere') }}</div>
      <div v-if="store.agents.length === 0" class="no-agents-msg pa-2 text-body-2">{{ t('sidebar.noAgent') }}</div>
    </div>

    <!-- Bouton nouveau groupe -->
    <v-btn v-if="!creatingGroup" variant="text" block size="small" class="add-btn ga-2 text-caption" @click="startCreateGroup">
      <v-icon size="12" class="icon-sm">mdi-plus</v-icon>
      {{ t('sidebar.newGroup') }}
    </v-btn>

    <!-- Bouton ajouter agent -->
    <v-btn variant="text" block size="small" class="add-btn add-btn--mt ga-2 mt-1 text-caption" @click="showCreateAgent = true">
      <v-icon size="12" class="icon-sm">mdi-plus</v-icon>
      {{ t('sidebar.addAgent') }}
    </v-btn>
  </div>

  <!-- Modales agents -->
  <LaunchSessionModal v-if="launchTarget" :agent="launchTarget" @close="launchTarget = null" />
  <CreateAgentModal v-if="showCreateAgent" @close="showCreateAgent = false" @created="store.refresh()" @toast="(msg, type) => pushToast(msg, type === 'success' ? 'info' : 'error')" />
  <CreateAgentModal v-if="editAgentTarget" mode="edit" :agent="editAgentTarget" @close="editAgentTarget = null" @saved="editAgentTarget = null; store.refresh()" @toast="(msg, type) => pushToast(msg, type === 'success' ? 'info' : 'error')" />
  <ContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenuItemsFor(contextMenu.agent)" @close="contextMenu = null" />
  <ConfirmModal v-if="confirmDeleteGroup" :title="t('sidebar.deleteGroup')" :message="t('sidebar.deleteGroupDetail')" danger @confirm="onConfirmDeleteGroup" @cancel="confirmDeleteGroup = null" />
</template>

<style scoped>
.agent-section {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.reset-row {
  display: flex;
  justify-content: flex-end;
}
.group-create-row {
  display: flex;
  align-items: center;
}
.group-name-input {
  flex: 1;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 4px;
  color: var(--content-primary);
  outline: none;
  font-weight: 600;
}
.group-name-input:focus {
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
}
.icon-btn {
  min-width: 24px !important;
  min-height: 24px !important;
  width: 24px !important;
  height: 24px !important;
}
.icon-btn--confirm { color: rgb(var(--v-theme-secondary)) !important; }
.icon-btn--cancel { color: var(--content-faint) !important; }
.ungrouped-zone {
}
.section-header {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 2px;
  border-radius: 4px;
  transition: all 150ms;
}
.section-header.drag-target {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.4);
}
.section-label {
  flex: 1;
  font-weight: 600;
  color: var(--content-subtle);
  letter-spacing: 0.02em;
  padding: 2px 0;
  user-select: none;
}
.drop-hint {
  margin: 0 4px 4px;
  padding: 4px 0;
  color: rgba(var(--v-theme-primary), 0.7);
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: 4px;
}
.agents-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-item {
  position: relative;
}
.agent-row-wrap {
  position: relative;
}
.agent-btn {
  padding-right: 80px !important;
  justify-content: flex-start !important;
  gap: 12px !important;
  text-align: left !important;
}
.agent-btn--selected {
  background: var(--surface-secondary) !important;
  box-shadow: 0 0 0 1px var(--content-faint) !important;
}
.agent-status {
  position: relative;
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
.agent-name {
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  color: var(--content-muted);
}
.agent-name--active { color: var(--content-primary); }
.agent-actions {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  opacity: 0;
  transition: opacity 150ms;
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
.no-agents-msg {
  color: var(--content-faint);
}
.add-btn {
  color: var(--content-faint) !important;
  justify-content: flex-start !important;
}
.add-btn--mt { }
.icon-xs { width: 10px; height: 10px; }
.icon-sm { width: 12px; height: 12px; }
</style>
