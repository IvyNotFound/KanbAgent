<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'

const props = defineProps<{
  dbPath: string
}>()

interface DayData {
  day: string
  agentId: number | null
  agentName: string | null
  count: number
}

interface AgentOption {
  id: number | null
  name: string
}

const rows = ref<DayData[]>([])
const agents = ref<AgentOption[]>([{ id: null, name: 'Tous' }])
const filterAgentId = ref<number | null>(null)

async function fetchData(): Promise<void> {
  if (!props.dbPath) return
  try {
    const [heatData, agentData] = await Promise.all([
      window.electronAPI.queryDb(props.dbPath, `
        SELECT date(t.completed_at) as day,
               t.agent_assigne_id as agentId,
               a.name as agentName,
               COUNT(*) as count
        FROM tasks t
        LEFT JOIN agents a ON t.agent_assigne_id = a.id
        WHERE t.statut IN ('done', 'archived')
          AND t.completed_at IS NOT NULL
          AND t.completed_at >= date('now', '-365 days')
        GROUP BY day, t.agent_assigne_id
        ORDER BY day
      `),
      window.electronAPI.queryDb(props.dbPath, `
        SELECT DISTINCT a.id, a.name
        FROM agents a
        JOIN tasks t ON t.agent_assigne_id = a.id
        WHERE t.statut IN ('done', 'archived')
          AND t.completed_at IS NOT NULL
          AND t.completed_at >= date('now', '-365 days')
        ORDER BY a.name
      `),
    ])
    rows.value = heatData as DayData[]
    agents.value = [
      { id: null, name: 'Tous' },
      ...(agentData as Array<{ id: number; name: string }>).map(a => ({ id: a.id, name: a.name })),
    ]
  } catch {
    // ignore
  }
}

onMounted(fetchData)
watch(() => props.dbPath, fetchData)

/** Build a map day→count from filtered rows. */
const dayCountMap = computed((): Map<string, number> => {
  const m = new Map<string, number>()
  for (const r of rows.value) {
    if (filterAgentId.value !== null && r.agentId !== filterAgentId.value) continue
    m.set(r.day, (m.get(r.day) ?? 0) + r.count)
  }
  return m
})

/** Intensity: 0-4 based on count. */
function intensity(count: number): number {
  if (count === 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

const COLORS = [
  'bg-zinc-800',      // 0 — empty
  'bg-emerald-900',   // 1
  'bg-emerald-700',   // 2
  'bg-emerald-500',   // 3
  'bg-emerald-400',   // 4
]

/**
 * Build the 52×7 grid as a flat array of cells.
 * Starts from today, goes back 364 days (52 weeks).
 */
const grid = computed(() => {
  const cells: Array<{ date: string; day: number; count: number; week: number }> = []
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  // Start of the grid: 51 weeks ago, anchored to the same weekday as today
  const start = new Date(today)
  start.setDate(start.getDate() - 51 * 7 - today.getDay())
  for (let w = 0; w < 52; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const dateStr = date.toISOString().slice(0, 10)
      if (dateStr > todayStr) continue
      const count = dayCountMap.value.get(dateStr) ?? 0
      cells.push({ date: dateStr, day: d, count, week: w })
    }
  }
  return cells
})

const maxCount = computed(() => Math.max(...Array.from(dayCountMap.value.values()), 1))
</script>

<template>
  <div class="flex flex-col h-full min-h-0 overflow-y-auto px-4 py-3 gap-3">
    <!-- Filters -->
    <div class="flex items-center gap-3 shrink-0 flex-wrap">
      <span class="text-xs text-content-faint font-semibold">Agent :</span>
      <div class="flex gap-1.5 flex-wrap">
        <button
          v-for="a in agents"
          :key="String(a.id)"
          class="text-[11px] font-mono px-2 py-0.5 rounded border transition-colors"
          :class="filterAgentId === a.id
            ? 'border-emerald-600 text-emerald-300 bg-emerald-950/40'
            : 'border-edge-subtle text-content-subtle hover:text-content-secondary'"
          @click="filterAgentId = a.id"
        >
          {{ a.name }}
        </button>
      </div>
    </div>

    <!-- Heatmap grid -->
    <div class="overflow-x-auto shrink-0">
      <div
        class="grid gap-[3px]"
        style="grid-template-columns: repeat(52, 12px); grid-template-rows: repeat(7, 12px);"
      >
        <div
          v-for="cell in grid"
          :key="cell.date"
          class="w-3 h-3 rounded-sm transition-colors cursor-default"
          :class="COLORS[intensity(cell.count)]"
          :style="{ gridColumn: cell.week + 1, gridRow: cell.day + 1 }"
          :title="`${cell.date} — ${cell.count} tâche${cell.count !== 1 ? 's' : ''}`"
        />
      </div>
    </div>

    <!-- Legend -->
    <div class="flex items-center gap-2 text-[10px] text-content-faint shrink-0">
      <span>Moins</span>
      <div
        v-for="(cls, idx) in COLORS"
        :key="idx"
        class="w-3 h-3 rounded-sm"
        :class="cls"
      />
      <span>Plus</span>
      <span class="ml-auto font-mono">max : {{ maxCount }} tâche{{ maxCount !== 1 ? 's' : '' }} / jour</span>
    </div>
  </div>
</template>
