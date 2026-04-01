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
          <svg viewBox="0 0 16 16" fill="currentColor" class="rail-icon">
            <rect x="1"  y="2" width="4" height="12" rx="1.5"/>
            <rect x="6"  y="2" width="4" height="8"  rx="1.5"/>
            <rect x="11" y="2" width="4" height="5"  rx="1.5"/>
          </svg>
        </button>

        <hr class="rail-divider">

        <!-- Agents -->
        <button :title="t('sidebar.agents')" :class="['rail-btn', activeSection === 'agents' && 'rail-btn--active']" @click="toggleSection('agents')">
          <span v-if="activeSection === 'agents'" class="rail-indicator" />
          <svg viewBox="0 0 16 16" fill="currentColor" class="rail-icon">
            <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1h8zm-7.978-1A.261.261 0 0 1 7 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002a.274.274 0 0 1-.014.002H7.022zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm3-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6.936 9.28a5.88 5.88 0 0 0-1.23-.247A7.35 7.35 0 0 0 5 9c-4 0-5 3-5 4 0 .667.333 1 1 1h4.216A2.238 2.238 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816zM4.92 10A5.493 5.493 0 0 0 4 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.276zM1.5 5.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm3-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
          </svg>
        </button>

        <!-- Périmètres -->
        <button :title="t('sidebar.perimeters')" :class="['rail-btn', activeSection === 'perimetres' && 'rail-btn--active']" @click="toggleSection('perimetres')">
          <span v-if="activeSection === 'perimetres'" class="rail-indicator" />
          <svg viewBox="0 0 16 16" fill="currentColor" class="rail-icon">
            <path d="M8.235 1.559a.5.5 0 0 0-.47 0l-7.5 4a.5.5 0 0 0 0 .882L3.188 8 .264 9.559a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882L12.813 8l2.922-1.559a.5.5 0 0 0 0-.882l-7.5-4zm3.515 7.008L14.438 10 8 13.433 1.562 10 4.25 8.567l3.515 1.874a.5.5 0 0 0 .47 0l3.515-1.874zM8 9.433 1.562 6 8 2.567 14.438 6 8 9.433z"/>
          </svg>
        </button>

        <!-- Arborescence -->
        <button :title="t('sidebar.tree')" :class="['rail-btn', activeSection === 'tree' && 'rail-btn--active']" @click="toggleSection('tree')">
          <span v-if="activeSection === 'tree'" class="rail-indicator" />
          <svg viewBox="0 0 16 16" fill="currentColor" class="rail-icon">
            <path fill-rule="evenodd" d="M4.5 11.5A.5.5 0 0 1 5 11h10a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm-2-4A.5.5 0 0 1 3 7h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm-2-4A.5.5 0 0 1 1 3h10a.5.5 0 0 1 0 1H1a.5.5 0 0 1-.5-.5z"/>
          </svg>
        </button>

        <div class="rail-spacer" />

        <!-- Projet -->
        <button :title="t('sidebar.project')" :class="['rail-btn', isProjectPopupOpen && 'rail-btn--active']" @click="isProjectPopupOpen = true">
          <span v-if="isProjectPopupOpen" class="rail-indicator" />
          <svg viewBox="0 0 16 16" fill="currentColor" class="rail-icon">
            <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
          </svg>
        </button>

        <!-- Paramètres -->
        <button :title="t('sidebar.settings')" :class="['rail-btn rail-btn--bottom', isSettingsOpen && 'rail-btn--active']" @click="isSettingsOpen = true">
          <span v-if="isSettingsOpen" class="rail-indicator" />
          <svg viewBox="0 0 16 16" fill="currentColor" class="rail-icon">
            <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
          </svg>
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
              <svg viewBox="0 0 16 16" fill="currentColor" style="width: 12px; height: 12px;">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
              </svg>
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
