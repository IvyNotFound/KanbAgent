<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import { useToast } from '@renderer/composables/useToast'
import LaunchSessionModal from './LaunchSessionModal.vue'
import SettingsModal from './SettingsModal.vue'
import ContextMenu from './ContextMenu.vue'
import CreateAgentModal from './CreateAgentModal.vue'
import AgentEditModal from './AgentEditModal.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import type { Agent, FileNode, Perimetre } from '@renderer/types'

type Section = 'project' | 'perimetres' | 'agents' | 'tree'

const store = useTasksStore()
const tabsStore = useTabsStore()
const { push: pushToast } = useToast()

const launchTarget = ref<Agent | null>(null)
const showCreateAgent = ref(false)
const activeSection = ref<Section | null>('agents')
const renameTarget = ref<Agent | null>(null)
const renameValue = ref('')
const isSettingsOpen = ref(false)

// ── Context menu ──────────────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number; agent: Agent } | null>(null)

// ── Agent edit modal ───────────────────────────────────────────────────────────
const editAgentTarget = ref<Agent | null>(null)

// ── System prompt editor ──────────────────────────────────────────────────────
const systemPromptTarget = ref<Agent | null>(null)
const systemPromptValue = ref('')
const savingPrompt = ref(false)

// ── Périmètre editor ─────────────────────────────────────────────────────────
const editPerimetre = ref<Perimetre | null>(null)
const editPerimetreName = ref('')
const editPerimetreDesc = ref('')
const savingPerimetre = ref(false)

// ── Arborescence ──────────────────────────────────────────────────────────────
const sidebarTree = ref<FileNode[]>([])
const sidebarOpenDirs = ref<string[]>([])
const loadingSidebarTree = ref(false)

async function loadSidebarTree(): Promise<void> {
  if (!store.projectPath) return
  loadingSidebarTree.value = true
  sidebarTree.value = []
  sidebarOpenDirs.value = []
  try {
    const nodes = (await window.electronAPI.fsListDir(store.projectPath)) as FileNode[]
    sidebarTree.value = nodes
    for (const n of nodes) {
      if (n.isDir) sidebarOpenDirs.value.push(n.path)
    }
  } finally {
    loadingSidebarTree.value = false
  }
}

function toggleSidebarDir(path: string): void {
  const idx = sidebarOpenDirs.value.indexOf(path)
  if (idx >= 0) sidebarOpenDirs.value.splice(idx, 1)
  else sidebarOpenDirs.value.push(path)
}

function isDirOpen(path: string): boolean {
  return sidebarOpenDirs.value.includes(path)
}

function flattenTree(nodes: FileNode[], depth = 0): Array<{ node: FileNode; depth: number }> {
  const result: Array<{ node: FileNode; depth: number }> = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.isDir && isDirOpen(node.path) && node.children?.length) {
      result.push(...flattenTree(node.children, depth + 1))
    }
  }
  return result
}

const flatSidebarTree = computed(() => flattenTree(sidebarTree.value))

const sectionTitles: Record<Section, string> = {
  project: 'Projet',
  perimetres: 'Périmètres',
  agents: 'Agents',
  tree: 'Arborescence',
}

function toggleSection(section: Section) {
  const next = activeSection.value === section ? null : section
  activeSection.value = next
  if (next === 'tree' && sidebarTree.value.length === 0) {
    loadSidebarTree()
  }
}

function startRename(event: MouseEvent, agent: Agent) {
  event.stopPropagation()
  renameTarget.value = agent
  renameValue.value = agent.name
}

async function confirmRename() {
  if (!renameTarget.value || !renameValue.value.trim() || !store.dbPath) return
  if (renameValue.value.trim() !== renameTarget.value.name) {
    await window.electronAPI.renameAgent(store.dbPath, renameTarget.value.id, renameValue.value.trim())
    await store.refresh()
  }
  renameTarget.value = null
}

function hasOpenTerminal(agentName: string): boolean {
  return tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === agentName)
}

function openAgentSession(agent: Agent) {
  const existing = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agent.name)
  if (existing) { tabsStore.setActive(existing.id); return }
  launchTarget.value = agent
}

function openLaunchModal(event: MouseEvent, agent: Agent) {
  event.stopPropagation()
  openAgentSession(agent)
}

function openContextMenu(event: MouseEvent, agent: Agent) {
  event.preventDefault()
  event.stopPropagation()
  contextMenu.value = { x: event.clientX, y: event.clientY, agent }
}

function contextMenuItemsFor(agent: Agent): ContextMenuItem[] {
  return [
    {
      label: hasOpenTerminal(agent.name) ? 'Aller à la session' : 'Ouvrir session',
      action: () => openAgentSession(agent)
    },
    {
      label: 'Voir les logs',
      action: () => tabsStore.addLogs(agent.id)
    },
    {
      label: 'Voir ses tâches',
      action: () => store.toggleAgentFilter(agent.id)
    },
    { separator: true, label: '', action: () => {} },
    {
      label: 'Éditer l\'agent',
      action: () => { editAgentTarget.value = agent }
    },
    {
      label: 'Éditer prompt système',
      action: () => openSystemPromptEditor(agent)
    },
  ]
}

function openSystemPromptEditor(agent: Agent) {
  systemPromptTarget.value = agent
  systemPromptValue.value = agent.system_prompt ?? ''
}

async function saveSystemPrompt() {
  if (!systemPromptTarget.value || !store.dbPath) return
  savingPrompt.value = true
  try {
    await window.electronAPI.updateAgentSystemPrompt(
      store.dbPath,
      systemPromptTarget.value.id,
      systemPromptValue.value
    )
    await store.refresh()
  } finally {
    savingPrompt.value = false
    systemPromptTarget.value = null
  }
}

// ── Agents actifs ─────────────────────────────────────────────────────────
// Agent actif = onglet terminal ouvert dans tabsStore pour cet agent
const activeAgents = computed(() =>
  store.agents.filter(a => hasOpenTerminal(a.name))
)

const appVersion = import.meta.env.VITE_APP_VERSION as string ?? '0.0.0'

const projectName = computed(() => {
  if (!store.projectPath) return null
  return store.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? store.projectPath
})

function isAgentSelected(id: number | string): boolean {
  return store.selectedAgentId !== null && Number(store.selectedAgentId) === Number(id)
}

function taskCountFor(perimetre: string): number {
  return store.tasks.filter(t => t.perimetre === perimetre && t.statut !== 'archivé').length
}

function agentCountFor(perimetre: string): number {
  return store.agents.filter(a => a.perimetre === perimetre).length
}

function openEditPerimetre(p: Perimetre) {
  editPerimetre.value = p
  editPerimetreName.value = p.name
  editPerimetreDesc.value = p.description ?? ''
}

async function savePerimetre() {
  if (!editPerimetre.value || !store.dbPath || !editPerimetreName.value.trim()) return
  savingPerimetre.value = true
  try {
    await window.electronAPI.updatePerimetre(
      store.dbPath,
      editPerimetre.value.id,
      editPerimetre.value.name,
      editPerimetreName.value.trim(),
      editPerimetreDesc.value
    )
    await store.refresh()
  } finally {
    savingPerimetre.value = false
    editPerimetre.value = null
  }
}

async function addPerimetre() {
  const confirmed = await window.electronAPI.showConfirmDialog({
    title: 'Ajouter un périmètre',
    message: 'Une session Claude Code va être lancée pour créer le nouveau périmètre.',
    detail: 'L\'agent arch guidera la configuration. Continuer ?',
  })
  if (!confirmed) return
  tabsStore.addTerminal(
    'arch',
    undefined,
    'Tu es l\'agent arch. Crée un nouveau périmètre dans ce projet : mets à jour la table perimetres dans .claude/project.db et le CLAUDE.md si nécessaire. Demande d\'abord le nom et la description du périmètre.'
  )
}

function isLockOld(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 30 * 60 * 1000
}

async function closeProject() {
  const openTerminals = tabsStore.tabs.filter(t => t.type === 'terminal')
  if (openTerminals.length > 0) {
    const n = openTerminals.length
    const confirmed = await window.electronAPI.showConfirmDialog({
      title: 'Fermer le projet',
      message: `${n} session${n > 1 ? 's' : ''} WSL ouverte${n > 1 ? 's' : ''}`,
      detail: 'Toutes les sessions WSL seront fermées. Continuer ?',
    })
    if (!confirmed) return
    tabsStore.closeAllTerminals()
  }
  store.closeProject()
}
</script>

<template>
  <aside class="flex shrink-0 h-full bg-zinc-950">

    <!-- ── Activity Rail (toujours visible, 48px) ── -->
    <div class="w-12 flex flex-col items-center py-2 gap-1 shrink-0 border-r border-zinc-800">

      <!-- Projet -->
      <button
        title="Projet"
        :class="['rail-btn', activeSection === 'project' && 'rail-btn--active']"
        @click="toggleSection('project')"
      >
        <span v-if="activeSection === 'project'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
        </svg>
      </button>

      <!-- Backlog -->
      <button
        title="Backlog"
        :class="['rail-btn', tabsStore.activeTabId === 'backlog' && !activeSection && 'rail-btn--active']"
        @click="tabsStore.setActive('backlog')"
      >
        <span v-if="tabsStore.activeTabId === 'backlog' && !activeSection" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M13.5 1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h3zm-3-1a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2h-3zM2 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zM1 2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2z"/>
        </svg>
      </button>

      <!-- Agents -->
      <button
        title="Agents"
        :class="['rail-btn', activeSection === 'agents' && 'rail-btn--active']"
        @click="toggleSection('agents')"
      >
        <span v-if="activeSection === 'agents'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1h8zm-7.978-1A.261.261 0 0 1 7 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002a.274.274 0 0 1-.014.002H7.022zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm3-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6.936 9.28a5.88 5.88 0 0 0-1.23-.247A7.35 7.35 0 0 0 5 9c-4 0-5 3-5 4 0 .667.333 1 1 1h4.216A2.238 2.238 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816zM4.92 10A5.493 5.493 0 0 0 4 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.276zM1.5 5.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm3-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
        </svg>
      </button>

      <!-- Log -->
      <button
        title="Log"
        :class="['rail-btn', tabsStore.activeTabId === 'logs' && !activeSection && 'rail-btn--active']"
        @click="tabsStore.setActive('logs')"
      >
        <span v-if="tabsStore.activeTabId === 'logs' && !activeSection" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
          <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
        </svg>
      </button>

      <!-- Périmètres -->
      <button
        title="Périmètres"
        :class="['rail-btn', activeSection === 'perimetres' && 'rail-btn--active']"
        @click="toggleSection('perimetres')"
      >
        <span v-if="activeSection === 'perimetres'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M8.235 1.559a.5.5 0 0 0-.47 0l-7.5 4a.5.5 0 0 0 0 .882L3.188 8 .264 9.559a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882L12.813 8l2.922-1.559a.5.5 0 0 0 0-.882l-7.5-4zm3.515 7.008L14.438 10 8 13.433 1.562 10 4.25 8.567l3.515 1.874a.5.5 0 0 0 .47 0l3.515-1.874zM8 9.433 1.562 6 8 2.567 14.438 6 8 9.433z"/>
        </svg>
      </button>

      <!-- Arborescence -->
      <button
        title="Arborescence"
        :class="['rail-btn', activeSection === 'tree' && 'rail-btn--active']"
        @click="toggleSection('tree')"
      >
        <span v-if="activeSection === 'tree'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path fill-rule="evenodd" d="M4.5 11.5A.5.5 0 0 1 5 11h10a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm-2-4A.5.5 0 0 1 3 7h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm-2-4A.5.5 0 0 1 1 3h10a.5.5 0 0 1 0 1H1a.5.5 0 0 1-.5-.5z"/>
        </svg>
      </button>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Paramètres (bas) -->
      <button
        title="Paramètres"
        :class="['rail-btn mb-1', isSettingsOpen && 'rail-btn--active']"
        @click="isSettingsOpen = true"
      >
        <span v-if="activeSection === 'settings'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
        </svg>
      </button>
    </div>

    <!-- ── Panel collapsible ── -->
    <div
      class="overflow-hidden transition-[width] duration-200 ease-in-out"
      :style="{ width: activeSection ? '272px' : '0px' }"
    >
      <div class="w-[272px] h-full flex flex-col bg-zinc-950 border-r border-zinc-800">

        <!-- En-tête du panel -->
        <div class="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <p class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider select-none">
            {{ activeSection ? sectionTitles[activeSection] : '' }}
          </p>
          <button
            class="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Fermer"
            @click="activeSection = null"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- ── Projet ── -->
        <template v-if="activeSection === 'project'">
          <div class="px-4 py-3">
            <div class="flex items-center justify-between gap-2">
              <button
                class="flex-1 min-w-0 text-left group transition-colors"
                :title="store.projectPath ?? 'Sélectionner un projet'"
                @click="store.selectProject()"
              >
                <span
                  :class="[
                    'block text-sm font-medium truncate transition-colors',
                    store.projectPath
                      ? 'text-zinc-200 group-hover:text-white'
                      : 'text-zinc-500 group-hover:text-zinc-300 italic'
                  ]"
                >{{ projectName ?? 'Sélectionner…' }}</span>
                <span
                  v-if="store.dbPath"
                  class="block text-xs text-zinc-500 group-hover:text-zinc-400 truncate mt-0.5 font-mono transition-colors"
                  :title="store.dbPath"
                >{{ store.dbPath.split(/[\\/]/).slice(-2).join('/') }}</span>
                <span
                  v-else-if="store.projectPath && !store.dbPath"
                  class="block text-xs text-amber-500/70 mt-0.5 font-mono"
                >init en cours…</span>
              </button>
              <button
                v-if="store.projectPath"
                class="shrink-0 w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors text-xs"
                title="Fermer le projet"
                @click="closeProject"
              >✕</button>
            </div>
          </div>
          <div v-if="store.error" class="mx-4 mb-3 px-3 py-2 bg-red-950/40 border border-red-800/50 rounded-md">
            <p class="text-xs text-red-400 break-all">{{ store.error }}</p>
          </div>
          <div class="flex-1" />
          <div class="px-4 py-2 border-t border-zinc-800">
            <p class="text-xs text-zinc-600 font-mono">v{{ appVersion }}</p>
          </div>
        </template>

        <!-- ── Périmètres ── -->
        <template v-else-if="activeSection === 'perimetres'">
          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-1">
            <div class="flex items-center justify-between mb-2">
              <p class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Filtrer le backlog</p>
              <button
                v-if="store.selectedPerimetre !== null"
                class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                @click="store.selectedPerimetre = null"
              >reset</button>
            </div>

            <!-- Liste des périmètres depuis la DB -->
            <div
              v-for="p in store.perimetresData"
              :key="p.id"
              class="group rounded-md"
            >
              <!-- Bloc principal -->
              <div class="relative">
                <button
                  :class="[
                    'w-full text-left px-2 py-2 rounded-md transition-colors pr-8',
                    store.selectedPerimetre === p.name ? 'ring-1 ring-zinc-600' : 'hover:bg-zinc-900'
                  ]"
                  :style="store.selectedPerimetre === p.name ? { backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) } : {}"
                  @click="store.togglePerimetreFilter(p.name)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-mono truncate font-medium" :style="{ color: agentFg(p.name) }">{{ p.name }}</span>
                    <div class="flex items-center gap-1 shrink-0">
                      <span
                        v-if="agentCountFor(p.name) > 0"
                        class="text-[10px] font-mono px-1 py-0.5 rounded"
                        :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name) }"
                        :title="`${agentCountFor(p.name)} agent(s)`"
                      >{{ agentCountFor(p.name) }}ag</span>
                      <span
                        v-if="taskCountFor(p.name) > 0"
                        class="text-[10px] font-mono px-1 py-0.5 rounded"
                        :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name) }"
                        :title="`${taskCountFor(p.name)} tâche(s) actives`"
                      >{{ taskCountFor(p.name) }}t</span>
                    </div>
                  </div>
                  <p v-if="p.description" class="text-[10px] text-zinc-600 truncate mt-0.5">{{ p.description }}</p>
                </button>
                <!-- Bouton edit au hover -->
                <button
                  class="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-700 transition-colors opacity-0 group-hover:opacity-100"
                  title="Modifier"
                  @click.stop="openEditPerimetre(p)"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
                    <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                  </svg>
                </button>
              </div>
            </div>

            <div v-if="store.perimetresData.length === 0" class="text-sm text-zinc-600 px-2 py-2">Aucun périmètre</div>

            <!-- Bouton ajouter -->
            <button
              class="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
              @click="addPerimetre"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
              </svg>
              Ajouter un périmètre
            </button>
          </div>
        </template>

        <!-- ── Agents ── -->
        <template v-else-if="activeSection === 'agents'">
          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3">
            <div class="flex items-center justify-between mb-3">
              <p class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Filtrer le backlog</p>
              <div class="flex items-center gap-2">
                <button
                  v-if="store.selectedAgentId !== null"
                  class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  @click="store.selectedAgentId = null"
                >reset</button>
                <button
                  class="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                  title="Nouvel agent"
                  @click="showCreateAgent = true"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
                    <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="space-y-0.5">
              <div
                v-for="agent in store.agents"
                :key="agent.id"
                class="group"
                @contextmenu.prevent="openContextMenu($event, agent)"
              >
                <!-- Ligne principale -->
                <div class="relative">
                  <button
                    :class="[
                      'w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors cursor-pointer pr-[84px]',
                      isAgentSelected(agent.id) ? 'bg-zinc-800 ring-1 ring-zinc-600' : 'hover:bg-zinc-900'
                    ]"
                    @click="store.toggleAgentFilter(agent.id)"
                  >
                    <!-- Indicateur de statut -->
                    <span class="relative shrink-0 flex items-center justify-center w-4 h-4">
                      <svg
                        v-if="tabsStore.isAgentActive(agent.name)"
                        class="w-3.5 h-3.5 animate-spin"
                        viewBox="0 0 16 16" fill="none"
                        :style="{ color: agentFg(agent.name) }"
                      >
                        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
                        <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                      <svg
                        v-else-if="hasOpenTerminal(agent.name) && !tabsStore.isAgentActive(agent.name)"
                        class="w-3.5 h-3.5 animate-pulse"
                        viewBox="0 0 14 14" fill="none"
                        :style="{ color: agentFg(agent.name) }"
                      >
                        <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="2"/>
                        <circle cx="7" cy="7" r="2" fill="currentColor"/>
                      </svg>
                      <span
                        v-else
                        class="w-2.5 h-2.5 rounded-full"
                        :style="{ backgroundColor: agentFg(agent.name) }"
                      />
                    </span>
                    <span
                      :class="['text-sm truncate font-mono', isAgentSelected(agent.id) ? 'text-zinc-100' : 'text-zinc-400']"
                    >{{ agent.name }}</span>
                  </button>
                  <!-- Toolbar actions : edit / run -->
                  <div class="absolute right-1 top-1/2 -translate-y-1/2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <!-- edit / rename -->
                    <button
                      class="w-6 h-6 flex items-center justify-center rounded transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700"
                      title="Renommer"
                      @click="startRename($event, agent)"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
                        <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                      </svg>
                    </button>
                    <!-- run -->
                    <button
                      class="w-6 h-6 flex items-center justify-center rounded transition-colors"
                      :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }"
                      :title="`Lancer ${agent.name}`"
                      @click="openLaunchModal($event, agent)"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
                        <path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="store.agents.length === 0" class="text-sm text-zinc-600 px-2 py-2">Aucun agent</div>
            </div>
          </div>
        </template>

        <!-- ── Arborescence ── -->
        <template v-else-if="activeSection === 'tree'">
          <div class="flex-1 overflow-y-auto min-h-0 py-1 min-w-0">
            <div v-if="loadingSidebarTree" class="flex items-center justify-center py-6">
              <span class="text-xs text-zinc-600 animate-pulse">Chargement…</span>
            </div>
            <div v-else-if="!store.projectPath" class="px-4 py-3 text-xs text-zinc-600">
              Aucun projet ouvert
            </div>
            <div v-else-if="flatSidebarTree.length === 0 && !loadingSidebarTree" class="px-4 py-3 text-xs text-zinc-600">
              Dossier vide
            </div>
            <button
              v-for="item in flatSidebarTree"
              :key="item.node.path"
              class="w-full flex items-center gap-2 py-1 text-left text-sm transition-colors rounded pr-2 group"
              :class="item.node.isDir ? 'hover:bg-zinc-800/70' : 'hover:bg-zinc-800/50'"
              :style="{ paddingLeft: `${6 + item.depth * 12}px` }"
              @click="item.node.isDir ? toggleSidebarDir(item.node.path) : tabsStore.openFile(item.node.path, item.node.name)"
            >
              <!-- Icône dossier ouvert/fermé ou fichier -->
              <svg v-if="item.node.isDir && isDirOpen(item.node.path)" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-amber-400">
                <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2H6a1 1 0 0 1 .8.4L7.5 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V3.5z"/>
              </svg>
              <svg v-else-if="item.node.isDir" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-amber-500/70">
                <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a2 2 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
              </svg>
              <svg v-else viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-zinc-500 group-hover:text-zinc-400">
                <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2L9.5 1.5z"/>
              </svg>
              <!-- Nom -->
              <span
                class="truncate font-mono"
                :class="item.node.isDir
                  ? 'text-zinc-200 font-medium group-hover:text-white'
                  : 'text-zinc-400 group-hover:text-zinc-200'"
              >{{ item.node.name }}</span>
            </button>
          </div>
          <div class="px-4 py-2 border-t border-zinc-800 shrink-0 flex items-center justify-between">
            <button
              class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              @click="loadSidebarTree"
            >↺ Actualiser</button>
          </div>
        </template>

        <!-- ── Paramètres (removed - now in modal) ── -->

        <!-- ── Stats tâches (permanent bas) ── -->
        <div v-if="store.projectPath" class="shrink-0 border-t border-zinc-800 px-3 py-2">
          <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Tâches</p>
          <div class="grid grid-cols-4 gap-1 text-center">
            <div>
              <p class="text-[13px] font-mono font-semibold text-amber-400 leading-none">{{ store.stats.a_faire }}</p>
              <p class="text-[9px] text-zinc-600 mt-0.5 leading-tight">à faire</p>
            </div>
            <div>
              <p class="text-[13px] font-mono font-semibold text-emerald-400 leading-none">{{ store.stats.en_cours }}</p>
              <p class="text-[9px] text-zinc-600 mt-0.5 leading-tight">en cours</p>
            </div>
            <div>
              <p class="text-[13px] font-mono font-semibold text-zinc-400 leading-none">{{ store.stats.terminé }}</p>
              <p class="text-[9px] text-zinc-600 mt-0.5 leading-tight">terminé</p>
            </div>
            <div>
              <p class="text-[13px] font-mono font-semibold text-violet-400 leading-none">{{ store.stats.archivé }}</p>
              <p class="text-[9px] text-zinc-600 mt-0.5 leading-tight">archivé</p>
            </div>
          </div>
        </div>

        <!-- ── Agents actifs (permanent bas) ── -->
        <div v-if="activeAgents.length > 0" class="shrink-0 border-t border-zinc-800 px-3 py-2">
          <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            Sessions ouvertes
            <span class="text-zinc-700 font-mono">({{ activeAgents.length }})</span>
          </p>
          <div class="space-y-1.5">
            <div
              v-for="agent in activeAgents"
              :key="agent.id"
              class="flex items-center gap-2 min-w-0 cursor-pointer group/active"
              @click="() => { const t = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agent.name); if (t) tabsStore.setActive(t.id) }"
            >
              <!-- Indicateur : spinning si activité PTY, pulsing sinon -->
              <span class="relative shrink-0 w-2 h-2 flex items-center justify-center">
                <svg
                  v-if="tabsStore.isAgentActive(agent.name)"
                  class="w-2 h-2 animate-spin"
                  viewBox="0 0 10 10" fill="none"
                  :style="{ color: agentFg(agent.name) }"
                >
                  <circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.25"/>
                  <path d="M5 1a4 4 0 0 1 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <span
                  v-else
                  class="w-1.5 h-1.5 rounded-full animate-pulse"
                  :style="{ backgroundColor: agentFg(agent.name) }"
                />
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-[11px] font-mono truncate font-medium group-hover/active:underline" :style="{ color: agentFg(agent.name) }">{{ agent.name }}</p>
                <p class="text-[10px] truncate" :class="tabsStore.isAgentActive(agent.name) ? 'text-emerald-600' : 'text-zinc-600'">
                  {{ tabsStore.isAgentActive(agent.name) ? 'en activité' : 'en attente' }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Locks actifs (permanent bas) ── -->
        <div v-if="store.locks.length > 0" class="shrink-0 border-t border-zinc-800 px-3 py-2">
          <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0 text-zinc-600">
              <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
            </svg>
            Locks actifs
            <span class="text-zinc-700 font-mono">({{ store.locks.length }})</span>
          </p>
          <div class="space-y-1">
            <div
              v-for="lock in store.locks"
              :key="lock.id"
              class="min-w-0"
              :title="`${lock.fichier} — ${lock.agent_name}`"
            >
              <p
                class="text-[11px] font-mono truncate"
                :class="isLockOld(lock.created_at) ? 'text-red-400' : 'text-zinc-400'"
              >{{ lock.fichier.split('/').pop() }}</p>
              <p class="text-[10px] text-zinc-600 truncate">{{ lock.agent_name }}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  </aside>

  <!-- Modal lancement de session -->
  <LaunchSessionModal
    v-if="launchTarget"
    :agent="launchTarget"
    @close="launchTarget = null"
  />

  <!-- Modal paramètres -->
  <SettingsModal
    v-if="isSettingsOpen"
    @close="isSettingsOpen = false"
  />

  <!-- Modal création agent -->
  <CreateAgentModal
    v-if="showCreateAgent"
    @close="showCreateAgent = false"
    @created="store.refresh()"
    @toast="(msg, type) => pushToast(msg, type === 'success' ? 'info' : 'error')"
  />

  <!-- Modal édition agent -->
  <AgentEditModal
    v-if="editAgentTarget"
    :agent="editAgentTarget"
    @close="editAgentTarget = null"
    @saved="editAgentTarget = null"
  />

  <!-- Context menu clic droit agent -->
  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="contextMenuItemsFor(contextMenu.agent)"
    @close="contextMenu = null"
  />

  <!-- Modal édition prompt système -->
  <Teleport to="body">
    <div
      v-if="systemPromptTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="systemPromptTarget = null"
    >
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 w-[480px] flex flex-col gap-4">
        <div>
          <p class="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-0.5">Prompt système</p>
          <p class="text-sm font-mono font-semibold" :style="{ color: agentFg(systemPromptTarget.name) }">
            {{ systemPromptTarget.name }}
          </p>
        </div>
        <textarea
          v-model="systemPromptValue"
          rows="10"
          placeholder="Prompt système de l'agent (instructions permanentes)…"
          class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs font-mono text-zinc-200 placeholder-zinc-600 resize-none outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors leading-relaxed"
        />
        <div class="flex items-center gap-1.5 -mt-1">
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 text-zinc-600 shrink-0">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
          </svg>
          <span class="text-[10px] text-zinc-600">Le suffixe de protocole est injecté automatiquement et n'est pas modifiable ici.</span>
        </div>
        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 text-xs rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            @click="systemPromptTarget = null"
          >Annuler</button>
          <button
            class="px-3 py-1.5 text-xs rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40"
            :disabled="savingPrompt"
            @click="saveSystemPrompt"
          >{{ savingPrompt ? 'Enregistrement…' : 'Enregistrer' }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Modal édition périmètre -->
  <Teleport to="body">
    <div
      v-if="editPerimetre"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="editPerimetre = null"
    >
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 w-96 flex flex-col gap-3">
        <p class="text-sm font-semibold text-zinc-200">Modifier le périmètre</p>
        <div>
          <label class="text-xs text-zinc-500 uppercase tracking-wider font-semibold block mb-1">Nom</label>
          <input
            v-model="editPerimetreName"
            class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500"
            placeholder="nom-du-perimetre"
            @keydown.esc="editPerimetre = null"
          />
        </div>
        <div>
          <label class="text-xs text-zinc-500 uppercase tracking-wider font-semibold block mb-1">Description</label>
          <input
            v-model="editPerimetreDesc"
            class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-violet-500"
            placeholder="Description courte…"
            @keydown.enter="savePerimetre"
            @keydown.esc="editPerimetre = null"
          />
        </div>
        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 text-xs rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            @click="editPerimetre = null"
          >Annuler</button>
          <button
            class="px-3 py-1.5 text-xs rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40"
            :disabled="savingPerimetre || !editPerimetreName.trim()"
            @click="savePerimetre"
          >{{ savingPerimetre ? 'Enregistrement…' : 'Enregistrer' }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Popup renommage agent -->
  <Teleport to="body">
    <div
      v-if="renameTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="renameTarget = null"
    >
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 w-80">
        <p class="text-sm font-semibold text-zinc-200 mb-3">Renommer l'agent</p>
        <input
          v-model="renameValue"
          class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="Nouveau nom"
          autofocus
          @keydown.enter="confirmRename"
          @keydown.esc="renameTarget = null"
        />
        <div class="flex gap-2 mt-3 justify-end">
          <button
            class="px-3 py-1.5 text-xs rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            @click="renameTarget = null"
          >Annuler</button>
          <button
            class="px-3 py-1.5 text-xs rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            @click="confirmRename"
          >Renommer</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rail-btn {
  @apply relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800;
}
.rail-btn--active {
  @apply text-white bg-zinc-700;
}
.rail-indicator {
  @apply absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-white rounded-r;
}
</style>
