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
import { agentFg, agentBg, agentAccent } from '@renderer/utils/agentColor'
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

    <!-- Création de groupe inline (top-level) — MD3 v-text-field -->
    <div v-if="creatingGroup" class="group-create-row ga-1 mb-2">
      <v-text-field
        v-model="newGroupName"
        density="compact"
        variant="outlined"
        hide-details
        autofocus
        class="group-name-input"
        :placeholder="t('sidebar.newGroupPlaceholder')"
        @keydown.enter="confirmCreateGroup"
        @keydown.esc="cancelCreateGroup"
      />
      <v-btn variant="text" density="compact" size="x-small" class="icon-btn icon-btn--confirm text-caption" @click="confirmCreateGroup">✓</v-btn>
      <v-btn variant="text" density="compact" size="x-small" class="icon-btn icon-btn--cancel text-caption" @click="cancelCreateGroup">✕</v-btn>
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
      :class="{ 'drag-target': dragOverGroupId === '__ungrouped__' }"
      @dragover="onGroupDragOver($event, null)"
      @dragleave="onGroupDragLeave"
      @drop="onGroupDrop($event, null)"
    >
      <!-- MD3 list subheader -->
      <v-list-subheader class="section-label text-label-medium px-1">
        {{ t('sidebar.ungrouped') }}
      </v-list-subheader>
      <div v-if="dragOverGroupId === '__ungrouped__'" class="drop-hint text-label-medium">{{ t('sidebar.dropAgentHere') }}</div>

      <!-- MD3 v-list + v-list-item for agents (default slot only — avoids Vue 3.5 named-slot + v-for compiler issue) -->
      <v-list density="compact" bg-color="transparent" class="pa-0">
        <div
          v-for="agent in ungroupedAgents"
          :key="agent.id"
          class="agent-item"
          draggable="true"
          @dragstart="onAgentDragStart($event, agent)"
          @contextmenu.prevent="openContextMenuLocal($event, agent)"
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
                <v-btn variant="text" density="compact" size="x-small" class="action-btn" :title="t('sidebar.editAgent')" @click.stop="editAgentTarget = agent"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                <v-btn variant="text" density="compact" size="x-small" class="action-btn action-btn--launch" :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }" :title="t('sidebar.launchAgent', { name: agent.name })" @click.stop="openLaunchModal($event, agent)"><v-icon size="12">mdi-play</v-icon></v-btn>
              </div>
            </div>
          </v-list-item>
        </div>
        <div v-if="ungroupedAgents.length === 0 && store.agents.length > 0 && dragOverGroupId !== '__ungrouped__'" class="empty-msg py-1 px-2 text-label-medium">{{ t('sidebar.dropAgentHere') }}</div>
      </v-list>
      <div v-if="store.agents.length === 0" class="no-agents-msg pa-2 text-body-2">{{ t('sidebar.noAgent') }}</div>
    </div>

    <!-- Bouton nouveau groupe — MD3 text button with prepend-icon -->
    <v-btn v-if="!creatingGroup" variant="text" block size="small" height="36" class="add-btn text-caption" prepend-icon="mdi-plus" @click="startCreateGroup">
      {{ t('sidebar.newGroup') }}
    </v-btn>

    <!-- Bouton ajouter agent -->
    <v-btn variant="text" block size="small" height="36" class="add-btn mt-1 text-caption" prepend-icon="mdi-plus" @click="showCreateAgent = true">
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
/* v-text-field already handles styling; keep min-width for the input to flex properly */
.group-name-input {
  flex: 1;
  min-width: 0;
}
.icon-btn {
  min-width: 24px !important;
  min-height: 24px !important;
  width: 24px !important;
  height: 24px !important;
}
.icon-btn--confirm { color: rgb(var(--v-theme-secondary)) !important; }
.icon-btn--cancel { color: var(--content-faint) !important; }

/* Ungrouped zone drag-target highlight */
.ungrouped-zone {
  border-radius: var(--shape-xs);
  transition: all var(--md-duration-short3) var(--md-easing-standard);
}
.ungrouped-zone.drag-target {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.4);
}
.section-label {
  min-height: 32px !important; /* MD3 list subheader standard */
  font-weight: 500; /* MD3 Label Large */
  letter-spacing: 0.00625em; /* MD3 Label Large: 0.1px / 16px */
  color: var(--content-subtle) !important;
  user-select: none;
}
.drop-hint {
  margin: 0 4px 4px;
  padding: 4px 0;
  color: rgba(var(--v-theme-primary), 0.7);
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: var(--shape-xs);
}
/* Agent item styles shared with SidebarGroupNode — defined in main.css */
.no-agents-msg {
  color: var(--content-faint);
}
.add-btn {
  color: var(--content-faint) !important;
  justify-content: flex-start !important;
}
</style>
