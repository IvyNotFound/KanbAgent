<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Tab } from '@renderer/stores/tabs'
import { agentAccent } from '@renderer/utils/agentColor'
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
  toggleGroup, isGroupCollapsed, isGroupActive, activateAgentGroup,
  tabStyleMap, agentTabStyleMap, indicatorStyleMap, subTabLabel,
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

      <!-- Groupe agent -->
      <div
        v-for="(group, groupIdx) in groupedTerminalTabs"
        :key="group.agentName ?? '__misc__'"
        class="tab-group"
        :class="groupIdx < groupedTerminalTabs.length - 1 ? 'tab-group-sep' : ''"
      >
        <!-- Onglet-agent (bouton principal du groupe) -->
        <button
          v-ripple
          class="tab-agent text-body-2"
          :style="agentTabStyleMap.get(group.agentName)"
          @click="activateAgentGroup(group)"
          @contextmenu.prevent="openGroupMenu($event, group)"
        >
          <v-icon size="12" style="flex-shrink: 0;">mdi-console</v-icon>
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
          <span
            v-if="isGroupActive(group)"
            style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; border-radius: 3px 3px 0 0;"
            :style="group.agentName ? { backgroundColor: agentAccent(group.agentName) } : { backgroundColor: 'rgb(var(--v-theme-primary))' }"
          ></span>
        </button>

        <!-- Sous-onglets session (masqués si groupe collapsé) -->
        <template v-if="!isGroupCollapsed(group.agentName)">
          <template v-for="tab in group.tabs" :key="tab.id">
            <button
              v-ripple
              class="tab-sub text-body-2"
              :style="tabStyleMap.get(tab.id)"
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
              <span
                style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; border-radius: 3px 3px 0 0;"
                :style="indicatorStyleMap.get(tab.id)"
              ></span>
            </button>
          </template>
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
  align-items: stretch;
  gap: 2px;
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
  font-weight: 500;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: var(--shape-xs) var(--shape-xs) 0 0;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-right: 2px;
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
.tab-group {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex-shrink: 0;
}
.tab-group-sep {
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  margin-right: 4px;
  padding-right: 4px;
}
.tab-agent {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-weight: 500;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: var(--shape-xs) var(--shape-xs) 0 0;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
}
.tab-agent:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
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
.tab-sub {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  min-width: 90px;
  font-weight: 500;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: var(--shape-xs) var(--shape-xs) 0 0;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
}
.tab-sub:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.tab-sub-label {
  font-size: 12px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-sub-dot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 24px;
  align-self: center;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
  border-radius: 3px;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
}
.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  opacity: 0.7;
  transition: opacity var(--md-duration-short3) var(--md-easing-standard);
}
.tab-dot:hover {
  opacity: 1;
}
.tab-dot--dirty {
  background: rgb(var(--v-theme-warning));
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
