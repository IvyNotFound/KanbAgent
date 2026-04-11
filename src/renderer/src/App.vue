<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onUnmounted } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import TitleBar from '@renderer/components/TitleBar.vue'
import Sidebar from '@renderer/components/Sidebar.vue'
import BoardView from '@renderer/components/BoardView.vue'
import DbSelector from '@renderer/components/DbSelector.vue'
import TabBar from '@renderer/components/TabBar.vue'
const TaskDetailModal = defineAsyncComponent(() => import('@renderer/components/TaskDetailModal.vue'))
import ToastContainer from '@renderer/components/ToastContainer.vue'
import ConfirmDialog from '@renderer/components/ConfirmDialog.vue'
import UpdateNotification from '@renderer/components/UpdateNotification.vue'

// Lazy-loaded heavy components (CodeMirror, etc.)
const StreamView = defineAsyncComponent(() => import('@renderer/components/StreamView.vue'))
const FileView = defineAsyncComponent(() => import('@renderer/components/FileView.vue'))
const DashboardView = defineAsyncComponent(() => import('@renderer/components/DashboardView.vue'))
const ExplorerView = defineAsyncComponent(() => import('@renderer/components/ExplorerView.vue'))
const CommandPalette = defineAsyncComponent(() => import('@renderer/components/CommandPalette.vue'))
const SetupWizard = defineAsyncComponent(() => import('@renderer/components/SetupWizard.vue'))
import { useAutoLaunch } from '@renderer/composables/useAutoLaunch'
import { useHookEventsStore } from '@renderer/stores/hookEvents'
import { useAgentsStore } from '@renderer/stores/agents'
import { useProjectStore } from '@renderer/stores/project'
import type { Task } from '@renderer/types'

const store = useTasksStore()
const tabsStore = useTabsStore()
const settingsStore = useSettingsStore()
const hookEventsStore = useHookEventsStore()
const agentsStore = useAgentsStore()
const projectStore = useProjectStore()

// Set up global IPC listener for Claude Code hook events (T742).
// Registered once at app level so all StreamView instances share the same store.
const unsubHookEvent = window.electronAPI.onHookEvent?.((e) => hookEventsStore.push(e))

// Auto-close agent tab groups when session-closer completes their sessions (T1186).
// 3s delay lets the user read the last output lines before tabs disappear.
const pendingCloseTimers: ReturnType<typeof setTimeout>[] = []
const unsubSessionsCompleted = window.electronAPI.onSessionsCompleted?.((agentIds: number[]) => {
  if (!settingsStore.autoLaunchAgentSessions) return // T1930: respect auto-close setting
  for (const agentId of agentIds) {
    const agent = agentsStore.agents.find((a) => a.id === agentId)
    if (!agent) continue
    if (agent.name === 'task-creator') continue // never auto-close: interactive agent
    // T1931: skip if agent has an active process (streamId set = process running)
    const hasActiveProcess = tabsStore.tabs.some(
      (t) => t.type === 'terminal' && t.agentName === agent.name && t.streamId
    )
    if (hasActiveProcess) continue
    const timer = setTimeout(() => tabsStore.closeTabGroup(agent.name), 3000)
    pendingCloseTimers.push(timer)
  }
})

onUnmounted(() => {
  unsubHookEvent?.()
  unsubSessionsCompleted?.()
  for (const timer of pendingCloseTimers) clearTimeout(timer)
})

// Auto-launch agent terminals when tasks are created with assigned agents (T340)
useAutoLaunch({
  tasks: computed(() => store.tasks),
  agents: computed(() => store.agents),
  dbPath: computed(() => store.dbPath),
})

const isCommandPaletteOpen = ref(false)

function openTaskFromPalette(task: Task) {
  store.openTask(task)
}

async function onWizardDone(payload: { projectPath: string; dbPath: string }) {
  projectStore.closeWizard()
  await store.setProject(payload.projectPath, payload.dbPath)
}

// Expose toggle function for CommandPalette keyboard shortcut
defineExpose({
  toggleCommandPalette: () => {
    isCommandPaletteOpen.value = !isCommandPaletteOpen.value
  }
})
</script>

<template>
  <v-app :theme="settingsStore.theme">
    <TitleBar @open-search="isCommandPaletteOpen = true" />
    <Sidebar v-if="store.projectPath" />
    <v-main class="app-main">
      <div class="main-wrap">
        <UpdateNotification />
        <!-- No project: centered content -->
        <div v-if="!store.projectPath" class="no-project-center">
          <div class="no-project-inner">
            <DbSelector />
          </div>
        </div>
        <!-- Project open -->
        <template v-else>
          <TabBar />
          <div class="view-container">
            <!-- Backlog tab -->
            <template v-if="tabsStore.activeTab.type === 'backlog'">
              <BoardView style="flex: 1; min-height: 0;" />
            </template>
            <!-- Explorer tab -->
            <template v-else-if="tabsStore.activeTab.type === 'explorer'">
              <ExplorerView style="flex: 1;" />
            </template>
            <!-- File tabs -->
            <template v-else-if="tabsStore.activeTab.type === 'file'">
              <FileView :key="tabsStore.activeTab.id" :file-path="tabsStore.activeTab.filePath!" :tab-id="tabsStore.activeTab.id" style="flex: 1;" />
            </template>
            <!-- Dashboard tab (sous-onglets analytiques) -->
            <template v-else-if="tabsStore.activeTab.type === 'dashboard'">
              <DashboardView style="flex: 1;" />
            </template>
            <!-- Terminal tabs (keep mounted to preserve session, hide inactive) -->
            <template v-for="tab in tabsStore.tabs.filter(t => t.type === 'terminal')" :key="tab.id">
              <div
                style="overflow: hidden; height: 100%;"
                :style="{ display: tabsStore.activeTabId === tab.id ? 'flex' : 'none', flex: tabsStore.activeTabId === tab.id ? '1' : undefined }"
              >
                <StreamView :terminal-id="tab.id" style="flex: 1;" />
              </div>
            </template>
          </div>
        </template>
      </div>
    </v-main>
    <TaskDetailModal />
    <ToastContainer />
    <ConfirmDialog />
    <!-- DB corruption dialog — shown when query returns { success: false, error: 'DB_CORRUPT' } -->
    <v-dialog :model-value="store.error === 'DB_CORRUPT'" max-width="420" persistent>
      <v-card elevation="3" role="alertdialog" aria-modal="true" aria-label="Corrupted database">
        <v-card-text class="pa-5 pb-3">
          <div class="d-flex align-start ga-3">
            <div class="db-corrupt-icon d-flex align-center justify-center">
              <v-icon size="20" class="db-corrupt-icon__svg">mdi-alert-circle-outline</v-icon>
            </div>
            <div class="flex-grow-1">
              <h3 class="text-subtitle-2 font-weight-medium">Corrupted database</h3>
              <p class="text-body-2 text-medium-emphasis mt-2">
                The <code>project.db</code> file is damaged. Delete it or restore a backup, then reload the project.
              </p>
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="px-5 py-4 db-corrupt-actions">
          <v-spacer />
          <v-btn color="error" variant="flat" @click="store.closeProject()">Close project</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <!-- Migration failure banner — persistent until dismissed or project closed -->
    <v-snackbar
      :model-value="!!store.migrationError"
      color="error"
      location="top"
      timeout="-1"
      multi-line
    >
      <div class="d-flex align-center ga-2">
        <v-icon>mdi-database-alert-outline</v-icon>
        <div>
          <strong>Database migration failed</strong>
          <div class="text-body-2">{{ store.migrationError }}</div>
        </div>
      </div>
      <template #actions>
        <v-btn variant="text" @click="store.migrationError = null">Dismiss</v-btn>
      </template>
    </v-snackbar>
    <CommandPalette v-model="isCommandPaletteOpen" @select-task="openTaskFromPalette" />
    <SetupWizard
      v-if="store.setupWizardTarget"
      :project-path="store.setupWizardTarget.projectPath"
      :has-claude-md="store.setupWizardTarget.hasCLAUDEmd"
      @done="onWizardDone"
      @skip="store.closeWizard()"
    />
  </v-app>
</template>

<style scoped>
/* Constrain v-main to viewport height so the flex chain below can resolve.
   Without this, v-main's flex-shrink:0 lets it grow unbounded (= content height),
   making all downstream height:100% resolve to content height, not 100dvh. */
.app-main {
  height: 100%;
  min-height: 0;
}
/* Force v-main scroller to be a flex column filling available space.
   Vuetify 3.12 renamed .v-main__wrap → .v-main__scroller (confirmed in vuetify@3.12.4). */
.app-main :deep(.v-main__scroller) {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.main-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  /* Reserve right edge (~8px) for the native window resize zone.
     Prevents scrollbars of child views from sitting inside Electron's
     resize detection zone on Windows (frame: false). */
  padding-right: 8px;
}
.no-project-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.no-project-inner {
  width: 100%;
  max-width: 48rem;
  padding: 0 1.5rem;
}
.view-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.db-corrupt-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--shape-sm);
  flex-shrink: 0;
  background-color: rgba(var(--v-theme-error), 0.15);
}
.db-corrupt-icon__svg { color: rgb(var(--v-theme-error)); }
.db-corrupt-actions {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
