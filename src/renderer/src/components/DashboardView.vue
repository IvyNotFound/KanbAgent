<script setup lang="ts">
import { ref, defineAsyncComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import TokenStatsView from './TokenStatsView.vue'
import GitCommitList from './GitCommitList.vue'
import HookEventsView from './HookEventsView.vue'
import ToolStatsPanel from './ToolStatsPanel.vue'
import ActivityHeatmap from './ActivityHeatmap.vue'
import AgentQualityPanel from './AgentQualityPanel.vue'
import AgentLogsView from './AgentLogsView.vue'

const WorkloadView = defineAsyncComponent(() => import('./WorkloadView.vue'))
const TopologyView = defineAsyncComponent(() => import('./TopologyView.vue'))

type SubTab = 'tokenStats' | 'git' | 'hooks' | 'tools' | 'heatmap' | 'quality' | 'workload' | 'topology' | 'logs'

const { t } = useI18n()
const store = useTasksStore()

const STORAGE_KEY = 'dashboard.activeSubTab'
const savedTab = localStorage.getItem(STORAGE_KEY) as SubTab | null
const activeSubTab = ref<SubTab>(savedTab ?? 'logs')

watch(activeSubTab, (tab) => {
  localStorage.setItem(STORAGE_KEY, tab)
  if (tab === 'git' && gitCommits.value.length === 0) fetchGitCommits()
})

// ── Git commits ──────────────────────────────────────────────────────────────
interface GitCommit { hash: string; date: string; subject: string; author: string; taskIds: number[] }
const gitCommits = ref<GitCommit[]>([])
const gitLoading = ref(false)

async function fetchGitCommits(): Promise<void> {
  if (!store.projectPath) return
  gitLoading.value = true
  try {
    const result = await window.electronAPI.gitLog(store.projectPath, { limit: 100 })
    gitCommits.value = result as GitCommit[]
  } catch { gitCommits.value = [] }
  finally { gitLoading.value = false }
}

if (activeSubTab.value === 'git') fetchGitCommits()

// ── Sub-tab definitions ──────────────────────────────────────────────────────
const subTabs: { id: SubTab; label: string }[] = [
  { id: 'tokenStats', label: t('tokenStats.title') },
  { id: 'git',        label: 'Git' },
  { id: 'hooks',      label: t('sidebar.hooks') },
  { id: 'tools',      label: t('toolStats.title') },
  { id: 'heatmap',    label: 'Heatmap' },
  { id: 'quality',    label: 'Qualité' },
  { id: 'workload',   label: t('sidebar.workload') },
  { id: 'topology',   label: t('sidebar.topology') },
  { id: 'logs',       label: t('tokenStats.logsTab') },
]
</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary min-h-0">

    <!-- Sub-tab bar -->
    <div class="shrink-0 flex items-center gap-0.5 px-4 pt-2.5 pb-0 bg-surface-base overflow-x-auto">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-semibold transition-colors border border-b-0 shrink-0',
          activeSubTab === tab.id
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <!-- Token Stats -->
    <TokenStatsView v-show="activeSubTab === 'tokenStats'" />

    <!-- Git -->
    <template v-if="activeSubTab === 'git'">
      <div v-if="gitLoading" class="flex items-center justify-center flex-1 py-8">
        <p class="text-xs text-content-faint animate-pulse">{{ t('common.loading') }}</p>
      </div>
      <div v-else-if="gitCommits.length === 0" class="flex items-center justify-center flex-1 py-8">
        <p class="text-xs text-content-faint italic">{{ t('git.noCommits') }}</p>
      </div>
      <GitCommitList
        v-else
        :commits="gitCommits"
        class="flex-1 min-h-0"
        @open-task="(id) => { const task = store.tasks.find(x => x.id === id); if (task) store.openTask(task) }"
      />
    </template>

    <!-- Hooks -->
    <HookEventsView v-if="activeSubTab === 'hooks'" class="flex-1 min-h-0" />

    <!-- Tools -->
    <ToolStatsPanel v-if="activeSubTab === 'tools'" class="flex-1 min-h-0" />

    <!-- Heatmap -->
    <ActivityHeatmap
      v-if="activeSubTab === 'heatmap' && store.dbPath"
      :db-path="store.dbPath"
      class="flex-1"
    />

    <!-- Quality -->
    <AgentQualityPanel v-if="activeSubTab === 'quality'" class="flex-1 min-h-0" />

    <!-- Workload -->
    <WorkloadView v-if="activeSubTab === 'workload'" class="flex-1 min-h-0" />

    <!-- Topology -->
    <TopologyView v-if="activeSubTab === 'topology'" class="flex-1 min-h-0" />

    <!-- Logs -->
    <AgentLogsView v-if="activeSubTab === 'logs'" class="flex-1 min-h-0" />

  </div>
</template>
