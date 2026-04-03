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
import TaskDetailModal from '@renderer/components/TaskDetailModal.vue'
import ToastContainer from '@renderer/components/ToastContainer.vue'
import ConfirmDialog from '@renderer/components/ConfirmDialog.vue'
import UpdateNotification from '@renderer/components/UpdateNotification.vue'

// Lazy-loaded heavy components (CodeMirror, etc.)
const StreamView = defineAsyncComponent(() => import('@renderer/components/StreamView.vue'))
const FileView = defineAsyncComponent(() => import('@renderer/components/FileView.vue'))
const DashboardView = defineAsyncComponent(() => import('@renderer/components/DashboardView.vue'))
const TimelineView = defineAsyncComponent(() => import('@renderer/components/TimelineView.vue'))
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
  for (const agentId of agentIds) {
    const agent = agentsStore.agents.find((a) => a.id === agentId)
    if (!agent) continue
    if (agent.name === 'task-creator') continue // never auto-close: interactive agent
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
            <!-- Timeline tab (vue gantt des tâches par agent) -->
            <template v-else-if="tabsStore.activeTab.type === 'timeline'">
              <TimelineView style="flex: 1;" />
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
/* Force v-main wrap to be a flex column filling available space */
.app-main :deep(.v-main__wrap) {
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
</style>
