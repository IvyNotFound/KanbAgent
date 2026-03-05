<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Tab } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentHue, isDark, colorVersion } from '@renderer/utils/agentColor'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem } from './ContextMenu.vue'

const { t } = useI18n()
const store = useTabsStore()
const { confirm } = useConfirmDialog()

async function openWslTerminal(): Promise<void> {
  await window.electronAPI.openWslTerminal()
}

const terminalTabs = computed(() => store.tabs.filter(t => !t.permanent))

// ── Groupement par agent ──────────────────────────────────────────────────────
interface TabGroup {
  agentName: string | null
  tabs: Tab[]
}

const collapsedAgents = ref<Set<string | null>>(new Set())

// Base grouping — no dependency on activeTab (stable during intra-group tab switches)
const groupedTerminalTabsBase = computed<TabGroup[]>(() => {
  const groupMap = new Map<string | null, Tab[]>()
  for (const tab of terminalTabs.value) {
    const key = tab.agentName
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(tab)
  }
  return [...groupMap.entries()].map(([agentName, tabs]) => ({ agentName, tabs }))
})

// Primitive computed — Vue short-circuits downstream if agentName is unchanged on intra-group switch
const activeAgentName = computed(() => store.activeTab?.agentName ?? null)

// Sorted groups — active agent first. Recomputes only on inter-group switch or tab list change.
const groupedTerminalTabs = computed<TabGroup[]>(() => {
  const active = activeAgentName.value
  const groups = groupedTerminalTabsBase.value
  if (!active) return groups
  const sorted = [...groups]
  sorted.sort((a, b) => {
    if (a.agentName === active) return -1
    if (b.agentName === active) return 1
    if (a.agentName === null) return 1
    if (b.agentName === null) return -1
    return a.agentName.localeCompare(b.agentName)
  })
  return sorted
})

function toggleGroup(agentName: string | null): void {
  const key = agentName
  if (collapsedAgents.value.has(key)) {
    collapsedAgents.value.delete(key)
  } else {
    collapsedAgents.value.add(key)
  }
}

function isGroupCollapsed(agentName: string | null): boolean {
  return collapsedAgents.value.has(agentName)
}

function isGroupActive(group: TabGroup): boolean {
  return group.tabs.some(t => t.id === store.activeTabId)
}

function activateAgentGroup(group: TabGroup): void {
  if (group.tabs.length === 0) return
  // Save scroll position before DOM changes caused by expand/collapse
  const savedScroll = scrollContainer.value?.scrollLeft ?? 0
  // Expand if collapsed
  if (isGroupCollapsed(group.agentName)) {
    collapsedAgents.value.delete(group.agentName)
  }
  // Activate first tab if none of this group's tabs is already active
  if (!isGroupActive(group)) {
    store.setActive(group.tabs[0].id)
  }
  // Restore scroll after DOM update to prevent jump to left
  nextTick(() => {
    if (scrollContainer.value) scrollContainer.value.scrollLeft = savedScroll
  })
}

// Auto-expand group when its tab becomes active; auto-collapse previous group
watch(() => store.activeTabId, (newId, oldId) => {
  const activeTab = store.tabs.find(t => t.id === newId)
  if (!activeTab) return
  const newAgentName = activeTab.agentName ?? null
  // Expand the new active group
  collapsedAgents.value.delete(newAgentName)
  // Collapse the previous group if it was a different agent
  if (oldId) {
    const oldTab = store.tabs.find(t => t.id === oldId)
    const oldAgentName = oldTab?.agentName ?? null
    if (oldAgentName !== null && oldAgentName !== newAgentName) {
      collapsedAgents.value.add(oldAgentName)
    }
  }
})

// When multiple groups appear, collapse non-active agent groups
watch(() => groupedTerminalTabs.value.length, (len) => {
  if (len <= 1) { collapsedAgents.value.clear(); return }
  const activeAgentName = store.activeTab?.agentName ?? null
  for (const group of groupedTerminalTabs.value) {
    if (group.agentName !== activeAgentName) {
      collapsedAgents.value.add(group.agentName)
    }
  }
}, { immediate: true })

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
  store.closeTab(tab.id)
}

function onMiddleClick(e: MouseEvent, tab: Tab) {
  if (e.button === 1) {
    e.preventDefault()
    handleCloseTab(tab)
  }
}

// ── Styles dynamiques ────────────────────────────────────────────────────────
// tabStyleMap: styles for sub-tabs (session tabs)
const tabStyleMap = computed<Map<string, Record<string, string>>>(() => {
  void colorVersion.value // track theme reactivity
  const activeId = store.activeTabId
  const map = new Map<string, Record<string, string>>()
  for (const tab of store.tabs) {
    const isActive = activeId === tab.id
    if (!tab.agentName) {
      map.set(tab.id, isActive
        ? (isDark() ? { color: '#f4f4f5', backgroundColor: '#27272a' } : { color: '#18181b', backgroundColor: '#e4e4e7' })
        : {})
      continue
    }
    const h = agentHue(tab.agentName)
    map.set(tab.id, isActive
      ? { color: agentFg(tab.agentName), backgroundColor: agentBg(tab.agentName) }
      : (isDark()
        ? { color: `hsla(${h}, 65%, 65%, 0.65)`, backgroundColor: `hsla(${h}, 38%, 16%, 0.55)` }
        : { color: `hsla(${h}, 55%, 40%, 0.7)`, backgroundColor: `hsla(${h}, 45%, 92%, 0.6)` }))
  }
  return map
})

// agentTabStyleMap: styles for agent-header tabs
const agentTabStyleMap = computed<Map<string | null, Record<string, string>>>(() => {
  void colorVersion.value // track theme reactivity
  const activeId = store.activeTabId
  const map = new Map<string | null, Record<string, string>>()
  for (const group of groupedTerminalTabs.value) {
    const name = group.agentName
    if (!name) {
      map.set(name, isDark() ? { color: '#a1a1aa', backgroundColor: '#27272a' } : { color: '#52525b', backgroundColor: '#e4e4e7' })
      continue
    }
    const isActive = group.tabs.some(t => t.id === activeId)
    const h = agentHue(name)
    map.set(name, isActive
      ? { color: agentFg(name), backgroundColor: agentBg(name) }
      : (isDark()
        ? { color: `hsla(${h}, 65%, 65%, 0.65)`, backgroundColor: `hsla(${h}, 38%, 16%, 0.55)` }
        : { color: `hsla(${h}, 55%, 40%, 0.7)`, backgroundColor: `hsla(${h}, 45%, 92%, 0.6)` }))
  }
  return map
})

const indicatorStyleMap = computed<Map<string, Record<string, string>>>(() => {
  void colorVersion.value // track theme reactivity
  const map = new Map<string, Record<string, string>>()
  for (const tab of store.tabs) {
    map.set(tab.id, tab.agentName
      ? { backgroundColor: agentFg(tab.agentName) }
      : { backgroundColor: '#a78bfa' }) // violet-400
  }
  return map
})

function subTabLabel(tab: Tab): string {
  return tab.taskId ? `#${tab.taskId}` : tab.title
}

// ── Context menu (clic droit sur en-tête de groupe) ──────────────────────────
const contextMenu = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

function openGroupMenu(event: MouseEvent, group: TabGroup): void {
  // Onglets système (null agentName) ne sont pas fermables via ce menu
  if (group.agentName === null) return
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    items: [
      {
        label: t('tabBar.closeGroupTabs', { count: group.tabs.length }),
        action: () => store.closeTabGroup(group.agentName),
      },
    ],
  }
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

    <!-- Onglet Stat (fixe, non fermable) -->
    <button
      :class="[
        'flex items-center gap-2 px-5 text-sm font-semibold transition-all relative select-none border-r border-edge-subtle shrink-0',
        store.activeTabId === 'dashboard'
          ? 'text-content-primary bg-surface-secondary'
          : 'text-content-muted hover:text-content-secondary hover:bg-surface-secondary/50'
      ]"
      @click="store.setActive('dashboard')"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
        <path d="M0 11l4-5 3 3 4-6 5 3v5H0z"/>
      </svg>
      <span>{{ t('sidebar.dashboard') }}</span>
      <span
        v-if="store.activeTabId === 'dashboard'"
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

    <!-- Onglets terminaux (groupés par agent, scrollable) -->
    <div
      ref="scrollContainer"
      class="flex items-stretch gap-0.5 px-1.5 flex-1 min-w-0 overflow-x-hidden"
      @wheel="onWheel"
      @scroll="updateScrollState"
    >
      <!-- Groupe agent -->
      <div
        v-for="(group, groupIdx) in groupedTerminalTabs"
        :key="group.agentName ?? '__misc__'"
        class="flex items-stretch gap-0.5"
        :class="groupIdx < groupedTerminalTabs.length - 1 ? 'mr-3' : ''"
      >
        <!-- Onglet-agent (bouton principal du groupe) -->
        <button
          class="relative flex items-center gap-1.5 px-3 text-sm font-semibold transition-all select-none rounded-t shrink-0 cursor-pointer"
          :style="agentTabStyleMap.get(group.agentName)"
          @click="activateAgentGroup(group)"
          @contextmenu.prevent="openGroupMenu($event, group)"
        >
          <!-- Icône terminal -->
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 shrink-0 text-violet-500 dark:text-zinc-300">
            <polyline points="2,5 6.5,8 2,11"/>
            <line x1="8.5" y1="11" x2="14" y2="11"/>
          </svg>
          <!-- · séparateur -->
          <span class="opacity-50 select-none">·</span>
          <!-- Nom de l'agent -->
          <span class="truncate max-w-[80px]">{{ group.agentName ?? '?' }}</span>
          <!-- Chevron collapse/expand -->
          <svg
            viewBox="0 0 16 16" fill="currentColor"
            class="w-2.5 h-2.5 shrink-0 transition-transform duration-150"
            :class="isGroupCollapsed(group.agentName) ? '' : '-rotate-90'"
            @click.stop="toggleGroup(group.agentName)"
          >
            <path d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
          </svg>
          <!-- Badge count quand collapsé -->
          <span
            v-if="isGroupCollapsed(group.agentName)"
            class="text-[10px] font-mono opacity-70 shrink-0"
          >{{ group.tabs.length }}</span>
          <!-- Indicateur actif (bas de l'onglet-agent) -->
          <span
            v-if="isGroupActive(group)"
            class="absolute bottom-0 left-0 right-0 h-[2px]"
            :style="group.agentName ? { backgroundColor: agentFg(group.agentName) } : { backgroundColor: '#a78bfa' }"
          ></span>
        </button>

        <!-- Sous-onglets session (masqués si groupe collapsé) -->
        <template v-if="!isGroupCollapsed(group.agentName)">
          <template v-for="tab in group.tabs" :key="tab.id">
            <!-- Groupe actif : affichage complet pour tous les sous-onglets -->
            <button
              v-if="isGroupActive(group)"
              class="relative flex items-center gap-1.5 px-2.5 text-sm font-medium transition-all select-none rounded-t shrink-0 cursor-pointer"
              :style="tabStyleMap.get(tab.id)"
              :title="subTabLabel(tab)"
              @click="store.setActive(tab.id)"
              @mousedown="onMiddleClick($event, tab)"
            >
              <span class="font-mono text-xs shrink-0">{{ subTabLabel(tab) }}</span>
              <span v-if="tab.dirty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" :title="t('tabBar.unsaved')" />
              <!-- Fermer -->
              <span
                class="flex items-center justify-center w-4 h-4 rounded opacity-40 hover:opacity-100 hover:text-red-400 hover:bg-black/20 transition-all text-xs cursor-pointer"
                :title="t('tabBar.closeTab')"
                @click.stop="handleCloseTab(tab)"
              >✕</span>
              <!-- Indicateur actif -->
              <span
                class="absolute bottom-0 left-0 right-0 h-[2px]"
                :style="indicatorStyleMap.get(tab.id)"
              ></span>
            </button>
            <!-- Groupe inactif : pastille compacte -->
            <button
              v-else
              class="relative flex items-center justify-center w-4 h-6 self-center transition-all select-none rounded shrink-0 cursor-pointer"
              :title="subTabLabel(tab)"
              @click="store.setActive(tab.id)"
              @mousedown="onMiddleClick($event, tab)"
            >
              <span
                class="w-1.5 h-1.5 rounded-full opacity-70 hover:opacity-100 transition-opacity"
                :class="tab.dirty ? 'bg-amber-400' : ''"
                :style="tab.dirty ? {} : indicatorStyleMap.get(tab.id)"
              ></span>
            </button>
          </template>
        </template>
      </div>
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
      :title="t('tabBar.openWslTerminal')"
      @click="openWslTerminal()"
    >
      <span class="text-base leading-none">+</span>
      <span>WSL</span>
    </button>
    <div class="w-3 shrink-0"></div>

  </div>

  <!-- Menu contextuel groupe d'onglets -->
  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="contextMenu.items"
    @close="contextMenu = null"
  />
</template>
