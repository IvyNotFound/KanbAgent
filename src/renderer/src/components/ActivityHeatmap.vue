<script setup lang="ts">
/**
 * ActivityHeatmap — GitHub-style contribution heatmap of agent activity.
 *
 * Renders a 52×7 grid covering the past 365 days. Each cell represents one day;
 * colour intensity (0–4) reflects the number of tasks completed (`done`/`archived`)
 * on that day. An agent filter bar lets the user restrict the view to a single agent.
 *
 * @prop {string} dbPath - Absolute path to the active project SQLite database.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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
const agents = ref<AgentOption[]>([{ id: null, name: '' }])
const filterAgentId = ref<number | null>(null)

async function fetchData(): Promise<void> {
  if (!props.dbPath) return
  try {
    const [heatData, agentData] = await Promise.all([
      window.electronAPI.queryDb(props.dbPath, `
        SELECT date(t.completed_at) as day,
               t.agent_assigned_id as agentId,
               a.name as agentName,
               COUNT(*) as count
        FROM tasks t
        LEFT JOIN agents a ON t.agent_assigned_id = a.id
        WHERE t.status IN ('done', 'archived')
          AND t.completed_at IS NOT NULL
          AND t.completed_at >= date('now', '-365 days')
        GROUP BY day, t.agent_assigned_id
        ORDER BY day
      `),
      window.electronAPI.queryDb(props.dbPath, `
        SELECT DISTINCT a.id, a.name
        FROM agents a
        JOIN tasks t ON t.agent_assigned_id = a.id
        WHERE t.status IN ('done', 'archived')
          AND t.completed_at IS NOT NULL
          AND t.completed_at >= date('now', '-365 days')
        ORDER BY a.name
      `),
    ])
    rows.value = heatData as DayData[]
    agents.value = [
      { id: null, name: '' },
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

const COLORS = ['heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4']

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
  <div class="heatmap-root">
    <!-- Filters -->
    <div class="heatmap-filters">
      <span class="heatmap-label text-label-medium">{{ t('heatmap.agentLabel') }}</span>
      <div class="heatmap-filter-btns">
        <v-btn
          v-for="a in agents"
          :key="String(a.id)"
          variant="text"
          size="small"
          density="compact"
          class="heatmap-filter-btn"
          :class="{ 'heatmap-filter-btn--active': filterAgentId === a.id }"
          @click="filterAgentId = a.id"
        >
          {{ a.id === null ? t('heatmap.all') : a.name }}
        </v-btn>
      </div>
    </div>

    <!-- Heatmap grid -->
    <div class="heatmap-grid-wrap">
      <div
        class="heatmap-grid"
        style="grid-template-columns: repeat(52, 12px); grid-template-rows: repeat(7, 12px);"
      >
        <div
          v-for="cell in grid"
          :key="cell.date"
          class="heatmap-cell"
          :class="COLORS[intensity(cell.count)]"
          :style="{ gridColumn: cell.week + 1, gridRow: cell.day + 1 }"
          :title="t('heatmap.tooltip', cell.count, { named: { date: cell.date, n: cell.count } })"
        />
      </div>
    </div>

    <!-- Legend -->
    <div class="heatmap-legend text-label-medium">
      <span>{{ t('heatmap.less') }}</span>
      <div
        v-for="(cls, idx) in COLORS"
        :key="idx"
        class="heatmap-legend-dot"
        :class="cls"
      />
      <span>{{ t('heatmap.more') }}</span>
      <span class="heatmap-legend-max">{{ t('heatmap.maxPerDay', maxCount, { named: { n: maxCount } }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.heatmap-root {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 12px;
}
.heatmap-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.heatmap-label {
  color: var(--content-faint);
  font-weight: 600;
}
.heatmap-filter-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.heatmap-filter-btn {
  font-size: 0.75rem !important; /* text-caption — monospace retained for filter button style */
  font-family: ui-monospace, monospace !important;
  border: 1px solid var(--edge-subtle) !important;
  color: var(--content-subtle) !important;
}
.heatmap-filter-btn:hover { color: var(--content-secondary) !important; }
.heatmap-filter-btn--active {
  border-color: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-secondary));
  background: rgba(var(--v-theme-secondary), 0.1);
}
.heatmap-grid-wrap {
  overflow-x: auto;
  flex-shrink: 0;
}
.heatmap-grid {
  display: grid;
  gap: 4px;
}
.heatmap-cell {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  cursor: default;
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
}
/* Heat intensity levels */
.heat-0 { background-color: rgba(var(--v-theme-surface-tertiary), 0.4); }
.heat-1 { background-color: rgba(var(--v-theme-secondary), 0.15); }
.heat-2 { background-color: rgba(var(--v-theme-secondary), 0.35); }
.heat-3 { background-color: rgb(var(--v-theme-secondary)); }
.heat-4 { background-color: rgba(var(--v-theme-secondary), 0.7); }
.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--content-faint);
  flex-shrink: 0;
}
.heatmap-legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}
.heatmap-legend-max {
  margin-left: auto;
  font-family: ui-monospace, monospace;
}
</style>
