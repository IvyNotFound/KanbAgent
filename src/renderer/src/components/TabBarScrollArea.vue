<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Tab } from '@renderer/stores/tabs'

const { t } = useI18n()

defineProps<{
  fileTabs: Tab[]
  groupedTerminalTabs: Array<{ agentName: string | null; tabs: Tab[] }>
  activeTabId: string | null
  agentTabStyleMap: Map<string | null, Record<string, string>>
  groupEnvelopeStyleMap: Map<string | null, Record<string, string>>
  subTabBgMap: Map<string, Record<string, string>>
  subTabLabel: (tab: Tab) => string
  isGroupCollapsed: (agentName: string | null) => boolean
}>()

const emit = defineEmits<{
  (e: 'activate', id: string): void
  (e: 'close-tab', tab: Tab): void
  (e: 'middle-click', event: MouseEvent, tab: Tab): void
  (e: 'toggle-group', agentName: string | null): void
  (e: 'activate-agent-group', group: { agentName: string | null; tabs: Tab[] }): void
  (e: 'group-contextmenu', event: MouseEvent, group: { agentName: string | null; tabs: Tab[] }): void
}>()
</script>

<template>
  <!-- File tabs -->
  <button
    v-for="tab in fileTabs"
    :key="tab.id"
    class="text-caption"
    :class="['tab-file', activeTabId === tab.id && 'tab-file--active']"
    :title="tab.title"
    :aria-label="t('explorer.files') + ': ' + tab.title"
    @click="emit('activate', tab.id)"
    @mousedown="emit('middle-click', $event, tab)"
  >
    <v-icon size="14" style="flex-shrink: 0; opacity: 0.5;">mdi-file-outline</v-icon>
    <span class="tab-title-mono">{{ tab.title }}</span>
    <span v-if="tab.dirty" class="tab-dirty" :title="t('tabBar.unsaved')" />
    <span
      class="tab-close text-label-medium"
      :title="t('tabBar.closeTab')"
      @click.stop="emit('close-tab', tab)"
    >✕</span>
  </button>

  <!-- Agent group — envelope pill wrapping pill-header + sub-chips -->
  <div
    v-for="group in groupedTerminalTabs"
    :key="group.agentName ?? '__misc__'"
    class="tab-group"
    :style="groupEnvelopeStyleMap.get(group.agentName)"
  >
    <!-- Pill header (agent identity) -->
    <button
      v-ripple
      class="tab-agent"
      :style="agentTabStyleMap.get(group.agentName)"
      @click="emit('activate-agent-group', group)"
      @contextmenu.prevent="emit('group-contextmenu', $event, group)"
    >
      <v-icon size="11" style="flex-shrink: 0;">mdi-console</v-icon>
      <span class="tab-agent-name">{{ group.agentName ?? '?' }}</span>
      <v-icon
        class="tab-chevron"
        :style="isGroupCollapsed(group.agentName) ? {} : { transform: 'rotate(-90deg)' }"
        size="10"
        @click.stop="emit('toggle-group', group.agentName)"
      >
mdi-chevron-down
</v-icon>
      <span
        v-if="isGroupCollapsed(group.agentName)"
        class="tab-group-count"
      >{{ group.tabs.length }}</span>
    </button>

    <!-- Sub-chips session (hidden if group collapsed) -->
    <template v-if="!isGroupCollapsed(group.agentName)">
      <button
        v-for="tab in group.tabs"
        :key="tab.id"
        v-ripple
        class="tab-sub"
        :class="{ 'tab-sub--active': activeTabId === tab.id }"
        :style="subTabBgMap.get(tab.id)"
        :title="subTabLabel(tab)"
        @click="emit('activate', tab.id)"
        @mousedown="emit('middle-click', $event, tab)"
      >
        <span class="tab-sub-label">{{ subTabLabel(tab) }}</span>
        <span v-if="tab.dirty" class="tab-dirty" :title="t('tabBar.unsaved')" />
        <span
          class="tab-close text-label-medium"
          :title="t('tabBar.closeTab')"
          @click.stop="emit('close-tab', tab)"
        >✕</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tab-file {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 36px;
  align-self: center;
  font-size: 11px;
  font-weight: 500;
  border-radius: 18px;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.60);
  transition: background var(--md-duration-short3) var(--md-easing-standard),
              color var(--md-duration-short3) var(--md-easing-standard);
  user-select: none;
}
.tab-file:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.80);
}
.tab-file--active {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
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
   Active state: tinted bg (0.60) + agentFg text via subTabBgMap :style.
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
</style>
