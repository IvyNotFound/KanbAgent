<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Tab } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentHue } from '@renderer/utils/agentColor'

const store = useTabsStore()

const terminalTabs = computed(() => store.tabs.filter(t => !t.permanent))

// ── Drag & drop ──────────────────────────────────────────────────────────────
const draggedId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

function onDragStart(e: DragEvent, tabId: string) {
  draggedId.value = tabId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
  }
}

function onDragOver(e: DragEvent, tabId: string) {
  if (!draggedId.value || draggedId.value === tabId) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetId.value = tabId
}

function onDrop(e: DragEvent, tabId: string) {
  e.preventDefault()
  if (!draggedId.value || draggedId.value === tabId) return
  store.reorderTab(draggedId.value, tabId)
  draggedId.value = null
  dropTargetId.value = null
}

function onDragEnd() {
  draggedId.value = null
  dropTargetId.value = null
}

async function handleCloseTab(tab: Tab): Promise<void> {
  if (tab.type === 'file' && tab.dirty) {
    const confirmed = await window.electronAPI.showConfirmDialog({
      title: 'Fermer le fichier',
      message: `${tab.title} contient des modifications non enregistrées.`,
      detail: 'Fermer quand même ? Les modifications seront perdues.',
    })
    if (!confirmed) return
  }
  store.closeTab(tab.id)
}

// ── Styles dynamiques ────────────────────────────────────────────────────────
function tabStyle(tab: Tab): Record<string, string> {
  const isActive = store.activeTabId === tab.id
  if (!tab.agentName) {
    return isActive ? { color: '#f4f4f5', backgroundColor: '#27272a' } : {}
  }
  const h = agentHue(tab.agentName)
  if (isActive) {
    return {
      color: agentFg(tab.agentName),
      backgroundColor: agentBg(tab.agentName),
    }
  }
  // Inactif mais agent connu : teinte subtile
  return {
    color: `hsla(${h}, 65%, 65%, 0.65)`,
    backgroundColor: `hsla(${h}, 38%, 16%, 0.55)`,
  }
}

function indicatorStyle(tab: Tab): Record<string, string> {
  if (tab.agentName) return { backgroundColor: agentFg(tab.agentName) }
  return { backgroundColor: '#a78bfa' } // violet-400
}
</script>

<template>
  <div class="flex items-stretch border-b border-zinc-700 bg-zinc-900 shrink-0 h-10">

    <!-- Onglet Backlog (fixe, non déplaçable) -->
    <button
      :class="[
        'flex items-center gap-2 px-5 text-sm font-semibold transition-all relative select-none border-r border-zinc-800 shrink-0',
        store.activeTabId === 'backlog'
          ? 'text-zinc-100 bg-zinc-800'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
      ]"
      @click="store.setActive('backlog')"
    >
      <!-- Icône kanban -->
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
        <rect x="1"  y="2" width="4" height="12" rx="1.5"/>
        <rect x="6"  y="2" width="4" height="8"  rx="1.5"/>
        <rect x="11" y="2" width="4" height="5"  rx="1.5"/>
      </svg>
      <span>Backlog</span>
      <!-- Indicateur actif -->
      <span
        v-if="store.activeTabId === 'backlog'"
        class="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-500"
      ></span>
    </button>

    <!-- Onglet Log (fixe, non fermable) -->
    <button
      :class="[
        'flex items-center gap-2 px-5 text-sm font-semibold transition-all relative select-none border-r border-zinc-800 shrink-0',
        store.activeTabId === 'logs'
          ? 'text-zinc-100 bg-zinc-800'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
      ]"
      @click="store.setActive('logs')"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
        <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
        <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
      </svg>
      <span>Log</span>
      <span
        v-if="store.activeTabId === 'logs'"
        class="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-500"
      ></span>
    </button>

    <!-- Onglets terminaux (déplaçables) -->
    <div class="flex items-stretch gap-0.5 px-1.5 flex-1 min-w-0 overflow-x-auto">
      <button
        v-for="tab in terminalTabs"
        :key="tab.id"
        draggable="true"
        :class="[
          'relative flex items-center gap-2 px-3 text-sm font-medium transition-all select-none rounded-t shrink-0',
          store.activeTabId !== tab.id && !tab.agentName ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60' : '',
          draggedId === tab.id ? 'opacity-40' : '',
          dropTargetId === tab.id && draggedId !== tab.id ? 'ring-1 ring-inset ring-violet-500/50' : '',
          'cursor-grab active:cursor-grabbing',
        ]"
        :style="tabStyle(tab)"
        @click="store.setActive(tab.id)"
        @dragstart="onDragStart($event, tab.id)"
        @dragover="onDragOver($event, tab.id)"
        @dragleave="dropTargetId = null"
        @drop="onDrop($event, tab.id)"
        @dragend="onDragEnd"
      >
        <!-- Icône selon type -->
        <span class="flex items-center justify-center w-5 h-5 rounded shrink-0 bg-black/25">
          <!-- Fichier -->
          <svg v-if="tab.type === 'file'" viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
            <path d="M4 1h5.586a1 1 0 0 1 .707.293l3.414 3.414A1 1 0 0 1 14 5.414V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm5 0v4h4"/>
          </svg>
          <!-- Explorateur -->
          <svg v-else-if="tab.type === 'explorer'" viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
            <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
          </svg>
          <!-- Logs -->
          <svg v-else-if="tab.type === 'logs'" viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
            <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
            <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
          </svg>
          <!-- Terminal (défaut) -->
          <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3">
            <polyline points="2,5 6.5,8 2,11"/>
            <line x1="8.5" y1="11" x2="14" y2="11"/>
          </svg>
        </span>
        <span class="max-w-[120px] truncate">{{ tab.title }}</span>
        <span v-if="tab.dirty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Modifications non enregistrées" />
        <!-- Fermer -->
        <span
          class="ml-0.5 flex items-center justify-center w-4 h-4 rounded opacity-40 hover:opacity-100 hover:text-red-400 hover:bg-black/20 transition-all text-xs cursor-pointer"
          @click.stop="handleCloseTab(tab)"
          title="Fermer"
        >✕</span>
        <!-- Indicateur actif -->
        <span
          v-if="store.activeTabId === tab.id"
          class="absolute bottom-0 left-0 right-0 h-[2px]"
          :style="indicatorStyle(tab)"
        ></span>
      </button>
    </div>

    <!-- Bouton + WSL -->
    <button
      class="flex items-center gap-1.5 px-3 self-center text-sm font-semibold text-violet-300 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 hover:border-violet-500/50 rounded transition-all mr-2 shrink-0 cursor-pointer"
      style="height: 28px"
      @click="store.addTerminal()"
      title="Nouveau terminal WSL"
    >
      <span class="text-base leading-none">+</span>
      <span>WSL</span>
    </button>
    <div class="w-3 shrink-0"></div>

  </div>
</template>
