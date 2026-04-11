<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Tab } from '@renderer/stores/tabs'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'
import { useTabBarGroups } from '@renderer/composables/useTabBarGroups'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem } from './ContextMenu.vue'
import TabBarScrollArea from './TabBarScrollArea.vue'

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

    <!-- Scrollable tabs area -->
    <div
      ref="scrollContainer"
      class="scroll-container"
      @wheel="onWheel"
      @scroll="updateScrollState"
    >
      <TabBarScrollArea
        :file-tabs="fileTabs"
        :grouped-terminal-tabs="groupedTerminalTabs"
        :active-tab-id="store.activeTabId"
        :agent-tab-style-map="agentTabStyleMap"
        :group-envelope-style-map="groupEnvelopeStyleMap"
        :sub-tab-bg-map="subTabBgMap"
        :sub-tab-label="subTabLabel"
        :is-group-collapsed="isGroupCollapsed"
        @activate="store.setActive($event)"
        @close-tab="handleCloseTab"
        @middle-click="onMiddleClick"
        @toggle-group="toggleGroup"
        @activate-agent-group="activateAgentGroup"
        @group-contextmenu="openGroupMenu"
      />
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

  <!-- Tab group context menu -->
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
</style>
