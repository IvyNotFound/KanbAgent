<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import type { AgentLog } from '@renderer/types'

const props = defineProps<{
  initialAgentId?: number | null
}>()

const store = useTasksStore()

// ── State ──────────────────────────────────────────────────────────────────
const logs = ref<AgentLog[]>([])
const loading = ref(false)
const filterLevel = ref<string>('all')
const filterAgentId = ref<number | null>(props.initialAgentId ?? null)
const expandedIds = ref<Set<number>>(new Set())
let pollTimer: ReturnType<typeof setInterval> | null = null

// ── Fetch ──────────────────────────────────────────────────────────────────
async function fetchLogs(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  try {
    const rows = await window.electronAPI.queryDb(
      store.dbPath,
      `SELECT l.id, l.session_id, l.agent_id, a.name as agent_name, a.type as agent_type,
              l.niveau, l.action, l.detail, l.fichiers, l.created_at
       FROM agent_logs l
       LEFT JOIN agents a ON a.id = l.agent_id
       ORDER BY l.created_at DESC
       LIMIT 500`,
    ) as AgentLog[]
    logs.value = rows
  } finally {
    loading.value = false
  }
}

// ── Filters ────────────────────────────────────────────────────────────────
const levels = ['all', 'info', 'warn', 'error', 'debug'] as const

const filteredLogs = computed(() => {
  return logs.value.filter(log => {
    if (filterLevel.value !== 'all' && log.niveau !== filterLevel.value) return false
    if (filterAgentId.value !== null && log.agent_id !== filterAgentId.value) return false
    return true
  })
})

const uniqueAgents = computed(() => {
  const map = new Map<number, string>()
  for (const log of logs.value) {
    if (log.agent_id && log.agent_name && !map.has(log.agent_id)) {
      map.set(log.agent_id, log.agent_name)
    }
  }
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
})

// ── Timestamps ────────────────────────────────────────────────────────────
function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function absoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

// ── Level styling ─────────────────────────────────────────────────────────
const levelConfig: Record<string, { label: string; text: string; bg: string; dot: string }> = {
  info:  { label: 'info',  text: 'text-sky-400',     bg: 'bg-sky-950/60',    dot: 'bg-sky-400' },
  warn:  { label: 'warn',  text: 'text-amber-400',   bg: 'bg-amber-950/60',  dot: 'bg-amber-400' },
  error: { label: 'error', text: 'text-red-400',     bg: 'bg-red-950/60',    dot: 'bg-red-400' },
  debug: { label: 'debug', text: 'text-violet-400',  bg: 'bg-violet-950/60', dot: 'bg-violet-400' },
}

function levelCfg(niveau: string) {
  return levelConfig[niveau] ?? levelConfig.info
}

const filterLevelConfig: Record<string, string> = {
  all:   'text-zinc-300 bg-zinc-800 ring-zinc-700',
  info:  'text-sky-400 bg-sky-950/60 ring-sky-800',
  warn:  'text-amber-400 bg-amber-950/60 ring-amber-800',
  error: 'text-red-400 bg-red-950/60 ring-red-800',
  debug: 'text-violet-400 bg-violet-950/60 ring-violet-800',
}

// ── Detail toggle ─────────────────────────────────────────────────────────
function toggleExpand(id: number): void {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.add(id)
  }
}

function isExpanded(id: number): boolean {
  return expandedIds.value.has(id)
}

function parseFichiers(fichiers: string | null): string[] {
  if (!fichiers) return []
  try { return JSON.parse(fichiers) } catch { return [] }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(async () => {
  await fetchLogs()
  pollTimer = setInterval(fetchLogs, 4000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

watch(() => props.initialAgentId, (v) => {
  if (v != null) filterAgentId.value = v
})
</script>

<template>
  <div class="flex flex-col h-full bg-zinc-900 min-h-0">

    <!-- ── Barre de filtres ──────────────────────────────────────────────── -->
    <div class="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-950">

      <!-- Filtres niveau -->
      <div class="flex items-center gap-1">
        <button
          v-for="lvl in levels"
          :key="lvl"
          :class="[
            'px-2 py-0.5 rounded text-[11px] font-mono font-medium ring-1 transition-all',
            filterLevel === lvl
              ? filterLevelConfig[lvl]
              : 'text-zinc-500 bg-transparent ring-transparent hover:text-zinc-300 hover:ring-zinc-700'
          ]"
          @click="filterLevel = lvl"
        >{{ lvl }}</button>
      </div>

      <!-- Séparateur -->
      <div class="w-px h-4 bg-zinc-800 mx-1" />

      <!-- Filtre agent -->
      <select
        v-model.number="filterAgentId"
        class="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] font-mono text-zinc-300 outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
      >
        <option :value="null">Tous les agents</option>
        <option
          v-for="[id, name] in uniqueAgents"
          :key="id"
          :value="id"
        >{{ name }}</option>
      </select>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Compteur + refresh -->
      <span class="text-[11px] text-zinc-600 font-mono">
        {{ filteredLogs.length }} / {{ logs.length }}
      </span>
      <button
        class="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        :class="{ 'animate-spin': loading }"
        title="Actualiser"
        @click="fetchLogs"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
      </button>
    </div>

    <!-- ── Liste logs ────────────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto min-h-0">

      <!-- Empty state -->
      <div
        v-if="filteredLogs.length === 0 && !loading"
        class="flex flex-col items-center justify-center h-full gap-2"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-8 h-8 text-zinc-700">
          <path d="M5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 3a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H5z"/>
          <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3z"/>
        </svg>
        <p class="text-sm text-zinc-600">Aucun log</p>
      </div>

      <!-- Log rows -->
      <div
        v-for="log in filteredLogs"
        :key="log.id"
        :class="[
          'group border-b border-zinc-800/60 transition-colors',
          log.detail || parseFichiers(log.fichiers).length > 0 ? 'cursor-pointer hover:bg-zinc-800/40' : ''
        ]"
        @click="(log.detail || parseFichiers(log.fichiers).length > 0) && toggleExpand(log.id)"
      >
        <!-- Ligne principale -->
        <div class="flex items-center gap-3 px-4 py-2 min-w-0">

          <!-- Dot niveau -->
          <span
            :class="['shrink-0 w-1.5 h-1.5 rounded-full', levelCfg(log.niveau).dot]"
          />

          <!-- Badge niveau -->
          <span
            :class="[
              'shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded',
              levelCfg(log.niveau).text,
              levelCfg(log.niveau).bg
            ]"
          >{{ levelCfg(log.niveau).label }}</span>

          <!-- Timestamp -->
          <span
            class="shrink-0 text-[10px] text-zinc-500 font-mono w-10 text-right tabular-nums"
            :title="absoluteTime(log.created_at)"
          >{{ formatTime(log.created_at) }}</span>

          <!-- Agent badge -->
          <span
            v-if="log.agent_name"
            class="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded font-medium"
            :style="{
              color: agentFg(log.agent_name),
              backgroundColor: agentBg(log.agent_name),
              boxShadow: `0 0 0 1px ${agentBorder(log.agent_name)}`
            }"
          >{{ log.agent_name }}</span>
          <span v-else class="shrink-0 text-[11px] font-mono text-zinc-700 px-1.5 py-0.5">—</span>

          <!-- Action -->
          <span class="text-sm font-semibold text-zinc-200 truncate min-w-0">{{ log.action }}</span>

          <!-- Chevron si détail existe -->
          <svg
            v-if="log.detail || parseFichiers(log.fichiers).length > 0"
            :class="[
              'shrink-0 w-3 h-3 text-zinc-600 transition-transform ml-auto',
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
            class="text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words"
          >{{ log.detail }}</p>

          <!-- Fichiers -->
          <div v-if="parseFichiers(log.fichiers).length > 0" class="flex flex-wrap gap-1 mt-0.5">
            <span
              v-for="f in parseFichiers(log.fichiers)"
              :key="f"
              class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/50"
            >{{ f.split('/').pop() }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
