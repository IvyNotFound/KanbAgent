<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { parseUtcDate } from '@renderer/utils/parseDate'
import { usePolledData } from '@renderer/composables/usePolledData'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import type { AgentLog } from '@renderer/types'

const props = defineProps<{
  initialAgentId?: number | null
}>()

const { t, locale } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

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
      conditions.push('l.level = ?')
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
                l.level, l.action, l.detail, l.files, l.created_at
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

function resetFilters(): void {
  filterLevel.value = 'all'
  filterAgentId.value = null
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
    parsedFiles: parseFichiers(log.files),
  }))
)

watch(() => props.initialAgentId, (v) => {
  if (v != null) filterAgentId.value = v
})

</script>

<template>
  <div class="flex flex-col h-full bg-surface-base min-h-0">

    <!-- ── Titre ──────────────────────────────────────────────────────────── -->
    <div class="shrink-0 flex items-center px-6 py-3 border-b border-edge-default">
      <h2 class="text-xl font-semibold text-content-primary">{{ t('tokenStats.logsTab') }}</h2>
    </div>

    <!-- ── Barre de filtres ──────────────────────────────────────────────── -->
    <div class="shrink-0 flex items-center gap-2 px-6 py-2.5 border-b border-edge-default bg-surface-base">

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

      <!-- Reset filters -->
      <button
        v-if="filterLevel !== 'all' || filterAgentId !== null"
        class="px-2 py-0.5 rounded text-xs font-mono text-content-subtle bg-transparent ring-1 ring-edge-default hover:text-content-secondary hover:ring-violet-500 transition-all"
        :title="t('logs.resetFilters')"
        @click="resetFilters"
      >{{ t('logs.reset') }}</button>

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
          'group border-b border-edge-default/50 transition-colors',
          log.detail || log.parsedFiles.length > 0 ? 'cursor-pointer hover:bg-surface-secondary/40' : ''
        ]"
        @click="(log.detail || log.parsedFiles.length > 0) && toggleExpand(log.id)"
      >
        <!-- Ligne principale -->
        <div class="flex items-center gap-3 px-6 py-2.5 min-w-0">

          <!-- Dot niveau -->
          <span
            :class="['shrink-0 w-2 h-2 rounded-full', levelCfg(log.level).dot]"
          />

          <!-- Badge niveau -->
          <span
            :class="[
              'shrink-0 text-xs font-mono font-semibold px-1.5 py-0.5 rounded',
              levelCfg(log.level).text,
              levelCfg(log.level).bg
            ]"
          >{{ levelCfg(log.level).label }}</span>

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
          class="px-6 pb-2.5 pt-0 ml-[18px] flex flex-col gap-1.5"
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

  </div>
</template>
