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
const TelemetryView = defineAsyncComponent(() => import('./TelemetryView.vue'))
const TimelineView = defineAsyncComponent(() => import('./TimelineView.vue'))

type SubTab = 'overview' | 'tokenStats' | 'git' | 'hooks' | 'tools' | 'topology' | 'orgchart' | 'logs' | 'telemetry' | 'timeline'

const { t } = useI18n()
const store = useTasksStore()

const STORAGE_KEY = 'dashboard.activeSubTab'
const VALID_TABS: SubTab[] = ['overview', 'tokenStats', 'git', 'hooks', 'tools', 'topology', 'orgchart', 'logs', 'telemetry', 'timeline']
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
  { id: 'telemetry', label: t('dashboard.telemetryTab') },
  { id: 'timeline',  label: t('timeline.title') },
])
</script>

<template>
  <div class="dashboard-view">

    <!-- Sub-tab bar -->
    <v-tabs
      v-model="activeSubTab"
      density="compact"
      class="dashboard-tabs"
      show-arrows
    >
      <v-tab
        v-for="tab in subTabs"
        :key="tab.id"
        :value="tab.id"
      >{{ tab.label }}</v-tab>
    </v-tabs>

    <!-- Overview -->
    <DashboardOverview v-if="activeSubTab === 'overview'" class="tab-content" />

    <!-- Token Stats -->
    <TokenStatsView v-show="activeSubTab === 'tokenStats'" class="tab-content" />

    <!-- Git -->
    <div v-if="activeSubTab === 'git'" class="tab-content git-panel">
      <!-- Toolbar -->
      <div class="git-toolbar d-flex align-center justify-space-between px-4">
        <h2 class="git-title text-h6 font-weight-medium">Git</h2>
        <v-btn
          icon="mdi-refresh"
          variant="text"
          size="small"
          :loading="gitLoading"
          :title="t('common.refresh')"
          @click="fetchGitCommits"
        />
      </div>
      <!-- Loading -->
      <div v-if="gitLoading" class="d-flex align-center justify-center flex-1 pa-8">
        <v-progress-circular indeterminate :size="32" :width="3" />
      </div>
      <!-- Error states -->
      <div v-else-if="gitError" class="d-flex flex-column align-center justify-center flex-1 pa-8 ga-3">
        <v-icon size="32" color="medium-emphasis">{{ gitError === 'error' ? 'mdi-alert-circle-outline' : 'mdi-source-commit' }}</v-icon>
        <p class="text-caption text-medium-emphasis font-italic">
          <template v-if="gitError === 'no-project'">{{ t('common.noProject') }}</template>
          <template v-else-if="gitError === 'no-commits'">{{ t('git.noCommits') }}</template>
          <template v-else>{{ t('dashboard.gitError') }}</template>
        </p>
        <v-btn
          v-if="gitError === 'error'"
          variant="tonal"
          size="small"
          @click="fetchGitCommits"
        >
          {{ t('common.retry') }}
        </v-btn>
      </div>
      <!-- Commit list -->
      <GitCommitList
        v-else
        :commits="gitCommits"
        class="flex-1"
        @open-task="(id) => { const task = store.tasks.find(x => x.id === id); if (task) store.openTask(task) }"
      />
    </div>

    <!-- Hooks -->
    <HookEventsView v-if="activeSubTab === 'hooks'" class="tab-content" />

    <!-- Tools -->
    <ToolStatsPanel v-if="activeSubTab === 'tools'" class="tab-content" />

    <!-- Topology -->
    <TopologyView v-if="activeSubTab === 'topology'" class="tab-content" />

    <!-- OrgChart -->
    <OrgChartView v-if="activeSubTab === 'orgchart'" class="tab-content" />

    <!-- Logs -->
    <AgentLogsView v-if="activeSubTab === 'logs'" class="tab-content" />

    <!-- Telemetry -->
    <TelemetryView v-if="activeSubTab === 'telemetry'" class="tab-content" />

    <!-- Timeline -->
    <TimelineView v-if="activeSubTab === 'timeline'" class="tab-content" />

  </div>
</template>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-primary);
}

.dashboard-tabs {
  flex-shrink: 0;
  border-bottom: 1px solid var(--edge-subtle);
}

/* Uniform vertical alignment for all tab titles — text-caption interferes with
   Vuetify's internal line-height in density="compact", causing uneven baselines */
.dashboard-tabs :deep(.v-tab) {
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  align-items: center;
  min-height: 36px;
  padding-inline: 16px;
  text-transform: none;
}

.tab-content {
  flex: 1;
  min-height: 0;
}

.git-panel {
  display: flex;
  flex-direction: column;
  background: var(--surface-base);
}

.git-toolbar {
  flex-shrink: 0;
  height: 44px;
  border-bottom: 1px solid var(--edge-subtle);
}

.git-title {
  margin: 0;
  color: var(--content-primary);
}
</style>
