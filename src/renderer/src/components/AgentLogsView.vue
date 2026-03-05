<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { parseUtcDate } from '@renderer/utils/parseDate'
import { usePolledData } from '@renderer/composables/usePolledData'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import type { AgentLog } from '@renderer/types'
import TokenStatsView from './TokenStatsView.vue'
import ActivityHeatmap from './ActivityHeatmap.vue'
import GitCommitList from './GitCommitList.vue'
import ToolStatsPanel from './ToolStatsPanel.vue'
import AgentQualityPanel from './AgentQualityPanel.vue'

type SubTab = 'logs' | 'tokenStats' | 'heatmap' | 'git' | 'tools' | 'quality'

const props = defineProps<{
  initialAgentId?: number | null
}>()

const { t, locale } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

// ── Sub-tab navigation ──────────────────────────────────────────────────
const activeSubTab = ref<SubTab>('logs')

// ── State ──────────────────────────────────────────────────────────────────
const logs = ref<AgentLog[]>([])
const filterLevel = ref<string>('all')
const filterAgentId = ref<number | null>(props.initialAgentId ?? null)
const expandedIds = ref<Record<number, boolean>>({})

// Pagination
const currentPage = ref(1)
const pageSize = ref(50)
const totalCount = ref(0)

const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value))
const paginatedLogs = computed(() => logs.value)

// Reset page when filters change
watch([filterLevel, filterAgentId], () => {
  currentPage.value = 1
  fetchLogs()
})

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
    fetchLogs()
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--
    fetchLogs()
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────────
async function fetchLogs(): Promise<void> {
  if (!store.dbPath) return
  try {
    // Build WHERE clause based on filters
    const conditions: string[] = []
    const params: unknown[] = []
    if (filterLevel.value !== 'all') {
      conditions.push('l.niveau = ?')
      params.push(filterLevel.value)
    }
    if (filterAgentId.value !== null) {
      conditions.push('l.agent_id = ?')
      params.push(filterAgentId.value)
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Fetch count + paginated logs in parallel
    const offset = (currentPage.value - 1) * pageSize.value
    const [countResult, result] = await Promise.all([
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT COUNT(*) as total FROM agent_logs l ${whereClause}`,
        params,
      ) as Promise<{ total: number }[]>,
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT l.id, l.session_id, l.agent_id, a.name as agent_name, a.type as agent_type,
                l.niveau, l.action, l.detail, l.fichiers, l.created_at
         FROM agent_logs l
         LEFT JOIN agents a ON a.id = l.agent_id
         ${whereClause}
         ORDER BY l.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize.value, offset],
      ),
    ])
    totalCount.value = countResult[0]?.total ?? 0
    if (!Array.isArray(result)) {
      console.warn('[AgentLogsView] Unexpected query result:', result)
      logs.value = []
      return
    }
    logs.value = result as AgentLog[]
  } catch { /* silent — usePolledData handles loading state */ }
}

// usePolledData manages polling lifecycle, loading state, and cleanup
const { loading } = usePolledData(
  fetchLogs,
  () => tabsStore.activeTabId === 'dashboard',
  30000,
)

// ── Filters ────────────────────────────────────────────────────────────────
const levels = ['all', 'info', 'warn', 'error', 'debug'] as const

// Use store.agents instead of iterating logs (avoids recompute on every poll)
const uniqueAgents = computed(() =>
  store.agents
    .filter(a => a.type !== 'setup')
    .map(a => [a.id, a.name] as [number, string])
    .sort((a, b) => a[1].localeCompare(b[1]))
)

// ── Timestamps ────────────────────────────────────────────────────────────
function formatTime(dateStr: string): string {
  const d = parseUtcDate(dateStr)
  const now = new Date()
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })
}

function absoluteTime(dateStr: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(dateStr).toLocaleString(dateLocale, {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

// ── Level styling ─────────────────────────────────────────────────────────
const levelConfig: Record<string, { label: string; text: string; bg: string; dot: string }> = {
  info:  { label: 'info',  text: 'text-sky-700 dark:text-sky-400',       bg: 'bg-sky-100 dark:bg-sky-950/60',       dot: 'bg-sky-500 dark:bg-sky-400' },
  warn:  { label: 'warn',  text: 'text-amber-700 dark:text-amber-400',   bg: 'bg-amber-100 dark:bg-amber-950/60',   dot: 'bg-amber-500 dark:bg-amber-400' },
  error: { label: 'error', text: 'text-red-700 dark:text-red-400',       bg: 'bg-red-100 dark:bg-red-950/60',       dot: 'bg-red-500 dark:bg-red-400' },
  debug: { label: 'debug', text: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-950/60', dot: 'bg-violet-500 dark:bg-violet-400' },
}

function levelCfg(niveau: string) {
  return levelConfig[niveau] ?? levelConfig.info
}

const filterLevelConfig: Record<string, string> = {
  all:   'text-content-tertiary bg-surface-secondary ring-edge-default',
  info:  'text-sky-700 dark:text-sky-400 bg-sky-100 dark:bg-sky-950/60 ring-sky-300 dark:ring-sky-800',
  warn:  'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 ring-amber-300 dark:ring-amber-800',
  error: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/60 ring-red-300 dark:ring-red-800',
  debug: 'text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-950/60 ring-violet-300 dark:ring-violet-800',
}

// ── Detail toggle ─────────────────────────────────────────────────────────
function toggleExpand(id: number): void {
  if (expandedIds.value[id]) {
    delete expandedIds.value[id]
  } else {
    expandedIds.value[id] = true
  }
}

function isExpanded(id: number): boolean {
  return !!expandedIds.value[id]
}

function parseFichiers(fichiers: string | null): string[] {
  if (!fichiers) return []
  try { return JSON.parse(fichiers) } catch { return [] }
}

// Pre-parse fichiers once per render cycle instead of 2-5x per row in template
type EnrichedLog = AgentLog & { parsedFiles: string[] }
const enrichedLogs = computed<EnrichedLog[]>(() =>
  paginatedLogs.value.map(log => ({
    ...log,
    parsedFiles: parseFichiers(log.fichiers),
  }))
)

watch(() => props.initialAgentId, (v) => {
  if (v != null) filterAgentId.value = v
})

// ── Git commits (T761) ────────────────────────────────────────────────────
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

watch(activeSubTab, (tab) => {
  if (tab === 'git' && gitCommits.value.length === 0) fetchGitCommits()
})
</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary min-h-0">

    <!-- ── Sub-tab pills ─────────────────────────────────────────────────── -->
    <div class="shrink-0 flex items-center gap-1 px-4 pt-2.5 pb-0 bg-surface-base">
      <button
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-mono font-medium transition-colors border border-b-0',
          activeSubTab === 'logs'
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = 'logs'"
      >{{ t('tokenStats.logsTab') }}</button>
      <button
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-mono font-medium transition-colors border border-b-0',
          activeSubTab === 'tokenStats'
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = 'tokenStats'"
      >{{ t('tokenStats.title') }}</button>
      <button
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-mono font-medium transition-colors border border-b-0',
          activeSubTab === 'heatmap'
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = 'heatmap'"
      >Heatmap</button>
      <button
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-mono font-medium transition-colors border border-b-0',
          activeSubTab === 'git'
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = 'git'"
      >Git</button>
      <button
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-mono font-medium transition-colors border border-b-0',
          activeSubTab === 'tools'
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = 'tools'"
      >{{ t('toolStats.title') }}</button>
      <button
        :class="[
          'px-3 py-1 rounded-t text-[11px] font-mono font-medium transition-colors border border-b-0',
          activeSubTab === 'quality'
            ? 'text-content-secondary bg-surface-primary border-edge-subtle'
            : 'text-content-faint bg-transparent border-transparent hover:text-content-tertiary hover:bg-surface-secondary/40'
        ]"
        @click="activeSubTab = 'quality'"
      >Qualité</button>
    </div>

    <!-- ── Tool Stats sub-tab ────────────────────────────────────────────── -->
    <ToolStatsPanel v-if="activeSubTab === 'tools'" class="flex-1 min-h-0" />

    <!-- ── Quality sub-tab ───────────────────────────────────────────────── -->
    <AgentQualityPanel v-if="activeSubTab === 'quality'" class="flex-1 min-h-0" />

    <!-- ── Token Stats sub-tab ───────────────────────────────────────────── -->
    <!-- v-show instead of v-if: keeps component mounted, avoids 5 IPC calls on every sub-tab switch -->
    <TokenStatsView v-show="activeSubTab === 'tokenStats'" />

    <!-- ── Heatmap sub-tab ───────────────────────────────────────────────── -->
    <ActivityHeatmap
      v-if="activeSubTab === 'heatmap' && store.dbPath"
      :db-path="store.dbPath"
      class="flex-1"
    />

    <!-- ── Git sub-tab ───────────────────────────────────────────────────── -->
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

    <!-- ── Logs sub-tab ──────────────────────────────────────────────────── -->
    <template v-if="activeSubTab !== 'tokenStats' && activeSubTab !== 'heatmap' && activeSubTab !== 'git' && activeSubTab !== 'tools' && activeSubTab !== 'quality'">

    <!-- ── Barre de filtres ──────────────────────────────────────────────── -->
    <div class="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge-subtle bg-surface-base">

      <!-- Filtres niveau -->
      <div class="flex items-center gap-1">
        <button
          v-for="lvl in levels"
          :key="lvl"
          :class="[
            'px-2 py-0.5 rounded text-xs font-mono font-medium ring-1 transition-all',
            filterLevel === lvl
              ? filterLevelConfig[lvl]
              : 'text-content-subtle bg-transparent ring-transparent hover:text-content-tertiary hover:ring-edge-default'
          ]"
          @click="filterLevel = lvl"
        >{{ lvl }}</button>
      </div>

      <!-- Séparateur -->
      <div class="w-px h-4 bg-surface-secondary mx-1" />

      <!-- Filtre agent -->
      <select
        v-model.number="filterAgentId"
        class="bg-surface-secondary border border-edge-default rounded px-2 py-0.5 text-xs font-mono text-content-tertiary outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
      >
        <option :value="null">{{ t('logs.allAgents') }}</option>
        <option
          v-for="[id, name] in uniqueAgents"
          :key="id"
          :value="id"
        >{{ name }}</option>
      </select>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Pagination controls -->
      <div v-if="totalPages > 1" class="flex items-center gap-2">
        <button
          class="w-6 h-6 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          :disabled="currentPage === 1"
          :title="t('logs.prevPage')"
          @click="prevPage"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
            <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
        </button>
        <span class="text-[11px] text-content-faint font-mono">
          {{ currentPage }} / {{ totalPages }}
        </span>
        <button
          class="w-6 h-6 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          :disabled="currentPage >= totalPages"
          :title="t('logs.nextPage')"
          @click="nextPage"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
            <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </button>
      </div>

      <!-- Compteur + refresh -->
      <span v-else class="text-[11px] text-content-faint font-mono">
        {{ paginatedLogs.length }} / {{ totalCount }}
      </span>
      <button
        class="w-6 h-6 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
        :class="{ 'animate-spin': loading }"
        :title="t('logs.refresh')"
        @click="fetchLogs"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
      </button>
    </div>

    <!-- ── Liste logs ────────────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto min-h-0" style="contain: strict;">

      <!-- Empty state -->
      <div
        v-if="paginatedLogs.length === 0 && !loading"
        class="flex flex-col items-center justify-center h-full gap-2"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-8 h-8 text-content-dim">
          <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
          <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
        </svg>
        <p class="text-sm text-content-faint">{{ t('logs.noLogs') }}</p>
      </div>

      <!-- Log rows -->
      <div
        v-for="log in enrichedLogs"
        :key="log.id"
        :class="[
          'group border-b border-edge-subtle/60 transition-colors',
          log.detail || log.parsedFiles.length > 0 ? 'cursor-pointer hover:bg-surface-secondary/40' : ''
        ]"
        @click="(log.detail || log.parsedFiles.length > 0) && toggleExpand(log.id)"
      >
        <!-- Ligne principale -->
        <div class="flex items-center gap-3 px-4 py-2.5 min-w-0">

          <!-- Dot niveau -->
          <span
            :class="['shrink-0 w-2 h-2 rounded-full', levelCfg(log.niveau).dot]"
          />

          <!-- Badge niveau -->
          <span
            :class="[
              'shrink-0 text-xs font-mono font-semibold px-1.5 py-0.5 rounded',
              levelCfg(log.niveau).text,
              levelCfg(log.niveau).bg
            ]"
          >{{ levelCfg(log.niveau).label }}</span>

          <!-- Timestamp -->
          <span
            class="shrink-0 text-xs text-content-subtle font-mono w-14 text-right tabular-nums"
            :title="absoluteTime(log.created_at)"
          >{{ formatTime(log.created_at) }}</span>

          <!-- Agent badge -->
          <span
            v-if="log.agent_name"
            class="shrink-0 text-xs font-mono px-1.5 py-0.5 rounded font-medium"
            :style="{
              color: agentFg(log.agent_name),
              backgroundColor: agentBg(log.agent_name),
              boxShadow: `0 0 0 1px ${agentBorder(log.agent_name)}`
            }"
          >{{ log.agent_name }}</span>
          <span v-else class="shrink-0 text-xs font-mono text-content-dim px-1.5 py-0.5">—</span>

          <!-- Action -->
          <span class="text-sm font-semibold text-content-secondary truncate min-w-0">{{ log.action }}</span>

          <!-- Chevron si détail existe -->
          <svg
            v-if="log.detail || log.parsedFiles.length > 0"
            :class="[
              'shrink-0 w-3 h-3 text-content-faint transition-transform ml-auto',
              isExpanded(log.id) ? 'rotate-90' : ''
            ]"
            viewBox="0 0 16 16" fill="currentColor"
          >
            <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </div>

        <!-- Détail pliable -->
        <div
          v-if="isExpanded(log.id)"
          class="px-4 pb-2.5 pt-0 ml-[18px] flex flex-col gap-1.5"
        >
          <!-- Texte detail -->
          <p
            v-if="log.detail"
            class="text-sm text-content-tertiary leading-relaxed whitespace-pre-wrap break-words"
          >{{ log.detail }}</p>

          <!-- Fichiers -->
          <div v-if="log.parsedFiles.length > 0" class="flex flex-wrap gap-1 mt-0.5">
            <span
              v-for="f in log.parsedFiles"
              :key="f"
              class="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-secondary text-content-subtle border border-edge-default/50"
            >{{ f.split('/').pop() }}</span>
          </div>
        </div>
      </div>
    </div>

    </template><!-- end logs sub-tab -->
  </div>
</template>
