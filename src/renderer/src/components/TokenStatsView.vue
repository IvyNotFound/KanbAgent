<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { usePolledData } from '@renderer/composables/usePolledData'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'

interface AgentTokenRow {
  agent_id: number
  agent_name: string | null
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  total: number
  session_count: number
}

interface SessionTokenRow {
  id: number
  agent_id: number
  agent_name: string
  started_at: string
  ended_at: string | null
  statut: string
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
  total: number
}

const { t, locale } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

const globalStats = ref({ tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0 })
const todayStats = ref({ tokens_in: 0, tokens_out: 0, total: 0 })
const hourStats = ref({ tokens_in: 0, tokens_out: 0, total: 0 })
const agentRows = ref<AgentTokenRow[]>([])
const sessionRows = ref<SessionTokenRow[]>([])

async function fetchStats(): Promise<void> {
  if (!store.dbPath) return
  try {
    const [globalRes, todayRes, hourRes, agentRes, sessionRes] = await Promise.all([
      // Global totals
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT COALESCE(SUM(tokens_in),0) as tokens_in,
                COALESCE(SUM(tokens_out),0) as tokens_out,
                COALESCE(SUM(tokens_cache_read),0) as tokens_cache_read,
                COALESCE(SUM(tokens_cache_write),0) as tokens_cache_write,
                (COALESCE(SUM(tokens_in),0) + COALESCE(SUM(tokens_out),0)) as total
         FROM sessions`,
      ) as Promise<{ tokens_in: number; tokens_out: number; tokens_cache_read: number; tokens_cache_write: number; total: number }[]>,
      // Today (last 24h)
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT COALESCE(SUM(tokens_in),0) as tokens_in,
                COALESCE(SUM(tokens_out),0) as tokens_out,
                COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)),0) as total
         FROM sessions
         WHERE started_at >= datetime('now', '-24 hours')`,
      ) as Promise<{ tokens_in: number; tokens_out: number; total: number }[]>,
      // Last hour
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT COALESCE(SUM(tokens_in),0) as tokens_in,
                COALESCE(SUM(tokens_out),0) as tokens_out,
                COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)),0) as total
         FROM sessions
         WHERE started_at >= datetime('now', '-1 hour')`,
      ) as Promise<{ tokens_in: number; tokens_out: number; total: number }[]>,
      // Per agent
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT s.agent_id,
                a.name as agent_name,
                COALESCE(SUM(s.tokens_in),0) as tokens_in,
                COALESCE(SUM(s.tokens_out),0) as tokens_out,
                COALESCE(SUM(s.tokens_cache_read),0) as tokens_cache_read,
                COALESCE(SUM(s.tokens_cache_write),0) as tokens_cache_write,
                COALESCE(SUM(COALESCE(s.tokens_in,0) + COALESCE(s.tokens_out,0)),0) as total,
                COUNT(s.id) as session_count
         FROM sessions s
         LEFT JOIN agents a ON a.id = s.agent_id
         GROUP BY s.agent_id
         ORDER BY total DESC`,
      ) as Promise<AgentTokenRow[]>,
      // Per session (latest 50)
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT s.id, s.agent_id,
                a.name as agent_name,
                s.started_at, s.ended_at, s.statut,
                COALESCE(s.tokens_in, 0) as tokens_in,
                COALESCE(s.tokens_out, 0) as tokens_out,
                COALESCE(s.tokens_cache_read, 0) as tokens_cache_read,
                COALESCE(s.tokens_cache_write, 0) as tokens_cache_write,
                (COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0)) as total
         FROM sessions s
         LEFT JOIN agents a ON a.id = s.agent_id
         WHERE (COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0)) > 0
         ORDER BY s.started_at DESC
         LIMIT 50`,
      ) as Promise<SessionTokenRow[]>,
    ])
    globalStats.value = globalRes[0] ?? { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0 }
    todayStats.value = todayRes[0] ?? { tokens_in: 0, tokens_out: 0, total: 0 }
    hourStats.value = hourRes[0] ?? { tokens_in: 0, tokens_out: 0, total: 0 }
    agentRows.value = agentRes
    sessionRows.value = sessionRes
  } catch { /* silent — usePolledData handles loading state */ }
}

// usePolledData manages polling lifecycle, loading state, and cleanup
const { loading, refresh } = usePolledData(
  fetchStats,
  () => tabsStore.activeTabId === 'logs',
  30000,
)

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString()
}

function formatDate(dateStr: string): string {
  const d = parseUtcDate(dateStr)
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Bar width for agent chart (percentage of max)
const maxAgentTotal = computed(() => Math.max(...agentRows.value.map(r => r.total), 1))

function barWidth(total: number): string {
  return Math.max((total / maxAgentTotal.value) * 100, 2) + '%'
}

</script>

<template>
  <div class="flex flex-col h-full bg-surface-primary min-h-0">

    <!-- ── Summary cards ──────────────────────────────────────────────── -->
    <div class="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 py-3 border-b border-edge-subtle bg-surface-base">

      <!-- Global -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] font-mono uppercase tracking-wider text-content-faint">{{ t('tokenStats.global') }}</span>
        <span class="text-lg font-bold text-content-primary tabular-nums">{{ formatNumber(globalStats.total) }}</span>
        <div class="flex gap-2 text-[10px] font-mono text-content-subtle">
          <span class="text-emerald-600 dark:text-emerald-400">↓ {{ formatNumber(globalStats.tokens_in) }}</span>
          <span class="text-sky-600 dark:text-sky-400">↑ {{ formatNumber(globalStats.tokens_out) }}</span>
        </div>
      </div>

      <!-- Today -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] font-mono uppercase tracking-wider text-content-faint">{{ t('tokenStats.today') }}</span>
        <span class="text-lg font-bold text-content-primary tabular-nums">{{ formatNumber(todayStats.total) }}</span>
        <div class="flex gap-2 text-[10px] font-mono text-content-subtle">
          <span class="text-emerald-600 dark:text-emerald-400">↓ {{ formatNumber(todayStats.tokens_in) }}</span>
          <span class="text-sky-600 dark:text-sky-400">↑ {{ formatNumber(todayStats.tokens_out) }}</span>
        </div>
      </div>

      <!-- Last hour -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] font-mono uppercase tracking-wider text-content-faint">{{ t('tokenStats.lastHour') }}</span>
        <span class="text-lg font-bold text-content-primary tabular-nums">{{ formatNumber(hourStats.total) }}</span>
        <div class="flex gap-2 text-[10px] font-mono text-content-subtle">
          <span class="text-emerald-600 dark:text-emerald-400">↓ {{ formatNumber(hourStats.tokens_in) }}</span>
          <span class="text-sky-600 dark:text-sky-400">↑ {{ formatNumber(hourStats.tokens_out) }}</span>
        </div>
      </div>

      <!-- Cache -->
      <div class="flex flex-col gap-1 p-3 rounded-lg bg-surface-secondary border border-edge-default">
        <span class="text-[10px] font-mono uppercase tracking-wider text-content-faint">{{ t('tokenStats.cache') }}</span>
        <span class="text-lg font-bold text-content-primary tabular-nums">{{ formatNumber(globalStats.tokens_cache_read + globalStats.tokens_cache_write) }}</span>
        <div class="flex gap-2 text-[10px] font-mono text-content-subtle">
          <span class="text-amber-600 dark:text-amber-400">R {{ formatNumber(globalStats.tokens_cache_read) }}</span>
          <span class="text-violet-600 dark:text-violet-400">W {{ formatNumber(globalStats.tokens_cache_write) }}</span>
        </div>
      </div>
    </div>

    <!-- ── Content (scrollable) ───────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-4">

      <!-- Per-agent table with bars -->
      <section>
        <h3 class="text-[11px] font-mono uppercase tracking-wider text-content-faint mb-2">{{ t('tokenStats.perAgent') }}</h3>

        <div v-if="agentRows.length === 0" class="text-sm text-content-faint py-4 text-center">
          {{ t('tokenStats.noData') }}
        </div>

        <div v-else class="space-y-1.5">
          <div
            v-for="row in agentRows"
            :key="row.agent_id"
            class="flex items-center gap-3 group"
          >
            <!-- Agent name -->
            <span
              v-if="row.agent_name"
              class="shrink-0 w-32 text-[11px] font-mono px-1.5 py-0.5 rounded font-medium truncate text-right"
              :style="{
                color: agentFg(row.agent_name),
                backgroundColor: agentBg(row.agent_name),
                boxShadow: `0 0 0 1px ${agentBorder(row.agent_name)}`
              }"
              :title="row.agent_name"
            >{{ row.agent_name }}</span>
            <span v-else class="shrink-0 w-32 text-[11px] font-mono text-content-dim text-right">—</span>

            <!-- Bar -->
            <div class="flex-1 h-5 bg-surface-secondary rounded overflow-hidden relative">
              <div
                class="h-full rounded bg-gradient-to-r from-emerald-600/60 to-sky-600/60 transition-all duration-300"
                :style="{ width: barWidth(row.total) }"
              />
              <span class="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-content-secondary">
                {{ formatNumber(row.total) }}
              </span>
            </div>

            <!-- Details on hover -->
            <div class="shrink-0 flex gap-2 text-[10px] font-mono text-content-subtle w-40 justify-end">
              <span class="text-emerald-600 dark:text-emerald-400">↓{{ formatNumber(row.tokens_in) }}</span>
              <span class="text-sky-600 dark:text-sky-400">↑{{ formatNumber(row.tokens_out) }}</span>
              <span class="text-content-faint">{{ row.session_count }}s</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Per-session table -->
      <section>
        <h3 class="text-[11px] font-mono uppercase tracking-wider text-content-faint mb-2">{{ t('tokenStats.perSession') }}</h3>

        <div v-if="sessionRows.length === 0" class="text-sm text-content-faint py-4 text-center">
          {{ t('tokenStats.noData') }}
        </div>

        <table v-else class="w-full text-[11px] font-mono">
          <thead>
            <tr class="text-content-faint text-left border-b border-edge-subtle">
              <th class="py-1.5 px-2 font-medium">ID</th>
              <th class="py-1.5 px-2 font-medium">{{ t('tokenStats.agent') }}</th>
              <th class="py-1.5 px-2 font-medium">{{ t('tokenStats.date') }}</th>
              <th class="py-1.5 px-2 font-medium text-right text-emerald-600 dark:text-emerald-400">↓ In</th>
              <th class="py-1.5 px-2 font-medium text-right text-sky-600 dark:text-sky-400">↑ Out</th>
              <th class="py-1.5 px-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in sessionRows"
              :key="s.id"
              class="border-b border-edge-subtle/40 hover:bg-surface-secondary/40 transition-colors"
            >
              <td class="py-1.5 px-2 text-content-faint">#{{ s.id }}</td>
              <td class="py-1.5 px-2">
                <span
                  v-if="s.agent_name"
                  class="px-1.5 py-0.5 rounded font-medium"
                  :style="{
                    color: agentFg(s.agent_name),
                    backgroundColor: agentBg(s.agent_name),
                    boxShadow: `0 0 0 1px ${agentBorder(s.agent_name)}`
                  }"
                >{{ s.agent_name }}</span>
                <span v-else class="text-content-dim">—</span>
              </td>
              <td class="py-1.5 px-2 text-content-subtle">{{ formatDate(s.started_at) }}</td>
              <td class="py-1.5 px-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{{ formatNumber(s.tokens_in) }}</td>
              <td class="py-1.5 px-2 text-right text-sky-600 dark:text-sky-400 tabular-nums">{{ formatNumber(s.tokens_out) }}</td>
              <td class="py-1.5 px-2 text-right text-content-secondary font-semibold tabular-nums">{{ formatNumber(s.total) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Refresh button -->
    <div class="shrink-0 flex items-center justify-end px-4 py-2 border-t border-edge-subtle bg-surface-base">
      <button
        class="w-6 h-6 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
        :class="{ 'animate-spin': loading }"
        :title="t('logs.refresh')"
        @click="refresh"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
      </button>
    </div>
  </div>
</template>
