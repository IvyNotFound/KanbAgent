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
        <v-btn
          :title="t('sidebar.backlog')"
          icon
          variant="text"
          @click="tabsStore.setActive('backlog')"
        >
          <v-icon size="18">mdi-view-list</v-icon>
        </v-btn>

        <v-divider class="rail-divider" />

        <!-- Agents -->
        <div class="rail-item">
          <v-btn
            :title="t('sidebar.agents')"
            icon
            variant="text"
            :class="{ 'rail-btn-active': activeSection === 'agents' }"
            @click="toggleSection('agents')"
          >
            <v-icon size="18">mdi-account-group</v-icon>
          </v-btn>
        </div>

        <!-- Périmètres -->
        <div class="rail-item">
          <v-btn
            :title="t('sidebar.perimeters')"
            icon
            variant="text"
            :class="{ 'rail-btn-active': activeSection === 'perimetres' }"
            @click="toggleSection('perimetres')"
          >
            <v-icon size="18">mdi-layers-outline</v-icon>
          </v-btn>
        </div>

        <!-- Arborescence -->
        <div class="rail-item">
          <v-btn
            :title="t('sidebar.tree')"
            icon
            variant="text"
            :class="{ 'rail-btn-active': activeSection === 'tree' }"
            @click="toggleSection('tree')"
          >
            <v-icon size="18">mdi-file-tree</v-icon>
          </v-btn>
        </div>

        <div class="rail-spacer" />

        <!-- Projet -->
        <div class="rail-item">
          <v-btn
            :title="t('sidebar.project')"
            icon
            variant="text"
            :class="{ 'rail-btn-active': isProjectPopupOpen }"
            @click="isProjectPopupOpen = true"
          >
            <v-icon size="18">mdi-folder-outline</v-icon>
          </v-btn>
        </div>

        <!-- Paramètres -->
        <div class="rail-item rail-item--bottom">
          <v-btn
            :title="t('sidebar.settings')"
            icon
            variant="text"
            :class="{ 'rail-btn-active': isSettingsOpen }"
            @click="isSettingsOpen = true"
          >
            <v-icon size="18">mdi-cog-outline</v-icon>
          </v-btn>
        </div>
      </div>

      <!-- ── Panel collapsible (0 → 272px) ── -->
      <div class="panel" :style="{ width: activeSection ? '272px' : '0px' }">
        <div class="panel-inner">

          <!-- Header -->
          <div class="panel-header">
            <p class="panel-title text-label-medium">
              {{ activeSection ? sectionTitles[activeSection] : '' }}
            </p>
            <v-btn
              :title="t('sidebar.close')"
              icon
              variant="text"
              density="compact"
              size="small"
              @click="activeSection = null"
            >
              <v-icon size="12">mdi-close</v-icon>
            </v-btn>
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

/* MD3: Navigation Drawer — rounded right corners on exposed edge (LTR), left stays 0 */
.sidebar-drawer {
  border-radius: 0 var(--shape-lg) var(--shape-lg) 0 !important;
}

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
  border-right: 1px solid rgb(var(--v-theme-edge-default));
}
/* Wrapper for rail buttons */
.rail-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail-item--bottom {
  margin-bottom: 4px;
}
/* MD3 Navigation Rail — active indicator pill (secondaryContainer, 40×32px) */
.rail-btn-active {
  border-radius: 16px !important;
  background: rgb(var(--v-theme-secondary-container)) !important;
  color: rgb(var(--v-theme-on-secondary-container)) !important;
  width: 40px !important;
  height: 32px !important;
}
.rail-divider {
  flex: none;
  width: 24px;
  margin: 2px 0;
}
.rail-spacer {
  flex: 1;
}
.panel {
  overflow: hidden;
  transition: width var(--md-duration-short4) var(--md-easing-emphasized-decelerate);
  flex-shrink: 0;
}
.panel-inner {
  width: 272px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgb(var(--v-theme-edge-default));
}
.panel-header {
  padding: 10px 16px;
  border-bottom: 1px solid rgb(var(--v-theme-edge-default));
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.panel-title {
  font-weight: 500; /* MD3 labelMedium */
  color: rgba(var(--v-theme-on-surface-variant), 1);
  letter-spacing: 0.02em;
  user-select: none;
}
</style>
