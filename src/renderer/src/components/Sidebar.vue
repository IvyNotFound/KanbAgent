<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import { useToast } from '@renderer/composables/useToast'
import LaunchSessionModal from './LaunchSessionModal.vue'
import SettingsModal from './SettingsModal.vue'
import ContextMenu from './ContextMenu.vue'
import CreateAgentModal from './CreateAgentModal.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import type { Agent, AgentLog, FileNode, Perimetre } from '@renderer/types'

type Section = 'project' | 'perimetres' | 'agents' | 'tree' | 'backlog' | 'logs'

const { t } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()
const { push: pushToast } = useToast()

const launchTarget = ref<Agent | null>(null)
const showCreateAgent = ref(false)
const activeSection = ref<Section | null>('agents')
const isSettingsOpen = ref(false)

// ── Context menu ──────────────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number; agent: Agent } | null>(null)

// ── Agent edit modal ───────────────────────────────────────────────────────────
const editAgentTarget = ref<Agent | null>(null)

// ── Périmètre editor ─────────────────────────────────────────────────────────
const editPerimetre = ref<Perimetre | null>(null)
const editPerimetreName = ref('')
const editPerimetreDesc = ref('')
const savingPerimetre = ref(false)

// ── Arborescence ──────────────────────────────────────────────────────────────
const sidebarTree = ref<FileNode[]>([])
const sidebarOpenDirs = ref(new Set<string>())
const loadingSidebarTree = ref(false)

async function loadSidebarTree(): Promise<void> {
  if (!store.projectPath) return
  loadingSidebarTree.value = true
  sidebarTree.value = []
  sidebarOpenDirs.value = new Set()
  try {
    const nodes = (await window.electronAPI.fsListDir(store.projectPath, store.projectPath)) as FileNode[]
    sidebarTree.value = nodes
    const dirs = new Set<string>()
    for (const n of nodes) {
      if (n.isDir) dirs.add(n.path)
    }
    sidebarOpenDirs.value = dirs
  } finally {
    loadingSidebarTree.value = false
  }
}

function toggleSidebarDir(path: string): void {
  const next = new Set(sidebarOpenDirs.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  sidebarOpenDirs.value = next
}

function isDirOpen(path: string): boolean {
  return sidebarOpenDirs.value.has(path)
}

function flattenTree(nodes: FileNode[], depth = 0, result: Array<{ node: FileNode; depth: number }> = []): Array<{ node: FileNode; depth: number }> {
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.isDir && isDirOpen(node.path) && node.children?.length) {
      flattenTree(node.children, depth + 1, result)
    }
  }
  return result
}

const flatSidebarTree = computed(() => flattenTree(sidebarTree.value))

const sectionTitles = computed((): Record<Section, string> => ({
  project: t('sidebar.project'),
  perimetres: t('sidebar.perimeters'),
  agents: t('sidebar.agents'),
  tree: t('sidebar.tree'),
  backlog: t('sidebar.backlog'),
  logs: t('sidebar.logs'),
}))

// ── Sidebar logs ───────────────────────────────────────────────────────────────
const sidebarLogs = ref<AgentLog[]>([])

async function fetchSidebarLogs(): Promise<void> {
  if (!store.dbPath) return
  try {
    const result = await window.electronAPI.queryDb(
      store.dbPath,
      `SELECT l.id, l.session_id, l.agent_id, a.name as agent_name, a.type as agent_type,
              l.niveau, l.action, l.detail, l.fichiers, l.created_at
       FROM agent_logs l
       LEFT JOIN agents a ON a.id = l.agent_id
       ORDER BY l.created_at DESC LIMIT 20`
    )
    if (!Array.isArray(result)) {
      sidebarLogs.value = []
      return
    }
    sidebarLogs.value = result as AgentLog[]
  } catch { /* silent */ }
}

// Event-driven refresh — replaces 3s polling (was 20 IPC/min)
const unsubLogs = window.electronAPI.onDbChanged(() => {
  if (activeSection.value === 'logs') fetchSidebarLogs()
})
onUnmounted(() => unsubLogs())
watch(() => activeSection.value === 'logs', (active) => {
  if (active) fetchSidebarLogs()
}, { immediate: true })

function formatRelativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}j`
}

function toggleSection(section: Section) {
  const next = activeSection.value === section ? null : section
  activeSection.value = next
  if (next === 'tree' && sidebarTree.value.length === 0) {
    loadSidebarTree()
  }
}

const openTerminalAgents = computed(() => {
  const set = new Set<string>()
  for (const t of tabsStore.tabs) {
    if (t.type === 'terminal' && t.agentName) set.add(t.agentName)
  }
  return set
})

function hasOpenTerminal(agentName: string): boolean {
  return openTerminalAgents.value.has(agentName)
}

const MULTI_INSTANCE_TYPES = ['review']

function openAgentSession(agent: Agent) {
  if (!MULTI_INSTANCE_TYPES.includes(agent.type)) {
    const existing = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agent.name)
    if (existing) { tabsStore.setActive(existing.id); return }
  }
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
      label: MULTI_INSTANCE_TYPES.includes(agent.type)
        ? 'Nouvelle session'
        : (hasOpenTerminal(agent.name) ? 'Aller à la session' : 'Ouvrir session'),
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
  ]
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

const taskCountByPerimetre = computed(() => {
  const map = new Map<string, number>()
  for (const t of store.tasks) {
    if (t.statut !== 'archived' && t.perimetre) {
      map.set(t.perimetre, (map.get(t.perimetre) ?? 0) + 1)
    }
  }
  return map
})

const agentCountByPerimetre = computed(() => {
  const map = new Map<string, number>()
  for (const a of store.agents) {
    if (a.perimetre) {
      map.set(a.perimetre, (map.get(a.perimetre) ?? 0) + 1)
    }
  }
  return map
})

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
  <aside class="flex shrink-0 h-full bg-surface-base">

    <!-- ── Activity Rail (toujours visible, 48px) ── -->
    <div class="w-12 flex flex-col items-center py-2 gap-1 shrink-0 border-r border-edge-subtle">

      <!-- Backlog -->
      <button
        :title="t('sidebar.backlog')"
        :class="['rail-btn', activeSection === 'backlog' && 'rail-btn--active']"
        @click="toggleSection('backlog')"
      >
        <span v-if="activeSection === 'backlog'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <rect x="1"  y="2" width="4" height="12" rx="1.5"/>
          <rect x="6"  y="2" width="4" height="8"  rx="1.5"/>
          <rect x="11" y="2" width="4" height="5"  rx="1.5"/>
        </svg>
      </button>

      <!-- Log -->
      <button
        :title="t('sidebar.logs')"
        :class="['rail-btn', activeSection === 'logs' && 'rail-btn--active']"
        @click="toggleSection('logs')"
      >
        <span v-if="activeSection === 'logs'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
          <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
        </svg>
      </button>

      <!-- Divider -->
      <hr class="border-edge-subtle w-6 my-0.5">

      <!-- Projet -->
      <button
        :title="t('sidebar.project')"
        :class="['rail-btn', activeSection === 'project' && 'rail-btn--active']"
        @click="toggleSection('project')"
      >
        <span v-if="activeSection === 'project'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
        </svg>
      </button>

      <!-- Agents -->
      <button
        :title="t('sidebar.agents')"
        :class="['rail-btn', activeSection === 'agents' && 'rail-btn--active']"
        @click="toggleSection('agents')"
      >
        <span v-if="activeSection === 'agents'" class="rail-indicator" />
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-[18px] h-[18px]">
          <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1h8zm-7.978-1A.261.261 0 0 1 7 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002a.274.274 0 0 1-.014.002H7.022zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm3-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6.936 9.28a5.88 5.88 0 0 0-1.23-.247A7.35 7.35 0 0 0 5 9c-4 0-5 3-5 4 0 .667.333 1 1 1h4.216A2.238 2.238 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816zM4.92 10A5.493 5.493 0 0 0 4 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.276zM1.5 5.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm3-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
        </svg>
      </button>

      <!-- Périmètres -->
      <button
        :title="t('sidebar.perimeters')"
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
        :title="t('sidebar.tree')"
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
        :title="t('sidebar.settings')"
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
      <div class="w-[272px] h-full flex flex-col bg-surface-base border-r border-edge-subtle">

        <!-- En-tête du panel -->
        <div class="px-4 py-2.5 border-b border-edge-subtle flex items-center justify-between shrink-0">
          <p class="text-[11px] font-semibold text-content-subtle uppercase tracking-wider select-none">
            {{ activeSection ? sectionTitles[activeSection] : '' }}
          </p>
          <button
            class="w-5 h-5 flex items-center justify-center rounded text-content-faint hover:text-content-tertiary hover:bg-surface-secondary transition-colors"
            :title="t('sidebar.close')"
            @click="activeSection = null"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- ── Backlog ── -->
        <template v-if="activeSection === 'backlog'">
          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-3">

            <!-- Compteurs -->
            <div class="flex items-center gap-2">
              <span class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-amber-100 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/40 text-amber-700 dark:text-amber-400">
                {{ store.tasksByStatus.todo.length }} {{ t('sidebar.todo') }}
              </span>
              <span class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400">
                {{ store.tasksByStatus.in_progress.length }} {{ t('sidebar.inProgress') }}
              </span>
              <span class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-surface-secondary border border-edge-default text-content-muted">
                {{ store.tasksByStatus.done.length }} {{ t('sidebar.done') }}
              </span>
            </div>

            <!-- En cours -->
            <div v-if="store.tasksByStatus.in_progress.length > 0">
              <p class="text-xs font-semibold text-content-subtle uppercase tracking-wider mb-2">{{ t('columns.in_progress') }}</p>
              <div class="space-y-1.5">
                <button
                  v-for="task in store.tasksByStatus.in_progress"
                  :key="task.id"
                  class="w-full text-left px-2 py-2 rounded-md hover:bg-surface-secondary transition-colors group"
                  @click="store.openTask(task)"
                >
                  <div class="flex items-start justify-between gap-1 min-w-0">
                    <span class="text-sm text-content-tertiary truncate leading-snug group-hover:text-content-primary transition-colors" :title="task.titre">{{ task.titre }}</span>
                    <span class="text-[10px] text-content-faint font-mono shrink-0">#{{ task.id }}</span>
                  </div>
                  <span v-if="task.agent_name" class="text-xs font-mono" :style="{ color: agentFg(task.agent_name) }">{{ task.agent_name }}</span>
                </button>
              </div>
            </div>

            <!-- À faire (5 premières) -->
            <div v-if="store.tasksByStatus.todo.length > 0">
              <p class="text-xs font-semibold text-content-subtle uppercase tracking-wider mb-2">{{ t('columns.todo') }}</p>
              <div class="space-y-1.5">
                <button
                  v-for="task in store.tasksByStatus.todo.slice(0, 5)"
                  :key="task.id"
                  class="w-full text-left px-2 py-2 rounded-md hover:bg-surface-secondary transition-colors group"
                  @click="store.openTask(task)"
                >
                  <div class="flex items-start justify-between gap-1 min-w-0">
                    <span class="text-sm text-content-muted truncate leading-snug group-hover:text-content-secondary transition-colors" :title="task.titre">{{ task.titre }}</span>
                    <span class="text-[10px] text-content-faint font-mono shrink-0">#{{ task.id }}</span>
                  </div>
                  <span v-if="task.agent_name" class="text-xs font-mono" :style="{ color: agentFg(task.agent_name) }">{{ task.agent_name }}</span>
                </button>
              </div>
            </div>

            <!-- Empty state -->
            <div v-if="store.tasksByStatus.in_progress.length === 0 && store.tasksByStatus.todo.length === 0"
              class="flex items-center justify-center py-8">
              <p class="text-xs text-content-faint italic">{{ t('sidebar.noActiveTasks') }}</p>
            </div>

            <!-- Lien board -->
            <button
              class="mt-auto text-xs text-content-faint hover:text-content-tertiary transition-colors text-left"
              @click="tabsStore.setActive('backlog'); activeSection = null"
            >{{ t('sidebar.seeBoard') }}</button>
          </div>
        </template>

        <!-- ── Logs ── -->
        <template v-else-if="activeSection === 'logs'">
          <div class="flex-1 overflow-y-auto min-h-0 px-3 py-3 flex flex-col gap-1">
            <div v-if="sidebarLogs.length === 0" class="flex items-center justify-center py-8">
              <p class="text-xs text-content-faint italic">{{ t('sidebar.noLogs') }}</p>
            </div>
            <div
              v-for="log in sidebarLogs"
              :key="log.id"
              class="flex flex-col gap-0.5 px-2 py-1.5 rounded-md hover:bg-surface-secondary/60 transition-colors"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <span :class="[
                  'text-[9px] font-bold uppercase tracking-wide shrink-0 px-1 rounded',
                  log.niveau === 'error' ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400' :
                  log.niveau === 'warn'  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400' :
                  log.niveau === 'debug' ? 'bg-surface-secondary text-content-faint' :
                  'bg-surface-secondary text-content-subtle'
                ]">{{ log.niveau }}</span>
                <span v-if="log.agent_name" class="text-[10px] font-mono shrink-0" :style="{ color: agentFg(log.agent_name) }">{{ log.agent_name }}</span>
                <span class="text-[10px] text-content-faint font-mono ml-auto shrink-0">{{ formatRelativeTime(log.created_at) }}</span>
              </div>
              <p class="text-[11px] text-content-muted truncate">{{ log.action }}<span v-if="log.detail" class="text-content-faint"> — {{ log.detail }}</span></p>
            </div>
            <!-- Lien logs complets -->
            <button
              class="mt-2 text-xs text-content-faint hover:text-content-tertiary transition-colors text-left px-2"
              @click="tabsStore.setActive('logs'); activeSection = null"
            >{{ t('sidebar.seeLogs') }}</button>
          </div>
        </template>

        <!-- ── Projet ── -->
        <template v-else-if="activeSection === 'project'">
          <div class="px-4 py-3">
            <div class="flex items-center justify-between gap-2">
              <button
                class="flex-1 min-w-0 text-left group transition-colors"
                :title="store.projectPath ?? t('sidebar.selectProject')"
                @click="store.selectProject()"
              >
                <span
                  :class="[
                    'block text-sm font-medium truncate transition-colors',
                    store.projectPath
                      ? 'text-content-secondary group-hover:text-content-primary'
                      : 'text-content-subtle group-hover:text-content-tertiary italic'
                  ]"
                >{{ projectName ?? t('sidebar.select') }}</span>
                <span
                  v-if="store.dbPath"
                  class="block text-xs text-content-subtle group-hover:text-content-muted truncate mt-0.5 font-mono transition-colors"
                  :title="store.dbPath"
                >{{ store.dbPath.split(/[\\/]/).slice(-2).join('/') }}</span>
                <span
                  v-else-if="store.projectPath && !store.dbPath"
                  class="block text-xs text-amber-500/70 mt-0.5 font-mono"
                >{{ t('sidebar.initializing') }}</span>
              </button>
              <button
                v-if="store.projectPath"
                class="shrink-0 w-6 h-6 flex items-center justify-center rounded text-content-faint hover:text-content-tertiary hover:bg-surface-secondary transition-colors text-xs"
                :title="t('sidebar.closeProject')"
                @click="closeProject"
              >✕</button>
            </div>
          </div>
          <div v-if="store.error" class="mx-4 mb-3 px-3 py-2 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800/50 rounded-md">
            <p class="text-xs text-red-700 dark:text-red-400 break-all">{{ store.error }}</p>
          </div>
          <div class="flex-1" />
          <div class="px-4 py-2 border-t border-edge-subtle">
            <p class="text-xs text-content-faint font-mono">v{{ appVersion }}</p>
          </div>
        </template>

        <!-- ── Périmètres ── -->
        <template v-else-if="activeSection === 'perimetres'">
          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-1">
            <div class="flex items-center justify-between mb-2">
              <p class="text-[11px] font-semibold text-content-subtle uppercase tracking-wider">{{ t('sidebar.perimeters') }}</p>
              <button
                v-if="store.selectedPerimetre !== null"
                class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                @click="store.selectedPerimetre = null"
              >{{ t('sidebar.reset') }}</button>
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
                    store.selectedPerimetre === p.name ? 'ring-1 ring-content-faint' : 'hover:bg-surface-primary'
                  ]"
                  :style="store.selectedPerimetre === p.name ? { backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) } : {}"
                  @click="store.togglePerimetreFilter(p.name)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-mono truncate font-medium" :style="{ color: agentFg(p.name) }">{{ p.name }}</span>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <span
                        v-if="(agentCountByPerimetre.get(p.name) ?? 0) > 0"
                        class="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border"
                        :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }"
                        :title="t('sidebar.nbAgents', agentCountByPerimetre.get(p.name) ?? 0, { named: { n: agentCountByPerimetre.get(p.name) ?? 0 } })"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0">
                          <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>
                        </svg>
                        {{ agentCountByPerimetre.get(p.name) ?? 0 }}
                      </span>
                      <span
                        v-if="(taskCountByPerimetre.get(p.name) ?? 0) > 0"
                        class="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border"
                        :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }"
                        :title="t('sidebar.nbActiveTasks', taskCountByPerimetre.get(p.name) ?? 0, { named: { n: taskCountByPerimetre.get(p.name) ?? 0 } })"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0">
                          <path d="M2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zm3 0a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8zm0 4a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8zm0 4a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8zm-3-4a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zm0 4a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1z"/>
                        </svg>
                        {{ taskCountByPerimetre.get(p.name) ?? 0 }}
                      </span>
                    </div>
                  </div>
                  <p v-if="p.description" class="text-[10px] text-content-faint truncate mt-0.5">{{ p.description }}</p>
                </button>
                <!-- Bouton edit au hover -->
                <button
                  class="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-content-faint hover:text-content-secondary hover:bg-surface-tertiary transition-colors opacity-0 group-hover:opacity-100"
                  title="Modifier"
                  @click.stop="openEditPerimetre(p)"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
                    <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                  </svg>
                </button>
              </div>
            </div>

            <div v-if="store.perimetresData.length === 0" class="text-sm text-content-faint px-2 py-2">{{ t('sidebar.noPerimeter') }}</div>

            <!-- Bouton ajouter -->
            <button
              class="mt-2 flex items-center gap-2 px-2 py-2 rounded-md text-xs text-content-faint hover:text-content-tertiary hover:bg-surface-primary transition-colors w-full"
              @click="addPerimetre"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
              </svg>
              {{ t('sidebar.addPerimeter') }}
            </button>
          </div>
        </template>

        <!-- ── Agents ── -->
        <template v-else-if="activeSection === 'agents'">
          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3">
            <div class="flex items-center justify-between mb-3">
              <p class="text-[11px] font-semibold text-content-subtle uppercase tracking-wider">{{ t('sidebar.agents') }}</p>
              <div class="flex items-center gap-2">
                <button
                  v-if="store.selectedAgentId !== null"
                  class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  @click="store.selectedAgentId = null"
                >{{ t('sidebar.reset') }}</button>
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
                      isAgentSelected(agent.id) ? 'bg-surface-secondary ring-1 ring-content-faint' : 'hover:bg-surface-primary'
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
                      :class="['text-sm truncate font-mono', isAgentSelected(agent.id) ? 'text-content-primary' : 'text-content-muted']"
                    >{{ agent.name }}</span>
                  </button>
                  <!-- Toolbar actions : edit / run -->
                  <div class="absolute right-1 top-1/2 -translate-y-1/2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <!-- edit agent -->
                    <button
                      class="w-6 h-6 flex items-center justify-center rounded transition-colors text-content-subtle hover:text-content-secondary hover:bg-surface-tertiary"
                      :title="t('sidebar.editAgent')"
                      @click.stop="editAgentTarget = agent"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
                        <path d="M9.5 1.5a2.121 2.121 0 0 1 3 3L4 13H1v-3L9.5 1.5z"/>
                      </svg>
                    </button>
                    <!-- run -->
                    <button
                      class="w-6 h-6 flex items-center justify-center rounded transition-colors"
                      :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }"
                      :title="t('sidebar.launchAgent', { name: agent.name })"
                      @click="openLaunchModal($event, agent)"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
                        <path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="store.agents.length === 0" class="text-sm text-content-faint px-2 py-2">{{ t('sidebar.noAgent') }}</div>
            </div>
            <!-- Bouton ajouter -->
            <button
              class="mt-2 flex items-center gap-2 px-2 py-2 rounded-md text-xs text-content-faint hover:text-content-tertiary hover:bg-surface-primary transition-colors w-full"
              @click="showCreateAgent = true"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
              </svg>
              {{ t('sidebar.addAgent') }}
            </button>
          </div>
        </template>

        <!-- ── Arborescence ── -->
        <template v-else-if="activeSection === 'tree'">
          <div class="flex-1 overflow-y-auto min-h-0 py-1 min-w-0">
            <div v-if="loadingSidebarTree" class="flex items-center justify-center py-6">
              <span class="text-xs text-content-faint animate-pulse">{{ t('common.loading') }}</span>
            </div>
            <div v-else-if="!store.projectPath" class="px-4 py-3 text-xs text-content-faint">
              {{ t('common.noProject') }}
            </div>
            <div v-else-if="flatSidebarTree.length === 0 && !loadingSidebarTree" class="px-4 py-3 text-xs text-content-faint">
              {{ t('sidebar.emptyFolder') }}
            </div>
            <button
              v-for="item in flatSidebarTree"
              :key="item.node.path"
              class="w-full flex items-center gap-2 py-1 text-left text-sm transition-colors rounded pr-2 group"
              :class="item.node.isDir ? 'hover:bg-surface-secondary/70' : 'hover:bg-surface-secondary/50'"
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
              <svg v-else viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-content-subtle group-hover:text-content-muted">
                <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2L9.5 1.5z"/>
              </svg>
              <!-- Nom -->
              <span
                class="truncate font-mono"
                :class="item.node.isDir
                  ? 'text-content-secondary font-medium group-hover:text-content-primary'
                  : 'text-content-muted group-hover:text-content-secondary'"
              >{{ item.node.name }}</span>
            </button>
          </div>
          <div class="px-4 py-2 border-t border-edge-subtle shrink-0 flex items-center justify-between">
            <button
              class="text-xs text-content-subtle hover:text-content-tertiary transition-colors"
              @click="loadSidebarTree"
            >↺ {{ t('common.refresh') }}</button>
          </div>
        </template>

        <!-- ── Paramètres (removed - now in modal) ── -->

        <!-- ── Stats tâches (permanent bas) ── -->
        <div v-if="store.projectPath" class="shrink-0 border-t border-edge-subtle px-3 py-2">
          <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-1.5">{{ t('sidebar.tasks') }}</p>
          <div class="grid grid-cols-4 gap-1 text-center">
            <div>
              <p class="text-[13px] font-mono font-semibold text-amber-400 leading-none">{{ store.stats.todo }}</p>
              <p class="text-[9px] text-content-faint mt-0.5 leading-tight">{{ t('sidebar.todo') }}</p>
            </div>
            <div>
              <p class="text-[13px] font-mono font-semibold text-emerald-400 leading-none">{{ store.stats.in_progress }}</p>
              <p class="text-[9px] text-content-faint mt-0.5 leading-tight">{{ t('sidebar.inProgress') }}</p>
            </div>
            <div>
              <p class="text-[13px] font-mono font-semibold text-content-muted leading-none">{{ store.stats.done }}</p>
              <p class="text-[9px] text-content-faint mt-0.5 leading-tight">{{ t('sidebar.done') }}</p>
            </div>
            <div>
              <p class="text-[13px] font-mono font-semibold text-violet-400 leading-none">{{ store.stats.archived }}</p>
              <p class="text-[9px] text-content-faint mt-0.5 leading-tight">{{ t('sidebar.archived') }}</p>
            </div>
          </div>
        </div>

        <!-- ── Agents actifs (permanent bas) ── -->
        <div v-if="activeAgents.length > 0" class="shrink-0 border-t border-edge-subtle px-3 py-2">
          <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            {{ t('sidebar.openSessions') }}
            <span class="text-content-dim font-mono">({{ activeAgents.length }})</span>
          </p>
          <div class="space-y-1.5 max-h-40 overflow-y-auto">
            <div
              v-for="agent in activeAgents"
              :key="agent.id"
              class="flex items-center gap-2 min-w-0 cursor-pointer group/active"
              @click="() => { const tab = tabsStore.tabs.find(tab => tab.type === 'terminal' && tab.agentName === agent.name); if (tab) tabsStore.setActive(tab.id) }"
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
                <p class="text-[10px] truncate" :class="tabsStore.isAgentActive(agent.name) ? 'text-emerald-600' : 'text-content-faint'">
                  {{ tabsStore.isAgentActive(agent.name) ? t('sidebar.active') : t('sidebar.waiting') }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Locks actifs (permanent bas) ── -->
        <div v-if="store.locks.length > 0" class="shrink-0 border-t border-edge-subtle px-3 py-2">
          <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0 text-content-faint">
              <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
            </svg>
            {{ t('sidebar.activeLocks') }}
            <span class="text-content-dim font-mono">({{ store.locks.length }})</span>
          </p>
          <div class="space-y-1 max-h-40 overflow-y-auto">
            <div
              v-for="lock in store.locks"
              :key="lock.id"
              class="min-w-0"
              :title="`${lock.fichier} — ${lock.agent_name}`"
            >
              <p
                class="text-[11px] font-mono truncate"
                :class="isLockOld(lock.created_at) ? 'text-red-400' : 'text-content-muted'"
              >{{ lock.fichier.split('/').pop() }}</p>
              <p class="text-[10px] text-content-faint truncate">{{ lock.agent_name }}</p>
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

  <!-- Modal édition agent (réutilise CreateAgentModal en mode edit) -->
  <CreateAgentModal
    v-if="editAgentTarget"
    mode="edit"
    :agent="editAgentTarget"
    @close="editAgentTarget = null"
    @saved="editAgentTarget = null; store.refresh()"
    @toast="(msg, type) => pushToast(msg, type === 'success' ? 'info' : 'error')"
  />

  <!-- Context menu clic droit agent -->
  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="contextMenuItemsFor(contextMenu.agent)"
    @close="contextMenu = null"
  />


  <!-- Modal édition périmètre -->
  <Teleport to="body">
    <div
      v-if="editPerimetre"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="editPerimetre = null"
    >
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl p-5 w-96 flex flex-col gap-3">
        <p class="text-sm font-semibold text-content-secondary">{{ t('sidebar.editPerimeter') }}</p>
        <div>
          <label class="text-xs text-content-subtle uppercase tracking-wider font-semibold block mb-1">{{ t('sidebar.name') }}</label>
          <input
            v-model="editPerimetreName"
            class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-1.5 text-sm text-content-primary font-mono outline-none focus:ring-1 focus:ring-violet-500"
            :placeholder="t('sidebar.namePlaceholder')"
            @keydown.esc="editPerimetre = null"
          />
        </div>
        <div>
          <label class="text-xs text-content-subtle uppercase tracking-wider font-semibold block mb-1">{{ t('sidebar.description') }}</label>
          <input
            v-model="editPerimetreDesc"
            class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-1.5 text-sm text-content-tertiary outline-none focus:ring-1 focus:ring-violet-500"
            :placeholder="t('sidebar.descriptionPlaceholder')"
            @keydown.enter="savePerimetre"
            @keydown.esc="editPerimetre = null"
          />
        </div>
        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 text-xs rounded-md text-content-muted hover:text-content-secondary hover:bg-surface-secondary transition-colors"
            @click="editPerimetre = null"
          >{{ t('common.cancel') }}</button>
          <button
            class="px-3 py-1.5 text-xs rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40"
            :disabled="savingPerimetre || !editPerimetreName.trim()"
            @click="savePerimetre"
          >{{ savingPerimetre ? t('common.saving') : t('common.save') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "../assets/main.css";

.rail-btn {
  @apply relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors text-content-subtle hover:text-content-secondary hover:bg-surface-secondary;
}
.rail-btn--active {
  @apply text-content-primary bg-surface-tertiary;
}
.rail-indicator {
  @apply absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-content-primary rounded-r;
}
</style>
