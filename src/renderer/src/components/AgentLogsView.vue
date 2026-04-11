<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { usePolledData } from '@renderer/composables/usePolledData'
import AgentLogRow from './AgentLogRow.vue'
import type { AgentLog } from '@renderer/types'

const props = defineProps<{
  initialAgentId?: number | null
}>()

const { t } = useI18n()
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

const { loading } = usePolledData(
  fetchLogs,
  () => tabsStore.activeTabId === 'dashboard',
  30000,
)

// ── Filters ────────────────────────────────────────────────────────────────
const levels = ['all', 'info', 'warn', 'error', 'debug'] as const

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
        <!-- Filter bar -->
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
            >
              {{ lvl }}
            </v-btn>
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
          >
            {{ t('logs.reset') }}
          </v-btn>

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

        <!-- Log list -->
        <div class="al-list">
          <!-- Empty state -->
          <div v-if="paginatedLogs.length === 0 && !loading" class="al-empty">
            <v-icon class="al-empty-icon" size="24">mdi-file-document-outline</v-icon>
            <p class="al-empty-text text-body-2">{{ t('logs.noLogs') }}</p>
          </div>

          <!-- Log rows -->
          <AgentLogRow
            v-for="log in enrichedLogs"
            :key="log.id"
            :log="log"
            :expanded="isExpanded(log.id)"
            :level-btn-color="levelBtnColor"
            @toggle="toggleExpand"
          />
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
</style>
