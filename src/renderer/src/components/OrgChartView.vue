<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useAgentsStore } from '@renderer/stores/agents'
import { agentFg } from '@renderer/utils/agentColor'
import {
  type AgentRow,
  type LayoutGroup,
  CARD_W,
  CARD_H,
  NESTING_PAD,
  GROUP_HEADER_H,
  GROUP_GAP,
  CANVAS_PAD,
  DOT_COLORS,
  buildGroupLayout,
  buildFlatGroup,
  flattenGroups,
} from '@renderer/utils/orgChartLayout'

const { t } = useI18n()
const store = useTasksStore()
const agentStore = useAgentsStore()

// ── Data ──────────────────────────────────────────────────────────────────────

const agents = ref<AgentRow[]>([])
const loading = ref(false)

async function fetchData(): Promise<void> {
  if (!store.dbPath) return
  loading.value = true
  try {
    const [result] = await Promise.all([
      window.electronAPI.queryDb(
        store.dbPath,
        `SELECT a.id, a.name, a.type, a.scope,
                s.status as session_status,
                (SELECT COUNT(*) FROM tasks WHERE agent_assigned_id = a.id AND status = 'in_progress') as tasks_in_progress,
                (SELECT COUNT(*) FROM tasks WHERE agent_assigned_id = a.id AND status = 'todo') as tasks_todo
         FROM agents a
         LEFT JOIN sessions s ON s.id = (
           SELECT s2.id FROM sessions s2 WHERE s2.agent_id = a.id
           ORDER BY s2.started_at DESC LIMIT 1
         )
         ORDER BY a.name`,
        []
      ) as Promise<AgentRow[]>,
      agentStore.fetchAgentGroups(),
    ])
    agents.value = result
  } catch {
    agents.value = []
  } finally {
    loading.value = false
  }
}

// ── Layout ────────────────────────────────────────────────────────────────────

const layout = computed<{ groups: LayoutGroup[]; totalW: number; totalH: number }>(() => {
  const rootGroups: LayoutGroup[] = []
  let curX = CANVAS_PAD

  if (agentStore.agentGroupsTree.length > 0) {
    // Hierarchical layout from agentGroupsTree
    const agentMap = new Map(agents.value.map(a => [a.id, a]))
    const agentsByGroup = new Map<number, AgentRow[]>()
    const groupedIds = new Set<number>()

    for (const group of agentStore.agentGroups) {
      const ga = group.members
        .map(m => agentMap.get(m.agent_id))
        .filter((a): a is AgentRow => a !== undefined)
      agentsByGroup.set(group.id, ga)
      ga.forEach(a => groupedIds.add(a.id))
    }

    for (const root of agentStore.agentGroupsTree) {
      const g = buildGroupLayout(root, curX, CANVAS_PAD, agentsByGroup, 0)
      rootGroups.push(g)
      curX += g.w + GROUP_GAP
    }

    // Ungrouped agents section
    const ungrouped = agents.value.filter(a => !groupedIds.has(a.id))
    if (ungrouped.length > 0) {
      const g = buildFlatGroup('__ungrouped__', t('orgchart.ungrouped'), ungrouped, curX, CANVAS_PAD)
      rootGroups.push(g)
      curX += g.w + GROUP_GAP
    }
  } else {
    // Fallback: scope-based grouping
    const grouped = new Map<string, AgentRow[]>()
    for (const a of agents.value) {
      const key = a.scope ?? '__global__'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(a)
    }

    const sortedKeys = [...grouped.keys()].sort((a, b) => {
      if (a === '__global__') return 1
      if (b === '__global__') return -1
      return a.localeCompare(b)
    })

    for (const key of sortedKeys) {
      const label = key === '__global__' ? t('topology.global') : key
      const g = buildFlatGroup(key, label, grouped.get(key)!, curX, CANVAS_PAD)
      rootGroups.push(g)
      curX += g.w + GROUP_GAP
    }
  }

  const totalW = rootGroups.length > 0 ? curX - GROUP_GAP + CANVAS_PAD : CANVAS_PAD * 2
  const totalH =
    rootGroups.length > 0
      ? CANVAS_PAD + Math.max(...rootGroups.map(g => g.h)) + CANVAS_PAD
      : CANVAS_PAD * 2

  return { groups: rootGroups, totalW, totalH }
})

const allGroupsFlat = computed(() => flattenGroups(layout.value.groups))
const allAgentsFlat = computed(() => allGroupsFlat.value.flatMap(g => g.agents))

// ── Pan/zoom ──────────────────────────────────────────────────────────────────

const transform = ref({ x: 0, y: 0, scale: 1 })
const dragging = ref(false)
const dragStart = ref({ mx: 0, my: 0, tx: 0, ty: 0 })
const svgEl = ref<SVGSVGElement | null>(null)

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  transform.value.scale = Math.min(2, Math.max(0.15, transform.value.scale * delta))
}

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return
  dragging.value = true
  dragStart.value = { mx: e.clientX, my: e.clientY, tx: transform.value.x, ty: transform.value.y }
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging.value) return
  transform.value.x = dragStart.value.tx + (e.clientX - dragStart.value.mx)
  transform.value.y = dragStart.value.ty + (e.clientY - dragStart.value.my)
}

function onMouseUp(): void {
  dragging.value = false
}

function fitView(): void {
  if (!svgEl.value) return
  const { totalW, totalH } = layout.value
  const rect = svgEl.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0 || totalW === 0 || totalH === 0) return
  const scale = Math.min(1, Math.min(rect.width / totalW, rect.height / totalH) * 0.92)
  transform.value = {
    x: (rect.width - totalW * scale) / 2,
    y: (rect.height - totalH * scale) / 2,
    scale,
  }
}

// ── Lifecycle & auto-refresh ──────────────────────────────────────────────────

let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await fetchData()
  fitView()
  refreshTimer = setInterval(fetchData, 5000)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousemove', onMouseMove)
})

watch(() => store.dbPath, async () => { await fetchData(); fitView() })
</script>

<template>
  <div class="oc-view">
    <!-- Header -->
    <div class="oc-header">
      <div class="oc-header-left">
        <h2 class="oc-title text-h6">{{ t('orgchart.agentsTitle') }}</h2>
        <span v-if="loading" class="oc-loading text-overline">•••</span>
      </div>
      <div class="oc-header-right">
        <!-- Legend -->
        <div class="oc-legend">
          <span v-for="(color, key) in DOT_COLORS" :key="key" class="oc-legend-item text-overline">
            <span class="oc-legend-dot" :style="{ background: color }"></span>
            <span>{{ key === 'cyan' ? t('orgchart.status.active') : key === 'green' ? t('orgchart.status.todo') : key === 'yellow' ? t('orgchart.status.idle') : key === 'red' ? t('orgchart.status.blocked') : t('orgchart.status.inactive') }}</span>
          </span>
        </div>
        <v-btn variant="tonal" size="small" class="oc-btn text-caption" @click="fitView">Fit</v-btn>
        <v-btn variant="text" size="small" class="oc-btn text-caption" @click="fetchData">&#8635;</v-btn>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && agents.length === 0" class="oc-empty">
      <p class="oc-empty-text text-body-2">{{ t('orgchart.noAgents') }}</p>
    </div>

    <!-- SVG Canvas -->
    <svg
      v-else
      ref="svgEl"
      class="oc-svg"
      :class="dragging ? 'oc-svg--grabbing' : 'oc-svg--grab'"
      @wheel.passive="onWheel"
      @mousedown="onMouseDown"
    >
      <g :transform="`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`">
        <!-- Group rectangles (parent before children = correct SVG layering) -->
        <g v-for="group in allGroupsFlat" :key="`grp-${group.key}`">
          <rect
            :x="group.x"
            :y="group.y"
            :width="group.w"
            :height="group.h"
            rx="8"
            :style="{ fill: group.depth === 0 ? 'rgb(var(--v-theme-surface-primary))' : 'rgb(var(--v-theme-surface-secondary))' }"
            :stroke="group.depth === 0 ? 'rgb(var(--v-theme-edge-default))' : 'rgb(var(--v-theme-content-faint))'"
            stroke-width="1"
          />
          <text
            :x="group.x + group.w / 2"
            :y="group.y + NESTING_PAD + GROUP_HEADER_H / 2 + 4"
            text-anchor="middle"
            font-size="11"
            font-family="ui-monospace, monospace"
            font-weight="600"
            :style="{ fill: 'rgb(var(--v-theme-content-muted))' }"
          >{{ group.label }}</text>
        </g>

        <!-- Agent cards (rendered last = on top of all group rects) -->
        <g v-for="node in allAgentsFlat" :key="`card-${node.id}`">
          <rect
            :x="node.x"
            :y="node.y"
            :width="CARD_W"
            :height="CARD_H"
            rx="8"
            :style="{ fill: 'rgb(var(--v-theme-surface-base))' }"
            stroke="rgb(var(--v-theme-edge-default))"
            stroke-width="1"
          />
          <circle
            :cx="node.x + CARD_W - 12"
            :cy="node.y + 12"
            r="5"
            :fill="DOT_COLORS[node.status]"
          >
            <animate
              v-if="node.status === 'cyan'"
              attributeName="opacity"
              values="1;0.4;1"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          <text
            :x="node.x + 10"
            :y="node.y + 22"
            font-size="12"
            font-family="ui-monospace, monospace"
            font-weight="700"
            :fill="agentFg(node.name)"
          >{{ node.name.length > 16 ? node.name.slice(0, 15) + '\u2026' : node.name }}</text>
          <text
            :x="node.x + 10"
            :y="node.y + 38"
            font-size="10"
            font-family="ui-monospace, monospace"
            :style="{ fill: 'rgb(var(--v-theme-content-subtle))' }"
          >{{ node.type }}</text>
          <text
            :x="node.x + 10"
            :y="node.y + 56"
            font-size="10"
            font-family="ui-sans-serif, system-ui, sans-serif"
            :fill="DOT_COLORS[node.status]"
          >{{ node.status === 'cyan' ? t('orgchart.status.active') : node.status === 'green' ? t('orgchart.status.todoAssigned') : node.status === 'yellow' ? t('orgchart.status.idle') : node.status === 'red' ? t('orgchart.status.blocked') : t('orgchart.status.inactive') }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.oc-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-base);
  overflow: hidden;
}
.oc-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid var(--edge-subtle);
}
.oc-header-left { display: flex; align-items: center; gap: 12px; }
.oc-title { font-weight: 500; color: var(--content-primary); margin: 0; }
.oc-loading {}
@keyframes ocPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.oc-header-right { display: flex; align-items: center; gap: 8px; }
.oc-legend { display: flex; align-items: center; gap: 12px; margin-right: 12px; }
.oc-legend-item { display: flex; align-items: center; gap: 4px; color: var(--content-faint); 
}
.oc-legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.oc-btn {
  color: var(--content-muted) !important;
}
.oc-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
.oc-empty-text {}
.oc-svg { flex: 1; width: 100%; }
.oc-svg--grab { cursor: grab; }
.oc-svg--grabbing { cursor: grabbing; }
</style>
