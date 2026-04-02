<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import SettingsModal from './SettingsModal.vue'
import ProjectPopup from './ProjectPopup.vue'
import SidebarFileTree from './SidebarFileTree.vue'
import SidebarAgentSection from './SidebarAgentSection.vue'
import SidebarPerimetreSection from './SidebarPerimetreSection.vue'

type Section = 'perimetres' | 'agents' | 'tree'

const { t } = useI18n()
const tabsStore = useTabsStore()
const store = useTasksStore()

const activeSection = ref<Section | null>('agents')
const isSettingsOpen = ref(false)
const isProjectPopupOpen = ref(false)
const fileTreeRef = ref<InstanceType<typeof SidebarFileTree> | null>(null)

const sectionTitles = computed((): Record<Section, string> => ({
  perimetres: t('sidebar.perimeters'),
  agents: t('sidebar.agents'),
  tree: t('sidebar.tree'),
}))

// Width: rail (48px) only or rail + panel (48 + 272 = 320px)
const drawerWidth = computed(() => activeSection.value ? 320 : 48)

function toggleSection(section: Section) {
  const next = activeSection.value === section ? null : section
  activeSection.value = next
  if (next === 'tree') {
    fileTreeRef.value?.loadSidebarTree()
  }
}
</script>

<template>
  <!-- permanent: always visible, never overlays content.
       :width transitions between rail-only (48px) and full (320px). -->
  <v-navigation-drawer
    permanent
    :width="drawerWidth"
    class="sidebar-drawer"
  >
    <div class="sidebar-inner">
      <!-- ── Activity Rail (always visible, 48px) ── -->
      <div class="rail">

        <!-- Backlog — direct navigation to backlog tab -->
        <button :title="t('sidebar.backlog')" class="rail-btn" @click="tabsStore.setActive('backlog')">
          <v-icon size="18">mdi-view-list</v-icon>
        </button>

        <hr class="rail-divider">

        <!-- Agents -->
        <button :title="t('sidebar.agents')" :class="['rail-btn', activeSection === 'agents' && 'rail-btn--active']" @click="toggleSection('agents')">
          <span v-if="activeSection === 'agents'" class="rail-indicator" />
          <v-icon size="18">mdi-account-group</v-icon>
        </button>

        <!-- Périmètres -->
        <button :title="t('sidebar.perimeters')" :class="['rail-btn', activeSection === 'perimetres' && 'rail-btn--active']" @click="toggleSection('perimetres')">
          <span v-if="activeSection === 'perimetres'" class="rail-indicator" />
          <v-icon size="18">mdi-layers-outline</v-icon>
        </button>

        <!-- Arborescence -->
        <button :title="t('sidebar.tree')" :class="['rail-btn', activeSection === 'tree' && 'rail-btn--active']" @click="toggleSection('tree')">
          <span v-if="activeSection === 'tree'" class="rail-indicator" />
          <v-icon size="18">mdi-file-tree</v-icon>
        </button>

        <div class="rail-spacer" />

        <!-- Projet -->
        <button :title="t('sidebar.project')" :class="['rail-btn', isProjectPopupOpen && 'rail-btn--active']" @click="isProjectPopupOpen = true">
          <span v-if="isProjectPopupOpen" class="rail-indicator" />
          <v-icon size="18">mdi-folder-outline</v-icon>
        </button>

        <!-- Paramètres -->
        <button :title="t('sidebar.settings')" :class="['rail-btn rail-btn--bottom', isSettingsOpen && 'rail-btn--active']" @click="isSettingsOpen = true">
          <span v-if="isSettingsOpen" class="rail-indicator" />
          <v-icon size="18">mdi-cog-outline</v-icon>
        </button>
      </div>

      <!-- ── Panel collapsible (0 → 272px) ── -->
      <div class="panel" :style="{ width: activeSection ? '272px' : '0px' }">
        <div class="panel-inner">

          <!-- Header -->
          <div class="panel-header">
            <p class="panel-title">
              {{ activeSection ? sectionTitles[activeSection] : '' }}
            </p>
            <button class="panel-close" :title="t('sidebar.close')" @click="activeSection = null">
              <v-icon size="12">mdi-close</v-icon>
            </button>
          </div>

          <!-- Sections -->
          <template v-if="activeSection === 'perimetres'">
            <SidebarPerimetreSection />
          </template>

          <template v-else-if="activeSection === 'agents'">
            <SidebarAgentSection />
          </template>

          <template v-else-if="activeSection === 'tree'">
            <SidebarFileTree ref="fileTreeRef" :project-path="store.projectPath" />
          </template>

        </div>
      </div>
    </div>
  </v-navigation-drawer>

  <SettingsModal v-if="isSettingsOpen" @close="isSettingsOpen = false" />
  <ProjectPopup v-if="isProjectPopupOpen" @close="isProjectPopupOpen = false" />
</template>

<style scoped>
/* Scoped CSS justified: custom rail+panel pattern has no direct Vuetify equivalent;
   the rail (48px) + sliding panel (0-272px) pattern requires precise width control */
.sidebar-drawer :deep(.v-navigation-drawer__content) {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sidebar-inner {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.rail {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.rail-btn {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  transition: background 150ms, color 150ms;
}
.rail-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.8);
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.rail-btn--active {
  color: rgba(var(--v-theme-on-surface), 0.9);
  background: rgba(var(--v-theme-on-surface), 0.12);
}
.rail-btn--bottom {
  margin-bottom: 4px;
}
.rail-icon {
  width: 18px;
  height: 18px;
}
.rail-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 20px;
  background: rgba(var(--v-theme-on-surface), 0.9);
  border-radius: 0 2px 2px 0;
}
.rail-divider {
  border: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  width: 24px;
  margin: 2px 0;
}
.rail-spacer {
  flex: 1;
}
.panel {
  overflow: hidden;
  transition: width 200ms ease-in-out;
  flex-shrink: 0;
}
.panel-inner {
  width: 272px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.panel-header {
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.panel-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  user-select: none;
}
.panel-close {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: none;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.3);
  cursor: pointer;
  transition: background 150ms, color 150ms;
}
.panel-close:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.08);
}
</style>
