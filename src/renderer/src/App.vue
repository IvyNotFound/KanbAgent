<script setup lang="ts">
import { ref } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import TitleBar from '@renderer/components/TitleBar.vue'
import Sidebar from '@renderer/components/Sidebar.vue'
import BoardView from '@renderer/components/BoardView.vue'
import DbSelector from '@renderer/components/DbSelector.vue'
import TabBar from '@renderer/components/TabBar.vue'
import TerminalView from '@renderer/components/TerminalView.vue'
import TaskDetailModal from '@renderer/components/TaskDetailModal.vue'
import ExplorerView from '@renderer/components/ExplorerView.vue'
import FileView from '@renderer/components/FileView.vue'
import AgentLogsView from '@renderer/components/AgentLogsView.vue'
import ToastContainer from '@renderer/components/ToastContainer.vue'
import CommandPalette from '@renderer/components/CommandPalette.vue'
import SetupWizard from '@renderer/components/SetupWizard.vue'
import type { Task } from '@renderer/types'

const store = useTasksStore()
const tabsStore = useTabsStore()

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
  <div class="flex flex-col h-screen bg-zinc-900 text-zinc-100 select-none">
    <TitleBar />
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
            <BoardView />
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
          <!-- Terminal tabs (keep mounted to preserve session, hide inactive) -->
          <template v-for="tab in tabsStore.tabs.filter(t => t.type === 'terminal')" :key="tab.id">
            <div
              class="flex-1 overflow-hidden"
              :style="{ display: tabsStore.activeTabId === tab.id ? 'flex' : 'none' }"
            >
              <TerminalView :tab-id="tab.id" :is-active="tabsStore.activeTabId === tab.id" class="flex-1" />
            </div>
          </template>
        </template>
      </main>
    </div>
    <TaskDetailModal />
    <ToastContainer />
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
