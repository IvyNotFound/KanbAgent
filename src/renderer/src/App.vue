<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import TitleBar from '@renderer/components/TitleBar.vue'
import Sidebar from '@renderer/components/Sidebar.vue'
import BoardView from '@renderer/components/BoardView.vue'
import DbSelector from '@renderer/components/DbSelector.vue'
import TabBar from '@renderer/components/TabBar.vue'
import TaskDetailModal from '@renderer/components/TaskDetailModal.vue'
import ToastContainer from '@renderer/components/ToastContainer.vue'
import ConfirmDialog from '@renderer/components/ConfirmDialog.vue'

// Lazy-loaded heavy components (CodeMirror, etc.)
const StreamView = defineAsyncComponent(() => import('@renderer/components/StreamView.vue'))
const FileView = defineAsyncComponent(() => import('@renderer/components/FileView.vue'))
const AgentLogsView = defineAsyncComponent(() => import('@renderer/components/AgentLogsView.vue'))
const TokenStatsView = defineAsyncComponent(() => import('@renderer/components/TokenStatsView.vue'))
const ExplorerView = defineAsyncComponent(() => import('@renderer/components/ExplorerView.vue'))
const CommandPalette = defineAsyncComponent(() => import('@renderer/components/CommandPalette.vue'))
const SetupWizard = defineAsyncComponent(() => import('@renderer/components/SetupWizard.vue'))
import { useAutoLaunch } from '@renderer/composables/useAutoLaunch'
import type { Task } from '@renderer/types'

const store = useTasksStore()
const tabsStore = useTabsStore()

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
  store.closeWizard()
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
  <div class="flex flex-col h-screen bg-surface-primary text-content-primary select-none">
    <TitleBar @open-search="isCommandPaletteOpen = true" />
    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar: only show when project is open -->
      <Sidebar v-if="store.projectPath" />
      <!-- Main content -->
      <main
        class="flex-1 flex flex-col overflow-hidden"
        :class="{ 'items-center justify-center': !store.projectPath }"
      >
        <!-- No project: centered content -->
        <div v-if="!store.projectPath" class="w-full max-w-3xl px-6">
          <DbSelector />
        </div>
        <!-- Project open -->
        <template v-else>
          <TabBar />
          <!-- Backlog tab -->
          <template v-if="tabsStore.activeTab.type === 'backlog'">
            <BoardView class="flex-1 min-h-0" />
          </template>
          <!-- Explorer tab -->
          <template v-else-if="tabsStore.activeTab.type === 'explorer'">
            <ExplorerView class="flex-1" />
          </template>
          <!-- File tabs -->
          <template v-else-if="tabsStore.activeTab.type === 'file'">
            <FileView :file-path="tabsStore.activeTab.filePath!" :tab-id="tabsStore.activeTab.id" class="flex-1" />
          </template>
          <!-- Logs tab -->
          <template v-else-if="tabsStore.activeTab.type === 'logs'">
            <AgentLogsView :initial-agent-id="tabsStore.activeTab.logsAgentId" class="flex-1" />
          </template>
          <!-- Metrics tab -->
          <template v-else-if="tabsStore.activeTab.type === 'metrics'">
            <TokenStatsView class="flex-1" />
          </template>
          <!-- Terminal tabs (keep mounted to preserve session, hide inactive) -->
          <template v-for="tab in tabsStore.tabs.filter(t => t.type === 'terminal')" :key="tab.id">
            <div
              class="flex-1 overflow-hidden"
              :style="{ display: tabsStore.activeTabId === tab.id ? 'flex' : 'none' }"
            >
              <StreamView :terminal-id="tab.id" class="flex-1" />
            </div>
          </template>
        </template>
      </main>
    </div>
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
  </div>
</template>
