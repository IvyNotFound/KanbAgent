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
// Using scoped CSS class names instead of Tailwind utilities
const levelConfig: Record<string, { label: string; cls: string }> = {
  info:  { label: 'info',  cls: 'al-level--info'  },
  warn:  { label: 'warn',  cls: 'al-level--warn'  },
  error: { label: 'error', cls: 'al-level--error' },
  debug: { label: 'debug', cls: 'al-level--debug' },
}

function levelCfg(niveau: string) {
  return levelConfig[niveau] ?? levelConfig.info
}

const filterLevelConfig: Record<string, string> = {
  all:   'al-filter--all',
  info:  'al-filter--info',
  warn:  'al-filter--warn',
  error: 'al-filter--error',
  debug: 'al-filter--debug',
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
  <div class="al-view">

    <!-- ── Title ──────────────────────────────────────────────────────────── -->
    <div class="al-title-bar">
      <h2 class="al-title">{{ t('tokenStats.logsTab') }}</h2>
    </div>

    <!-- ── Filter bar ──────────────────────────────────────────────────── -->
    <div class="al-filter-bar">
      <div class="al-level-btns">
        <button
          v-for="lvl in levels"
          :key="lvl"
          class="al-level-btn"
          :class="filterLevel === lvl ? filterLevelConfig[lvl] : 'al-level-btn--inactive'"
          @click="filterLevel = lvl"
        >{{ lvl }}</button>
      </div>

      <div class="al-sep" />

      <select v-model.number="filterAgentId" class="al-agent-select">
        <option :value="null">{{ t('logs.allAgents') }}</option>
        <option v-for="[id, name] in uniqueAgents" :key="id" :value="id">{{ name }}</option>
      </select>

      <button
        v-if="filterLevel !== 'all' || filterAgentId !== null"
        class="al-reset-btn"
        :title="t('logs.resetFilters')"
        @click="resetFilters"
      >{{ t('logs.reset') }}</button>

      <div class="al-spacer" />

      <div v-if="totalPages > 1" class="al-pagination">
        <button class="al-page-btn" :disabled="currentPage === 1" :title="t('logs.prevPage')" @click="prevPage">
          <v-icon size="12">mdi-chevron-left</v-icon>
        </button>
        <span class="al-page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button class="al-page-btn" :disabled="currentPage >= totalPages" :title="t('logs.nextPage')" @click="nextPage">
          <v-icon size="12">mdi-chevron-right</v-icon>
        </button>
      </div>
      <span v-else class="al-count">{{ paginatedLogs.length }} / {{ totalCount }}</span>

      <button
        class="al-refresh-btn"
        :class="{ 'al-refresh-btn--spinning': loading }"
        :title="t('logs.refresh')"
        @click="fetchLogs"
      >
        <v-icon size="14">mdi-refresh</v-icon>
      </button>
    </div>

    <!-- ── Log list ────────────────────────────────────────────────────── -->
    <div class="al-list">

      <!-- Empty state -->
      <div v-if="paginatedLogs.length === 0 && !loading" class="al-empty">
        <v-icon class="al-empty-icon" size="24">mdi-file-document-outline</v-icon>
        <p class="al-empty-text">{{ t('logs.noLogs') }}</p>
      </div>

      <!-- Log rows -->
      <div
        v-for="log in enrichedLogs"
        :key="log.id"
        class="al-row"
        :class="log.detail || log.parsedFiles.length > 0 ? 'al-row--clickable' : ''"
        @click="(log.detail || log.parsedFiles.length > 0) && toggleExpand(log.id)"
      >
        <!-- Main line -->
        <div class="al-row-main">
          <span class="al-dot" :class="levelCfg(log.level).cls" />
          <span class="al-badge" :class="levelCfg(log.level).cls">{{ levelCfg(log.level).label }}</span>
          <span class="al-time" :title="absoluteTime(log.created_at)">{{ formatTime(log.created_at) }}</span>
          <span
            v-if="log.agent_name"
            class="al-agent-badge"
            :style="{
              color: agentFg(log.agent_name),
              backgroundColor: agentBg(log.agent_name),
              boxShadow: `0 0 0 1px ${agentBorder(log.agent_name)}`
            }"
          >{{ log.agent_name }}</span>
          <span v-else class="al-agent-badge al-agent-badge--none">—</span>
          <span class="al-action">{{ log.action }}</span>
          <v-icon
            v-if="log.detail || log.parsedFiles.length > 0"
            class="al-chevron"
            :class="isExpanded(log.id) ? 'al-chevron--open' : ''"
            size="12"
          >mdi-chevron-right</v-icon>
        </div>

        <!-- Expandable detail -->
        <div v-if="isExpanded(log.id)" class="al-detail">
          <p v-if="log.detail" class="al-detail-text">{{ log.detail }}</p>
          <div v-if="log.parsedFiles.length > 0" class="al-files">
            <span
              v-for="f in log.parsedFiles"
              :key="f"
              class="al-file-badge"
            >{{ f.split('/').pop() }}</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.al-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-base);
  min-height: 0;
}
.al-title-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 12px 24px;
  border-bottom: 1px solid var(--edge-default);
}
.al-title { font-size: 20px; font-weight: 600; color: var(--content-primary); margin: 0; }

/* filter bar */
.al-filter-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--edge-default);
  background: var(--surface-base);
}
.al-level-btns { display: flex; align-items: center; gap: 4px; }
.al-level-btn {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  font-weight: 500;
  box-shadow: 0 0 0 1px transparent;
  transition: all 0.15s;
  border: none;
  cursor: pointer;
}
.al-level-btn--inactive {
  color: var(--content-subtle);
  background: transparent;
  box-shadow: none;
}
.al-level-btn--inactive:hover {
  color: var(--content-tertiary);
  box-shadow: 0 0 0 1px var(--edge-default);
}
/* active filter states */
.al-filter--all   { color: var(--content-tertiary); background: var(--surface-secondary); box-shadow: 0 0 0 1px var(--edge-default); }
.al-filter--info  { color: #38bdf8; background: rgba(12,74,110,0.6);  box-shadow: 0 0 0 1px #0c4a6e; }
.al-filter--warn  { color: #fbbf24; background: rgba(78,52,6,0.6);    box-shadow: 0 0 0 1px #78350f; }
.al-filter--error { color: #f87171; background: rgba(69,10,10,0.6);   box-shadow: 0 0 0 1px #7f1d1d; }
.al-filter--debug { color: #c4b5fd; background: rgba(46,16,101,0.6);  box-shadow: 0 0 0 1px #4c1d95; }

.al-sep { width: 1px; height: 16px; background: var(--surface-secondary); margin: 0 4px; }
.al-agent-select {
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--content-tertiary);
  outline: none;
  cursor: pointer;
}
.al-reset-btn {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--content-subtle);
  background: transparent;
  box-shadow: 0 0 0 1px var(--edge-default);
  border: none;
  cursor: pointer;
  transition: color 0.15s, box-shadow 0.15s;
}
.al-reset-btn:hover { color: var(--content-secondary); box-shadow: 0 0 0 1px #6d28d9; }
.al-spacer { flex: 1; }
.al-pagination { display: flex; align-items: center; gap: 8px; }
.al-page-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.al-page-btn:hover:not(:disabled) { color: var(--content-secondary); background: var(--surface-secondary); }
.al-page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.al-page-info { font-size: 11px; color: var(--content-faint); font-family: ui-monospace, monospace; }
.al-count { font-size: 11px; color: var(--content-faint); font-family: ui-monospace, monospace; }
.al-refresh-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.al-refresh-btn:hover { color: var(--content-secondary); background: var(--surface-secondary); }
.al-refresh-btn--spinning { animation: alSpin 1s linear infinite; }
@keyframes alSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* log list */
.al-list { flex: 1; overflow-y: auto; min-height: 0; contain: strict; }
.al-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
}
.al-empty-icon { width: 32px; height: 32px; color: var(--content-dim); }
.al-empty-text { font-size: 14px; color: var(--content-faint); }

/* log rows */
.al-row {
  border-bottom: 1px solid rgba(63,63,70,0.5);
  transition: background 0.15s;
}
.al-row--clickable { cursor: pointer; }
.al-row--clickable:hover { background: rgba(39,39,42,0.4); }

.al-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  min-width: 0;
}

/* level badge + dot using combined class */
.al-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.al-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}
/* dot colors */
.al-level--info.al-dot  { background: #38bdf8; }
.al-level--warn.al-dot  { background: #fbbf24; }
.al-level--error.al-dot { background: #f87171; }
.al-level--debug.al-dot { background: #c4b5fd; }
/* badge colors */
.al-level--info.al-badge  { color: #38bdf8; background: rgba(12,74,110,0.6); }
.al-level--warn.al-badge  { color: #fbbf24; background: rgba(78,52,6,0.6); }
.al-level--error.al-badge { color: #f87171; background: rgba(69,10,10,0.6); }
.al-level--debug.al-badge { color: #c4b5fd; background: rgba(46,16,101,0.6); }

.al-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--content-subtle);
  font-family: ui-monospace, monospace;
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.al-agent-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}
.al-agent-badge--none { color: var(--content-dim); }
.al-action {
  font-size: 14px;
  font-weight: 600;
  color: var(--content-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.al-chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--content-faint);
  transition: transform 0.15s;
  margin-left: auto;
}
.al-chevron--open { transform: rotate(90deg); }

.al-detail {
  padding: 0 24px 10px;
  margin-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.al-detail-text {
  font-size: 14px;
  color: var(--content-tertiary);
  line-height: 1.625;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  margin: 0;
}
.al-files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.al-file-badge {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-secondary);
  color: var(--content-subtle);
  border: 1px solid rgba(63,63,70,0.5);
}
</style>
