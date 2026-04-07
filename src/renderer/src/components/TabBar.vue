<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Tab } from '@renderer/stores/tabs'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'
import { useTabBarGroups } from '@renderer/composables/useTabBarGroups'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem } from './ContextMenu.vue'

const { t } = useI18n()
const { confirm } = useConfirmDialog()

const scrollContainer = ref<HTMLDivElement | null>(null)

// ── Fixed tab active state ────────────────────────────────────────────────────
const fixedActiveTab = computed<string | undefined>(() => {
  if (store.activeTabId === 'backlog') return 'backlog'
  if (store.activeTabId === 'dashboard') return 'dashboard'
  return undefined
})

function onFixedTabChange(val: string | null | undefined) {
  if (val) store.setActive(val)
}

const {
  store, terminalTabs, fileTabs,
  groupedTerminalTabs,
  toggleGroup, isGroupCollapsed, activateAgentGroup,
  agentTabStyleMap, groupEnvelopeStyleMap, subTabBgMap, subTabLabel,
} = useTabBarGroups(scrollContainer)

// ── Scroll state ─────────────────────────────────────────────────────────────
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
watch(() => [...terminalTabs.value, ...fileTabs.value].map(t => t.id).join(), () => nextTick(updateScrollState))

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
  if (tab.type === 'terminal' && tab.streamId) {
    const ok = await confirm({
      title: t('tabBar.closeTerminalTitle'),
      message: t('tabBar.closeTerminalMessage'),
      type: 'danger',
      confirmLabel: t('tabBar.closeTerminalConfirm'),
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

// ── Context menu ─────────────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

function openGroupMenu(event: MouseEvent, group: { agentName: string | null; tabs: Tab[] }): void {
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
  <div class="tabbar">

    <!-- Fixed tabs: Backlog + Dashboard — MD3 Secondary Tabs with Vuetify ripple -->
    <v-tabs
      :model-value="fixedActiveTab"
      density="compact"
      height="48"
      color="primary"
      class="tabbar-fixed-tabs"
      @update:model-value="onFixedTabChange"
    >
      <v-tab value="backlog">
        <v-icon size="14" class="mr-2">mdi-view-list</v-icon>
        {{ t('sidebar.backlog') }}
      </v-tab>
      <v-tab value="dashboard">
        <v-icon size="14" class="mr-2">mdi-chart-line</v-icon>
        {{ t('sidebar.dashboard') }}
      </v-tab>
    </v-tabs>

    <!-- Scroll left arrow -->
    <button
      v-show="canScrollLeft"
      class="scroll-arrow"
      @click="scrollBy(-120)"
    >
      <v-icon size="12">mdi-chevron-left</v-icon>
    </button>

    <!-- Onglets (scrollable) -->
    <div
      ref="scrollContainer"
      class="scroll-container"
      @wheel="onWheel"
      @scroll="updateScrollState"
    >
      <!-- Onglets fichiers -->
      <button
        v-for="tab in fileTabs"
        :key="tab.id"
        class="text-caption"
        :class="['tab-file', store.activeTabId === tab.id && 'tab-file--active']"
        :title="tab.title"
        :aria-label="t('explorer.files') + ': ' + tab.title"
        @click="store.setActive(tab.id)"
        @mousedown="onMiddleClick($event, tab)"
      >
        <v-icon size="14" style="flex-shrink: 0; opacity: 0.5;">mdi-file-outline</v-icon>
        <span class="tab-title-mono">{{ tab.title }}</span>
        <span v-if="tab.dirty" class="tab-dirty" :title="t('tabBar.unsaved')" />
        <span
          class="tab-close text-label-medium"
          :title="t('tabBar.closeTab')"
          @click.stop="handleCloseTab(tab)"
        >✕</span>
        <span
          v-if="store.activeTabId === tab.id"
          class="tab-indicator"
        ></span>
      </button>

      <!-- Groupe agent — envelope pill wrapping pill-header + sub-chips -->
      <div
        v-for="group in groupedTerminalTabs"
        :key="group.agentName ?? '__misc__'"
        class="tab-group"
        :style="groupEnvelopeStyleMap.get(group.agentName)"
      >
        <!-- Pill header (identité de l'agent) -->
        <button
          v-ripple
          class="tab-agent"
          :style="agentTabStyleMap.get(group.agentName)"
          @click="activateAgentGroup(group)"
          @contextmenu.prevent="openGroupMenu($event, group)"
        >
          <v-icon size="11" style="flex-shrink: 0;">mdi-console</v-icon>
          <span class="tab-agent-name">{{ group.agentName ?? '?' }}</span>
          <v-icon
            class="tab-chevron"
            :style="isGroupCollapsed(group.agentName) ? {} : { transform: 'rotate(-90deg)' }"
            size="10"
            @click.stop="toggleGroup(group.agentName)"
          >mdi-chevron-down</v-icon>
          <span
            v-if="isGroupCollapsed(group.agentName)"
            class="tab-group-count"
          >{{ group.tabs.length }}</span>
        </button>

        <!-- Sub-chips session (masqués si groupe collapsé) -->
        <template v-if="!isGroupCollapsed(group.agentName)">
          <button
            v-for="tab in group.tabs"
            :key="tab.id"
            v-ripple
            class="tab-sub"
            :class="{ 'tab-sub--active': store.activeTabId === tab.id }"
            :style="subTabBgMap.get(tab.id)"
            :title="subTabLabel(tab)"
            @click="store.setActive(tab.id)"
            @mousedown="onMiddleClick($event, tab)"
          >
            <span class="tab-sub-label">{{ subTabLabel(tab) }}</span>
            <span v-if="tab.dirty" class="tab-dirty" :title="t('tabBar.unsaved')" />
            <span
              class="tab-close text-label-medium"
              :title="t('tabBar.closeTab')"
              @click.stop="handleCloseTab(tab)"
            >✕</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Scroll right arrow -->
    <button
      v-show="canScrollRight"
      class="scroll-arrow"
      @click="scrollBy(120)"
    >
      <v-icon size="12">mdi-chevron-right</v-icon>
    </button>


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

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  height: 48px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
}
/* tabbar-fixed-tabs: v-tabs wrapper for Backlog + Dashboard (MD3 Secondary Tabs).
   flex-shrink: 0 prevents compression by adjacent scrollable area. */
.tabbar-fixed-tabs {
  flex-shrink: 0;
}
.scroll-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.4);
  background: none;
  border: none;
  cursor: pointer;
  transition: background var(--md-duration-short3) var(--md-easing-standard), color var(--md-duration-short3) var(--md-easing-standard);
}
.scroll-arrow:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.scroll-container {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  flex: 1;
  min-width: 0;
  overflow-x: scroll;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scroll-container::-webkit-scrollbar {
  display: none;
}
.tab-file {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 36px;
  align-self: center;
  font-weight: 500;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: var(--shape-xs) var(--shape-xs) 0 0;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.tab-file:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.tab-file--active {
  color: rgba(var(--v-theme-on-surface), 0.9);
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.tab-title-mono {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 12px;
}
.tab-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-warning));
  flex-shrink: 0;
}
.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  opacity: 0.4;
  cursor: pointer;
  margin-left: 16px;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
}
.tab-close:hover {
  opacity: 1;
  color: rgb(var(--v-theme-error));
  background: rgba(0,0,0,0.2);
}
/* Group envelope — pill container tinted with agent color.
   border and background come from :style (groupEnvelopeStyleMap). */
.tab-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 44px;
  align-self: center;
  border-radius: 22px;
  padding: 2px 3px;
}
/* Pill header — agent identity, always visible */
.tab-agent {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 36px;
  font-size: 11px;
  font-weight: 600;
  transition: filter var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: 18px;
  flex-shrink: 0;
  cursor: pointer;
  border: none;
}
.tab-agent:hover {
  filter: brightness(1.12);
}
.tab-agent:active {
  filter: brightness(0.9);
}
.tab-agent-name {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-chevron {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  transition: transform var(--md-duration-short3) var(--md-easing-standard);
}
.tab-group-count {
  font-size: 10px;
  font-family: inherit;
  opacity: 0.7;
  flex-shrink: 0;
}
/* Sub-chips — session tabs inside the group envelope.
   Active state: tinted bg (0.60) via subTabBgMap :style, on-surface text via .tab-sub--active.
   Inactive: subtle agent tint (0.08) via --sub-tab-bg CSS custom prop (allows hover override). */
.tab-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 36px;
  font-size: 11px;
  font-weight: 500;
  transition: background var(--md-duration-short3) var(--md-easing-standard),
              color var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: 14px;
  flex-shrink: 0;
  cursor: pointer;
  background-color: var(--sub-tab-bg, transparent);
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.70);
}
.tab-sub--active {
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.tab-sub:not(.tab-sub--active):hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.80);
}
.tab-sub:not(.tab-sub--active):active {
  background: rgba(var(--v-theme-on-surface), 0.12);
}
.tab-sub-label {
  font-size: 11px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgb(var(--v-theme-primary));
  border-radius: 3px 3px 0 0;
}
</style>
