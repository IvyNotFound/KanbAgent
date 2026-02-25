<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import StatusColumn from './StatusColumn.vue'

const { t, locale } = useI18n()
const store = useTasksStore()

type BoardTab = 'backlog' | 'archive'
const activeTab = ref<BoardTab>('backlog')

// Search query
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

// Filtered tasks by search query
const emptyTasks = { todo: [], in_progress: [], done: [], archived: [] }
const filteredTasksByStatus = computed(() => {
  const base = store.tasksByStatus ?? emptyTasks
  const query = searchQuery.value.toLowerCase().trim()

  if (!query) return base

  const filterTask = (task: { titre?: string; description?: string; perimetre?: string; statut?: string; agent_name?: string }) => {
    if (task.titre?.toLowerCase().includes(query)) return true
    if (task.description?.toLowerCase().includes(query)) return true
    if (task.perimetre?.toLowerCase().includes(query)) return true
    if (task.statut?.toLowerCase().includes(query)) return true
    if (task.agent_name?.toLowerCase().includes(query)) return true
    return false
  }

  return {
    todo:        (base.todo        || []).filter(filterTask),
    in_progress: (base.in_progress || []).filter(filterTask),
    done:        (base.done        || []).filter(filterTask),
    archived:    (base.archived    || []).filter(filterTask),
  }
})

// Auto-switch to Archive tab when backlog is empty but archives exist
const shouldAutoSwitchToArchive = computed(() => {
  const tasks = filteredTasksByStatus.value
  const backlogCount = (tasks.todo?.length || 0) + (tasks.in_progress?.length || 0) + (tasks.done?.length || 0)
  const archiveCount = tasks.archived?.length || 0
  return backlogCount === 0 && archiveCount > 0
})

// Watch for backlog becoming empty and auto-switch to archive
watch(shouldAutoSwitchToArchive, (shouldSwitch) => {
  if (shouldSwitch) {
    activeTab.value = 'archive'
  }
})

// Keyboard shortcut: Ctrl+K to focus search
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    searchInputRef.value?.focus()
  }
  if (e.key === 'Escape' && document.activeElement === searchInputRef.value) {
    searchQuery.value = ''
    searchInputRef.value?.blur()
  }
}

// Add global keyboard listener in onMounted, remove in onUnmounted
onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

const columns = computed(() => [
  { key: 'todo'        as const, title: t('columns.todo'),        accentClass: 'bg-amber-500' },
  { key: 'in_progress' as const, title: t('columns.in_progress'), accentClass: 'bg-emerald-500' },
  { key: 'done'        as const, title: t('columns.done'),        accentClass: 'bg-zinc-500' },
])

const activeAgentName = computed(() =>
  store.selectedAgentId !== null
    ? (store.agents.find(a => Number(a.id) === Number(store.selectedAgentId))?.name ?? null)
    : null
)

function formatDate(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return new Date(iso).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })
}

const UNASSIGNED_SENTINEL = '__unassigned__'

// Lazy computed: only compute when archive tab is active
const archivedByAgent = computed(() => {
  // Only compute if on archive tab to avoid unnecessary recalculations
  if (activeTab.value !== 'archive') return []
  const tasks = filteredTasksByStatus?.value?.archived || []
  if (!tasks || tasks.length === 0) return []
  const groups = new Map<string, typeof tasks>()
  for (const task of tasks) {
    const key = task.agent_name ?? UNASSIGNED_SENTINEL
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(task)
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
      <!-- Sub-tabs -->
      <div class="flex items-center gap-1">
        <button
          v-for="tab in (['backlog', 'archive'] as BoardTab[])"
          :key="tab"
          :class="[
            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
            activeTab === tab
              ? 'bg-zinc-700 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          ]"
          @click="activeTab = tab"
        >
          {{ tab === 'backlog' ? t('board.backlog') : t('board.archive', { count: filteredTasksByStatus?.archived?.length || 0 }) }}
        </button>
      </div>

      <!-- Search -->
      <div class="relative">
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          :placeholder="t('board.searchPlaceholder')"
          class="w-48 pl-8 pr-7 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 placeholder-zinc-600 outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors font-mono"
        />
        <button
          v-if="searchQuery"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
          @click="searchQuery = ''"
        >✕</button>
      </div>

      <!-- Active filters -->
      <div class="flex items-center gap-2 flex-wrap">
        <span
          v-if="activeAgentName"
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono"
        >
          {{ activeAgentName }}
          <button class="hover:text-white transition-colors" @click="store.selectedAgentId = null">✕</button>
        </span>
        <span
          v-if="store.selectedPerimetre"
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border font-mono"
          :style="{ color: agentFg(store.selectedPerimetre), backgroundColor: agentBg(store.selectedPerimetre), borderColor: agentBorder(store.selectedPerimetre) }"
        >
          {{ store.selectedPerimetre }}
          <button class="hover:text-white transition-colors" @click="store.selectedPerimetre = null">✕</button>
        </span>
        <div v-if="store.error" class="text-xs text-red-400">{{ store.error }}</div>
      </div>
    </div>

    <!-- Board view: 3 colonnes -->
    <div v-if="activeTab === 'backlog'" class="flex-1 min-h-0 p-4">
      <div class="flex gap-3 h-full">
        <StatusColumn
          v-for="col in columns"
          :key="col.key"
          :title="col.title"
          :statut="col.key"
          :tasks="filteredTasksByStatus?.[col.key] || []"
          :accent-class="col.accentClass"
        />
      </div>
    </div>

    <!-- Archive view -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
      <div v-if="!filteredTasksByStatus?.archived?.length" class="flex items-center justify-center h-full">
        <p class="text-sm text-zinc-600 italic">{{ t('board.noArchived') }}</p>
      </div>
      <div v-else class="flex flex-col gap-4">
        <!-- Group by agent -->
        <div v-for="[agentName, tasks] in archivedByAgent" :key="agentName">
          <!-- Group header -->
          <div class="flex items-center gap-2 mb-2">
            <span
              class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono border"
              :style="agentName !== UNASSIGNED_SENTINEL
                ? { color: agentFg(agentName), backgroundColor: agentBg(agentName), borderColor: agentBorder(agentName) }
                : { color: '#71717a', backgroundColor: '#18181b', borderColor: '#3f3f46' }"
            >{{ agentName === UNASSIGNED_SENTINEL ? t('board.unassigned') : agentName }}</span>
            <span class="text-[10px] text-zinc-600 font-mono">{{ tasks.length }} {{ t('board.tickets', tasks.length) }}</span>
          </div>
          <!-- Tasks in group -->
          <div class="space-y-1.5">
            <button
              v-for="task in tasks"
              :key="task.id"
              class="w-full text-left px-4 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg transition-colors group"
              @click="store.openTask(task)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-zinc-300 group-hover:text-zinc-100 truncate transition-colors">{{ task.titre }}</p>
                  <span v-if="task.perimetre" class="text-[10px] font-mono text-zinc-600 mt-1 block">{{ task.perimetre }}</span>
                </div>
                <div class="shrink-0 text-right">
                  <span class="text-[10px] text-zinc-600 font-mono">{{ formatDate(task.updated_at) }}</span>
                  <p class="text-[10px] text-zinc-700 font-mono mt-0.5">#{{ task.id }}</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
