<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { parseUtcDate } from '@renderer/utils/parseDate'
import { usePolledData } from '@renderer/composables/usePolledData'
import AgentBadge from './AgentBadge.vue'
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

const levelBtnColor: Record<string, string | undefined> = {
  all:   undefined,
  info:  'info',
  warn:  'warning',
  error: 'error',
  debug: 'secondary',
}

const agentSelectItems = computed<Array<{ title: string; value: number | null }>>(() => [
  { title: t('logs.allAgents'), value: null },
  ...uniqueAgents.value.map(([id, name]) => ({ title: name, value: id })),
])

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
    <!-- Fixed header outside card -->
    <div class="al-header">
      <h2 class="text-h6 font-weight-medium al-title">{{ t('tokenStats.logsTab') }}</h2>
    </div>
    <!-- Body -->
    <div class="al-body">
    <v-card elevation="0" class="section-card">

      <!-- ── Filter bar ──────────────────────────────────────────────────── -->
      <div class="al-filter-bar">
      <div class="al-level-btns">
        <v-btn
          v-for="lvl in levels"
          :key="lvl"
          size="small"
          class="al-level-btn"
          :variant="filterLevel === lvl ? 'tonal' : 'text'"
          :color="filterLevel === lvl ? levelBtnColor[lvl] : undefined"
          @click="filterLevel = lvl"
        >{{ lvl }}</v-btn>
      </div>

      <v-select
        v-model="filterAgentId"
        :items="agentSelectItems"
        class="al-agent-select"
        density="compact"
        variant="outlined"
        :hide-details="true"
        style="max-width: 180px;"
      />

      <v-btn
        v-if="filterLevel !== 'all' || filterAgentId !== null"
        size="small"
        variant="text"
        color="primary"
        class="al-reset-btn text-caption"
        :title="t('logs.resetFilters')"
        @click="resetFilters"
      >{{ t('logs.reset') }}</v-btn>

      <div class="al-spacer" />

      <div v-if="totalPages > 1" class="al-pagination">
        <v-btn
          icon="mdi-chevron-left"
          size="x-small"
          variant="text"
          :disabled="currentPage === 1"
          :title="t('logs.prevPage')"
          @click="prevPage"
        />
        <span class="al-page-info text-caption">{{ currentPage }} / {{ totalPages }}</span>
        <v-btn
          icon="mdi-chevron-right"
          size="x-small"
          variant="text"
          :disabled="currentPage >= totalPages"
          :title="t('logs.nextPage')"
          @click="nextPage"
        />
      </div>
      <span v-else class="al-count text-caption">{{ paginatedLogs.length }} / {{ totalCount }}</span>

      <v-btn
        icon="mdi-refresh"
        variant="text"
        size="small"
        :loading="loading"
        :title="t('common.refresh')"
        @click="fetchLogs"
      />
    </div>

    <!-- ── Log list ────────────────────────────────────────────────────── -->
    <div class="al-list">

      <!-- Empty state -->
      <div v-if="paginatedLogs.length === 0 && !loading" class="al-empty">
        <v-icon class="al-empty-icon" size="24">mdi-file-document-outline</v-icon>
        <p class="al-empty-text text-body-2">{{ t('logs.noLogs') }}</p>
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
          <v-chip
            :color="levelBtnColor[log.level]"
            size="x-small"
            variant="tonal"
            class="al-level-chip"
          >{{ log.level }}</v-chip>
          <span class="al-time text-label-medium" :title="absoluteTime(log.created_at)">{{ formatTime(log.created_at) }}</span>
          <AgentBadge v-if="log.agent_name" :name="log.agent_name" />
          <span v-else class="al-agent-badge al-agent-badge--none text-label-medium">—</span>
          <span class="al-action text-body-2">{{ log.action }}</span>
          <v-icon
            v-if="log.detail || log.parsedFiles.length > 0"
            class="al-chevron"
            :class="isExpanded(log.id) ? 'al-chevron--open' : ''"
            size="12"
          >mdi-chevron-right</v-icon>
        </div>

        <!-- Expandable detail -->
        <div v-if="isExpanded(log.id)" class="al-detail">
          <p v-if="log.detail" class="al-detail-text text-body-2">{{ log.detail }}</p>
          <div v-if="log.parsedFiles.length > 0" class="al-files">
            <span
              v-for="f in log.parsedFiles"
              :key="f"
              class="al-file-badge text-label-medium"
            >{{ f.split('/').pop() }}</span>
          </div>
        </div>
      </div>

    </div>
    </v-card>
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

.al-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--edge-subtle);
}

.al-title {
  margin: 0;
  color: var(--content-primary);
}

.al-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.section-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* filter bar */
.al-filter-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--edge-default);
  background: var(--surface-base);
}
.al-level-btns { display: flex; align-items: center; gap: 4px; }
.al-spacer { flex: 1; }
.al-pagination { display: flex; align-items: center; gap: 4px; }
.al-page-info { color: var(--content-faint); }
.al-count { color: var(--content-faint); }

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
.al-empty-text {}

/* log rows */
.al-row {
  border-bottom: 1px solid rgba(var(--v-theme-surface-tertiary),0.5);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.al-row--clickable { cursor: pointer; }
.al-row--clickable:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }

.al-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  min-width: 0;
}

/* level chip (replaces custom dot+badge) */
.al-level-chip { flex-shrink: 0; }

.al-time {
  flex-shrink: 0;
  color: var(--content-subtle);
  font-family: ui-monospace, monospace;
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.al-agent-badge {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: var(--shape-xs);
  font-weight: 500;
}
.al-agent-badge--none { color: var(--content-dim); }
.al-action {
  font-weight: 500;
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
  transition: transform var(--md-duration-short3) var(--md-easing-standard);
  margin-left: auto;
}
.al-chevron--open { transform: rotate(90deg); }

.al-detail {
  padding: 0 24px 8px;
  margin-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.al-detail-text {
  color: var(--content-tertiary);
  line-height: 1.625;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  margin: 0;
}
.al-files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.al-file-badge {
  font-family: ui-monospace, monospace;
  padding: 4px 8px;
  border-radius: var(--shape-xs);
  background: var(--surface-secondary);
  color: var(--content-subtle);
  border: 1px solid rgba(var(--v-theme-surface-tertiary),0.5);
}
</style>
