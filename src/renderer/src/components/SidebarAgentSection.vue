<script setup lang="ts">
/**
 * SidebarAgentSection — section agents + groupes de la sidebar (T815/T946/T1668).
 * Utilise v-treeview (Vuetify MD3) pour l'arbre des groupes avec connecteurs natifs.
 * SidebarGroupNode n'est plus utilisé — tout est inlinés ici via les slots #header/#item.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useAgentsStore } from '@renderer/stores/agents'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentAccent } from '@renderer/utils/agentColor'
import { useToast } from '@renderer/composables/useToast'
import { useSidebarDragDrop } from '@renderer/composables/useSidebarDragDrop'
import { useSidebarGroups } from '@renderer/composables/useSidebarGroups'
import LaunchSessionModal from './LaunchSessionModal.vue'
import ContextMenu from './ContextMenu.vue'
import CreateAgentModal from './CreateAgentModal.vue'
import ConfirmModal from './ConfirmModal.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import type { Agent, AgentGroup } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()
const agentsStore = useAgentsStore()
const tabsStore = useTabsStore()
const { push: pushToast } = useToast()

// ── Composables ───────────────────────────────────────────────────────────────
const dragDrop = useSidebarDragDrop()
const sidebarGroups = useSidebarGroups()

const {
  dragOverGroupId,
  onAgentDragStart,
  onGroupDragStart,
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
  renamingGroupId,
  renameGroupName,
  startRename,
  confirmRename,
  cancelRename,
  creatingSubgroupForId,
  newSubgroupName,
  startCreateSubgroup,
  confirmCreateSubgroup,
  cancelCreateSubgroup,
  handleDeleteGroup,
  onConfirmDeleteGroup,
} = sidebarGroups

// ── Tree node types ───────────────────────────────────────────────────────────

interface GroupTreeNode {
  id: string
  name: string
  nodeType: 'group'
  group: AgentGroup
  children: (GroupTreeNode | AgentTreeNode)[]
}

interface AgentTreeNode {
  id: string
  name: string
  nodeType: 'agent'
  agent: Agent
}

// Helper to cast unknown slot item to known types (v-treeview types item as unknown)
function asGroup(item: unknown): GroupTreeNode { return item as GroupTreeNode }
function asAgent(item: unknown): AgentTreeNode { return item as AgentTreeNode }

// Helper to call v-treeview's expand/collapse toggle handler (may be array of fns)
function callToggle(handler: unknown, e: MouseEvent): void {
  e.stopPropagation()
  const h = handler as ((ev: MouseEvent) => void) | ((ev: MouseEvent) => void)[] | undefined
  if (Array.isArray(h)) { h.forEach(fn => fn(e)) } else { h?.(e) }
}

// ── Build tree for v-treeview ─────────────────────────────────────────────────
const treeItems = computed<GroupTreeNode[]>(() => {
  const agents = store.agents

  function convertGroup(group: AgentGroup): GroupTreeNode {
    const agentNodes: AgentTreeNode[] = [...(group.members ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(m => agents.find(a => a.id === m.agent_id))
      .filter((a): a is Agent => !!a)
      .map(agent => ({
        id: `a-${agent.id}`,
        name: agent.name,
        nodeType: 'agent' as const,
        agent,
      }))

    const childGroups: GroupTreeNode[] = (group.children ?? []).map(convertGroup)

    return {
      id: `g-${group.id}`,
      name: group.name,
      nodeType: 'group' as const,
      group,
      children: [...childGroups, ...agentNodes],
    }
  }

  return agentsStore.agentGroupsTree.map(convertGroup)
})

// ── Opened state (localStorage-synced) ───────────────────────────────────────
const openedSet = ref(new Set<string>())
const initializedGroupIds = new Set<number>()

watch(treeItems, (items) => {
  let changed = false
  const s = new Set(openedSet.value)

  function collect(nodes: (GroupTreeNode | AgentTreeNode)[]): void {
    for (const n of nodes) {
      if (n.nodeType === 'group') {
        if (!initializedGroupIds.has(n.group.id)) {
          initializedGroupIds.add(n.group.id)
          if (localStorage.getItem(`sidebar-group-${n.group.id}`) !== 'true') {
            s.add(n.id)
            changed = true
          }
        }
        collect(n.children)
      }
    }
  }
  collect(items)
  if (changed) openedSet.value = s
}, { immediate: true })

const openedGroups = computed(() => [...openedSet.value])

function handleOpenedUpdate(newOpened: unknown): void {
  const newArr = newOpened as string[]
  const newSet = new Set(newArr)
  for (const id of openedSet.value) {
    if (!newSet.has(id) && id.startsWith('g-')) {
      localStorage.setItem(`sidebar-group-${id.slice(2)}`, 'true')
    }
  }
  for (const id of newSet) {
    if (!openedSet.value.has(id) && id.startsWith('g-')) {
      localStorage.setItem(`sidebar-group-${id.slice(2)}`, 'false')
    }
  }
  openedSet.value = newSet
}

// ── Modal state ───────────────────────────────────────────────────────────────
const launchTarget = ref<Agent | null>(null)
const showCreateAgent = ref(false)
const editAgentTarget = ref<Agent | null>(null)
const contextMenu = ref<{ x: number; y: number; agent: Agent } | null>(null)
const groupContextMenu = ref<{ x: number; y: number; group: AgentGroup } | null>(null)

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
function openAgentSession(agent: Agent): void {
  const terminalCount = tabsStore.tabs.filter(t => t.type === 'terminal' && t.agentName === agent.name).length
  const maxSessions = agent.max_sessions ?? 1
  if (maxSessions !== -1 && terminalCount >= maxSessions) {
    const existing = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agent.name)
    if (existing) { tabsStore.setActive(existing.id); return }
  }
  launchTarget.value = agent
}

function openLaunchModal(event: MouseEvent, agent: Agent): void {
  event.stopPropagation()
  openAgentSession(agent)
}

function openContextMenuLocal(event: MouseEvent, agent: Agent): void {
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

// ── Group actions ─────────────────────────────────────────────────────────────
function openGroupContextMenu(event: MouseEvent, group: AgentGroup): void {
  event.preventDefault()
  event.stopPropagation()
  groupContextMenu.value = { x: event.clientX, y: event.clientY, group }
}

function groupContextMenuItemsFor(group: AgentGroup): ContextMenuItem[] {
  return [
    { label: t('sidebar.renameGroup'), action: () => startRename(group) },
    { label: t('sidebar.addSubgroup'), action: () => startCreateSubgroup(group.id) },
    { separator: true, label: '', action: () => {} },
    { label: t('sidebar.deleteGroup'), action: () => handleDeleteGroup(group.id) },
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

    <!-- ── Groupes hiérarchiques via v-treeview MD3 (T1668) ── -->
    <v-treeview
      v-show="treeItems.length > 0"
      :items="treeItems"
      item-value="id"
      item-title="name"
      item-children="children"
      :opened="openedGroups"
      open-strategy="multiple"
      density="compact"
      bg-color="transparent"
      class="pa-0 tree-section"
      @update:opened="handleOpenedUpdate"
    >
      <!-- GROUP HEADER — default slot only, no nested named slots to avoid Vue compiler issue.
           callToggle handles expand/collapse manually via props.onToggleExpand. -->
      <template #header="{ props, item }">
        <div
          class="group-dnd-zone"
          :class="{ 'drag-target': dragOverGroupId === asGroup(item).group.id }"
          draggable="true"
          @dragstart="onGroupDragStart($event, asGroup(item).group)"
          @dragover.prevent="onGroupDragOver($event, asGroup(item).group.id)"
          @dragleave="onGroupDragLeave"
          @drop="onGroupDrop($event, asGroup(item).group.id)"
          @contextmenu.prevent="openGroupContextMenu($event, asGroup(item).group)"
        >
          <!-- v-list-item avec indentation CSS native (.v-treeview-group cascade) -->
          <v-list-item :title="undefined" class="group-item pa-0">
            <div class="group-header-row px-1">
              <!-- Bouton toggle expand/collapse -->
              <v-btn
                variant="text"
                density="compact"
                size="x-small"
                class="collapse-btn"
                @click.stop="callToggle(props.onToggleExpand, $event)"
              >
                <v-icon
                  class="chevron-icon"
                  size="14"
                  :style="props.ariaExpanded ? {} : { transform: 'rotate(-90deg)' }"
                >
                  mdi-chevron-down
                </v-icon>
              </v-btn>

              <!-- Renommage inline ou nom du groupe — v-show évite le bug Vue codegen -->
              <v-text-field
                v-show="renamingGroupId === asGroup(item).group.id"
                v-model="renameGroupName"
                density="compact"
                variant="outlined"
                hide-details
                autofocus
                class="rename-input"
                @keydown.enter="confirmRename(asGroup(item).group.id)"
                @keydown.esc="cancelRename"
                @blur="confirmRename(asGroup(item).group.id)"
              />
              <span
                v-show="renamingGroupId !== asGroup(item).group.id"
                class="group-name text-label-medium"
                @dblclick="startRename(asGroup(item).group)"
              >{{ asGroup(item).group.name }}</span>

              <!-- Boutons d'action -->
              <v-btn variant="text" density="compact" size="x-small" class="header-btn" :title="t('sidebar.renameGroup')" @click.stop="startRename(asGroup(item).group)">
                <v-icon size="12">mdi-pencil</v-icon>
              </v-btn>
              <v-btn variant="text" density="compact" size="x-small" class="header-btn header-btn--danger" :title="t('sidebar.deleteGroup')" @click.stop="handleDeleteGroup(asGroup(item).group.id)">
                <v-icon size="12">mdi-delete</v-icon>
              </v-btn>
            </div>
          </v-list-item>

          <div v-show="dragOverGroupId === asGroup(item).group.id" class="drop-hint text-label-medium">{{ t('sidebar.dropAgentHere') }}</div>

          <div v-show="creatingSubgroupForId === asGroup(item).group.id" class="subgroup-create-row ga-1 mb-1 pl-8">
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
        </div>
      </template>

      <!-- AGENT LEAF — indentation native via contexte VTreeviewGroup -->
      <template #item="{ item }">
        <div
          class="agent-item"
          draggable="true"
          @dragstart="onAgentDragStart($event, asAgent(item).agent)"
          @contextmenu.prevent="openContextMenuLocal($event, asAgent(item).agent)"
        >
          <v-list-item
            :title="undefined"
            density="compact"
            rounded="lg"
            :active="isAgentSelected(asAgent(item).agent.id)"
            active-color="secondary-container"
            @click="store.toggleAgentFilter(asAgent(item).agent.id)"
          >
            <div class="agent-row">
              <span class="agent-status">
                <!-- v-show sur les 3 états — évite bug Vue codegen v-if/v-else dans slot Vuetify -->
                <v-progress-circular v-show="tabsStore.isAgentActive(asAgent(item).agent.name)" class="status-spinner" indeterminate :size="12" :width="2" :style="{ color: agentAccent(asAgent(item).agent.name) }" />
                <v-icon v-show="hasOpenTerminal(asAgent(item).agent.name) && !tabsStore.isAgentActive(asAgent(item).agent.name)" class="status-pulse" size="12" :style="{ color: agentAccent(asAgent(item).agent.name) }">mdi-circle-medium</v-icon>
                <span v-show="!tabsStore.isAgentActive(asAgent(item).agent.name) && !hasOpenTerminal(asAgent(item).agent.name)" class="status-dot" :style="{ backgroundColor: agentAccent(asAgent(item).agent.name) }" />
              </span>
              <span :class="['agent-name', isAgentSelected(asAgent(item).agent.id) ? 'agent-name--active' : '']">{{ asAgent(item).agent.name }}</span>
              <div class="agent-actions ga-1">
                <span class="drag-handle" :title="t('sidebar.move')"><v-icon size="12">mdi-drag</v-icon></span>
                <v-btn variant="text" density="compact" size="x-small" class="action-btn" :title="t('sidebar.editAgent')" @click.stop="editAgentTarget = asAgent(item).agent"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                <v-btn variant="text" density="compact" size="x-small" class="action-btn action-btn--launch" :style="{ color: agentFg(asAgent(item).agent.name), backgroundColor: agentBg(asAgent(item).agent.name) }" :title="t('sidebar.launchAgent', { name: asAgent(item).agent.name })" @click.stop="openLaunchModal($event, asAgent(item).agent)"><v-icon size="12">mdi-play</v-icon></v-btn>
              </div>
            </div>
          </v-list-item>
        </div>
      </template>
    </v-treeview>

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

      <!-- MD3 v-list + v-list-item for agents -->
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
                <v-progress-circular v-show="tabsStore.isAgentActive(agent.name)" class="status-spinner" indeterminate :size="12" :width="2" :style="{ color: agentAccent(agent.name) }" />
                <v-icon v-show="hasOpenTerminal(agent.name) && !tabsStore.isAgentActive(agent.name)" class="status-pulse" size="12" :style="{ color: agentAccent(agent.name) }">mdi-circle-medium</v-icon>
                <span v-show="!tabsStore.isAgentActive(agent.name) && !hasOpenTerminal(agent.name)" class="status-dot" :style="{ backgroundColor: agentAccent(agent.name) }" />
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

    <!-- Bouton nouveau groupe -->
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
  <ContextMenu v-if="groupContextMenu" :x="groupContextMenu.x" :y="groupContextMenu.y" :items="groupContextMenuItemsFor(groupContextMenu.group)" @close="groupContextMenu = null" />
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

/* v-treeview groups section */
.tree-section {
  margin-bottom: 8px;
}

/* GROUP DnD zone — wraps VTreeviewItem, handles drag events */
.group-dnd-zone {
  border-radius: var(--shape-xs);
  transition: all var(--md-duration-short3) var(--md-easing-standard);
}
.group-dnd-zone.drag-target {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.4);
}

/* GROUP ITEM — inner VTreeviewItem styling */
/* MD3 state layer hover (8% on-surface) */
:deep(.group-item:hover:not(.v-list-item--active)) {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
/* MD3 Label Medium for group names */
.group-name {
  flex: 1;
  font-weight: 500;
  letter-spacing: 0.00625em;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 0;
  color: var(--content-subtle);
}
.rename-input {
  flex: 1;
  min-width: 0;
}

/* Action buttons (rename/delete) — revealed on hover */
.header-btn {
  width: 20px !important;
  min-width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  padding: 0 !important;
  color: var(--content-dim) !important;
  opacity: 0;
  transition: opacity var(--md-duration-short3) var(--md-easing-standard);
}
.header-btn--danger:hover { color: rgb(var(--v-theme-error)) !important; }
/* Reveal header-btn when hovering the DnD zone (outer wrapper) */
.group-dnd-zone:hover .header-btn { opacity: 1; }

/* DROP hint */
.drop-hint {
  margin: 0 4px 4px;
  padding: 4px 0;
  color: rgba(var(--v-theme-primary), 0.7);
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: var(--shape-xs);
}

/* Subgroup creation row */
.subgroup-create-row {
  display: flex;
  align-items: center;
}

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
  min-height: 32px !important;
  font-weight: 500;
  letter-spacing: 0.00625em;
  color: var(--content-subtle) !important;
  user-select: none;
}

/* Agent item styles shared with ungrouped section — defined in main.css */
.no-agents-msg {
  color: var(--content-faint);
}
.add-btn {
  color: var(--content-faint) !important;
  justify-content: flex-start !important;
}
</style>
