<script setup lang="ts">
import { ref, computed, defineAsyncComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import TokenStatsView from './TokenStatsView.vue'
import GitCommitList from './GitCommitList.vue'
import HookEventsView from './HookEventsView.vue'
import ToolStatsPanel from './ToolStatsPanel.vue'
import AgentLogsView from './AgentLogsView.vue'
import DashboardOverview from './DashboardOverview.vue'

const TopologyView = defineAsyncComponent(() => import('./TopologyView.vue'))
const OrgChartView = defineAsyncComponent(() => import('./OrgChartView.vue'))

type SubTab = 'overview' | 'tokenStats' | 'git' | 'hooks' | 'tools' | 'topology' | 'orgchart' | 'logs'

const { t } = useI18n()
const store = useTasksStore()

const STORAGE_KEY = 'dashboard.activeSubTab'
const VALID_TABS: SubTab[] = ['overview', 'tokenStats', 'git', 'hooks', 'tools', 'topology', 'orgchart', 'logs']
const savedTab = localStorage.getItem(STORAGE_KEY) as SubTab | null
const activeSubTab = ref<SubTab>(savedTab && VALID_TABS.includes(savedTab) ? savedTab : 'overview')

watch(activeSubTab, (tab) => {
  localStorage.setItem(STORAGE_KEY, tab)
  if (tab === 'git' && gitCommits.value.length === 0) fetchGitCommits()
})

// ── Git commits ──────────────────────────────────────────────────────────────
interface GitCommit { hash: string; date: string; subject: string; author: string; taskIds: number[] }
const gitCommits = ref<GitCommit[]>([])
const gitLoading = ref(false)
type GitError = 'no-project' | 'no-commits' | 'error' | null
const gitError = ref<GitError>(null)

async function fetchGitCommits(): Promise<void> {
  if (!store.projectPath) {
    gitError.value = 'no-project'
    return
  }
  gitLoading.value = true
  gitError.value = null
  try {
    const result = await window.electronAPI.gitLog(store.projectPath, { limit: 100 })
    gitCommits.value = result as GitCommit[]
    if (result.length === 0) gitError.value = 'no-commits'
  } catch (err) {
    console.warn('[GitTab] fetchGitCommits failed', err)
    gitError.value = 'error'
    gitCommits.value = []
  } finally {
    gitLoading.value = false
  }
}

if (activeSubTab.value === 'git') fetchGitCommits()

// ── Sub-tab definitions ──────────────────────────────────────────────────────
const subTabs = computed<{ id: SubTab; label: string }[]>(() => [
  { id: 'overview',   label: t('dashboard.overview') },
  { id: 'tokenStats', label: t('tokenStats.title') },
  { id: 'git',        label: 'Git' },
  { id: 'hooks',      label: t('sidebar.hooks') },
  { id: 'tools',      label: t('toolStats.title') },
  { id: 'topology',   label: t('sidebar.topology') },
  { id: 'orgchart',   label: t('orgchart.tabLabel') },
  { id: 'logs',       label: t('tokenStats.logsTab') },
])
</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary min-h-0">

    <!-- Sub-tab bar -->
    <div class="subtab-scroll shrink-0 flex items-center gap-0.5 px-4 pt-2.5 pb-0 bg-surface-base border-b border-edge-subtle overflow-x-scroll">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        :class="[
          'px-3 py-1 rounded-t text-xs font-semibold transition-colors border border-b-0 shrink-0',
          activeSubTab === tab.id
            ? 'text-content-secondary bg-surface-primary border-edge-subtle mb-[-1px]'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <!-- Overview -->
    <DashboardOverview v-if="activeSubTab === 'overview'" class="flex-1 min-h-0" />

    <!-- Token Stats -->
    <TokenStatsView v-show="activeSubTab === 'tokenStats'" class="flex-1 min-h-0" />

    <!-- Git -->
    <template v-if="activeSubTab === 'git'">
      <!-- Toolbar -->
      <div class="shrink-0 flex items-center justify-end px-4 py-1.5 border-b border-edge-subtle">
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs text-content-muted hover:text-content-primary rounded transition-colors disabled:opacity-40"
          :disabled="gitLoading"
          @click="fetchGitCommits"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5" :class="{ 'animate-spin': gitLoading }">
            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
          </svg>
          {{ t('common.refresh') }}
        </button>
      </div>
      <!-- Loading -->
      <div v-if="gitLoading" class="flex items-center justify-center flex-1 py-8">
        <p class="text-xs text-content-faint animate-pulse">{{ t('common.loading') }}</p>
      </div>
      <!-- Error states -->
      <div v-else-if="gitError" class="flex flex-col items-center justify-center flex-1 py-8 gap-3">
        <p class="text-xs text-content-faint italic">
          <template v-if="gitError === 'no-project'">{{ t('common.noProject') }}</template>
          <template v-else-if="gitError === 'no-commits'">{{ t('git.noCommits') }}</template>
          <template v-else>{{ t('dashboard.gitError') }}</template>
        </p>
        <button
          v-if="gitError === 'error'"
          class="px-3 py-1 text-xs bg-surface-secondary hover:bg-surface-tertiary text-content-muted rounded transition-colors"
          @click="fetchGitCommits"
        >
          {{ t('common.retry') }}
        </button>
      </div>
      <!-- Commit list -->
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

    <!-- Topology -->
    <TopologyView v-if="activeSubTab === 'topology'" class="flex-1 min-h-0" />

    <!-- OrgChart -->
    <OrgChartView v-if="activeSubTab === 'orgchart'" class="flex-1 min-h-0" />

    <!-- Logs -->
    <AgentLogsView v-if="activeSubTab === 'logs'" class="flex-1 min-h-0" />

  </div>
</template>

<style scoped>
.subtab-scroll::-webkit-scrollbar { display: none; }
.subtab-scroll { scrollbar-width: none; -ms-overflow-style: none; }
</style>
