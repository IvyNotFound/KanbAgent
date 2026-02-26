<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Tab } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentHue, isDark } from '@renderer/utils/agentColor'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()
const store = useTabsStore()
const { confirm } = useConfirmDialog()

const terminalTabs = computed(() => store.tabs.filter(t => !t.permanent))

// ── Scroll state ─────────────────────────────────────────────────────────────
const scrollContainer = ref<HTMLDivElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updateScrollState() {
  const el = scrollContainer.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 1
  canScrollRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
}

function scrollBy(delta: number) {
  scrollContainer.value?.scrollBy({ left: delta, behavior: 'smooth' })
}

function onWheel(e: WheelEvent) {
  if (!scrollContainer.value) return
  e.preventDefault()
  scrollContainer.value.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX
}

let resizeObs: ResizeObserver | null = null
onMounted(() => {
  nextTick(updateScrollState)
  if (scrollContainer.value) {
    resizeObs = new ResizeObserver(updateScrollState)
    resizeObs.observe(scrollContainer.value)
  }
})
onUnmounted(() => { resizeObs?.disconnect() })
watch(() => terminalTabs.value.map(t => t.id).join(), () => nextTick(updateScrollState))

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
    const ok = await confirm({
      title: t('tabBar.closeFileTitle'),
      message: t('tabBar.closeFileMessage', { title: tab.title }),
      detail: t('tabBar.closeFileDetail'),
      type: 'warning',
      confirmLabel: t('tabBar.closeFileConfirm'),
    })
    if (!ok) return
  }
  if (tab.type === 'terminal') {
    const alive = tab.ptyId
      ? await window.electronAPI.terminalIsAlive(tab.ptyId)
      : true
    if (alive) {
      const ok = await confirm({
        title: t('tabBar.closeTerminalTitle'),
        message: t('tabBar.closeTerminalMessage'),
        type: 'danger',
        confirmLabel: t('tabBar.closeTerminalConfirm'),
      })
      if (!ok) return
    }
  }
  store.closeTab(tab.id)
}

function onMiddleClick(e: MouseEvent, tab: Tab) {
  if (e.button === 1) {
    e.preventDefault()
    handleCloseTab(tab)
  }
}

// ── Styles dynamiques ────────────────────────────────────────────────────────
function tabStyle(tab: Tab): Record<string, string> {
  const isActive = store.activeTabId === tab.id
  if (!tab.agentName) {
    if (!isActive) return {}
    return isDark()
      ? { color: '#f4f4f5', backgroundColor: '#27272a' }
      : { color: '#18181b', backgroundColor: '#e4e4e7' }
  }
  const h = agentHue(tab.agentName)
  if (isActive) {
    return {
      color: agentFg(tab.agentName),
      backgroundColor: agentBg(tab.agentName),
    }
  }
  // Inactif mais agent connu : teinte subtile
  return isDark()
    ? { color: `hsla(${h}, 65%, 65%, 0.65)`, backgroundColor: `hsla(${h}, 38%, 16%, 0.55)` }
    : { color: `hsla(${h}, 55%, 40%, 0.7)`, backgroundColor: `hsla(${h}, 45%, 92%, 0.6)` }
}

function indicatorStyle(tab: Tab): Record<string, string> {
  if (tab.agentName) return { backgroundColor: agentFg(tab.agentName) }
  return { backgroundColor: '#a78bfa' } // violet-400
}
</script>

<template>
  <div class="flex items-stretch border-b border-edge-default bg-surface-primary shrink-0 h-10">

    <!-- Onglet Backlog (fixe, non déplaçable) -->
    <button
      :class="[
        'flex items-center gap-2 px-5 text-sm font-semibold transition-all relative select-none border-r border-edge-subtle shrink-0',
        store.activeTabId === 'backlog'
          ? 'text-content-primary bg-surface-secondary'
          : 'text-content-muted hover:text-content-secondary hover:bg-surface-secondary/50'
      ]"
      @click="store.setActive('backlog')"
    >
      <!-- Icône kanban -->
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
        <rect x="1"  y="2" width="4" height="12" rx="1.5"/>
        <rect x="6"  y="2" width="4" height="8"  rx="1.5"/>
        <rect x="11" y="2" width="4" height="5"  rx="1.5"/>
      </svg>
      <span>{{ t('sidebar.backlog') }}</span>
      <!-- Indicateur actif -->
      <span
        v-if="store.activeTabId === 'backlog'"
        class="absolute bottom-0 left-0 right-0 h-[2px] bg-content-faint"
      ></span>
    </button>

    <!-- Onglet Log (fixe, non fermable) -->
    <button
      :class="[
        'flex items-center gap-2 px-5 text-sm font-semibold transition-all relative select-none border-r border-edge-subtle shrink-0',
        store.activeTabId === 'logs'
          ? 'text-content-primary bg-surface-secondary'
          : 'text-content-muted hover:text-content-secondary hover:bg-surface-secondary/50'
      ]"
      @click="store.setActive('logs')"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
        <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
        <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
      </svg>
      <span>{{ t('sidebar.logs') }}</span>
      <span
        v-if="store.activeTabId === 'logs'"
        class="absolute bottom-0 left-0 right-0 h-[2px] bg-content-faint"
      ></span>
    </button>

    <!-- Scroll left arrow -->
    <button
      v-show="canScrollLeft"
      class="flex items-center justify-center w-6 shrink-0 text-content-subtle hover:text-content-secondary hover:bg-surface-secondary/60 transition-colors"
      @click="scrollBy(-120)"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
        <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
      </svg>
    </button>

    <!-- Onglets terminaux (déplaçables, scrollable) -->
    <div
      ref="scrollContainer"
      class="flex items-stretch gap-0.5 px-1.5 flex-1 min-w-0 overflow-x-hidden"
      @wheel="onWheel"
      @scroll="updateScrollState"
    >
      <button
        v-for="tab in terminalTabs"
        :key="tab.id"
        draggable="true"
        :class="[
          'relative flex items-center gap-2 px-3 text-sm font-medium transition-all select-none rounded-t shrink-0',
          store.activeTabId !== tab.id && !tab.agentName ? 'text-content-muted hover:text-content-secondary hover:bg-surface-secondary/60' : '',
          draggedId === tab.id ? 'opacity-40' : '',
          dropTargetId === tab.id && draggedId !== tab.id ? 'ring-1 ring-inset ring-violet-500/50' : '',
          'cursor-pointer',
        ]"
        :style="tabStyle(tab)"
        @click="store.setActive(tab.id)"
        @mousedown="onMiddleClick($event, tab)"
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
        <span v-if="tab.dirty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" :title="t('tabBar.unsaved')" />
        <!-- Fermer -->
        <span
          class="ml-0.5 flex items-center justify-center w-4 h-4 rounded opacity-40 hover:opacity-100 hover:text-red-400 hover:bg-black/20 transition-all text-xs cursor-pointer"
          :title="t('tabBar.closeTab')"
          @click.stop="handleCloseTab(tab)"
        >✕</span>
        <!-- Indicateur actif -->
        <span
          v-if="store.activeTabId === tab.id"
          class="absolute bottom-0 left-0 right-0 h-[2px]"
          :style="indicatorStyle(tab)"
        ></span>
      </button>
    </div>

    <!-- Scroll right arrow -->
    <button
      v-show="canScrollRight"
      class="flex items-center justify-center w-6 shrink-0 text-content-subtle hover:text-content-secondary hover:bg-surface-secondary/60 transition-colors"
      @click="scrollBy(120)"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
        <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
      </svg>
    </button>

    <!-- Bouton + WSL (fixed right, never pushed by tabs) -->
    <button
      class="flex items-center gap-1.5 px-3 self-center text-sm font-semibold text-violet-700 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 hover:border-violet-500/60 dark:text-violet-300 dark:border-violet-500/30 dark:hover:border-violet-500/50 rounded transition-all ml-1 mr-2 shrink-0 cursor-pointer"
      style="height: 28px"
      :title="t('tabBar.newTerminal')"
      @click="store.addTerminal()"
    >
      <span class="text-base leading-none">+</span>
      <span>WSL</span>
    </button>
    <div class="w-3 shrink-0"></div>

  </div>
</template>
