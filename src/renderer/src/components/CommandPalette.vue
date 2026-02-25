<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
import type { Task } from '@renderer/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'select-task', task: Task): void
}>()

const tasksStore = useTasksStore()
const tabsStore = useTabsStore()

const searchQuery = ref('')
const debouncedQuery = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const filterStatut = ref<string | null>(null)
const filterAgentId = ref<number | null>(null)
const filterPerimetre = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedQuery.value = val }, 300)
})

const STATUTS = [
  { key: 'a_faire',  label: 'À faire',  dot: 'bg-amber-500' },
  { key: 'en_cours', label: 'En cours', dot: 'bg-emerald-500' },
  { key: 'terminé',  label: 'Terminé',  dot: 'bg-zinc-400' },
  { key: 'archivé',  label: 'Archivé',  dot: 'bg-violet-500' },
]

const filteredTasks = computed<Task[]>(() => {
  const q = debouncedQuery.value.toLowerCase().trim()
  return tasksStore.tasks.filter(t => {
    if (filterStatut.value && t.statut !== filterStatut.value) return false
    if (filterAgentId.value !== null && Number(t.agent_assigne_id) !== Number(filterAgentId.value)) return false
    if (filterPerimetre.value && t.perimetre !== filterPerimetre.value) return false
    if (!q) return true
    return (
      t.titre.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.commentaire?.toLowerCase().includes(q) ||
      String(t.id) === q
    )
  }).slice(0, 20)
})

const hasFilters = computed(() =>
  filterStatut.value !== null || filterAgentId.value !== null || filterPerimetre.value !== null
)

function toggleStatut(key: string) {
  filterStatut.value = filterStatut.value === key ? null : key
}

function toggleAgent(id: number) {
  filterAgentId.value = filterAgentId.value === id ? null : id
}

function togglePerimetre(name: string) {
  filterPerimetre.value = filterPerimetre.value === name ? null : name
}

function clearFilters() {
  filterStatut.value = null
  filterAgentId.value = null
  filterPerimetre.value = null
}

function selectTask(task: Task) {
  emit('select-task', task)
  close()
}

function handleKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      selectedIndex.value = Math.min(selectedIndex.value + 1, filteredTasks.value.length - 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      break
    case 'Enter':
      e.preventDefault()
      if (filteredTasks.value[selectedIndex.value]) {
        selectTask(filteredTasks.value[selectedIndex.value])
      }
      break
    case 'Escape':
      e.preventDefault()
      close()
      break
  }
}

function close() {
  emit('update:modelValue', false)
  searchQuery.value = ''
  debouncedQuery.value = ''
  selectedIndex.value = 0
  clearFilters()
}

watch(filteredTasks, () => { selectedIndex.value = 0 })

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) setTimeout(() => inputRef.value?.focus(), 50)
})

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    emit('update:modelValue', !props.modelValue)
  }
}

onMounted(() => window.addEventListener('keydown', handleGlobalKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleGlobalKeydown))

function statutDot(statut: string): string {
  return STATUTS.find(s => s.key === statut)?.dot ?? 'bg-zinc-600'
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
        @click.self="close"
        @keydown="handleKeydown"
      >
        <div class="w-full max-w-2xl mx-4 bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700/60 overflow-hidden flex flex-col max-h-[72vh]">

          <!-- Search input -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 text-zinc-500 shrink-0">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
            </svg>
            <input
              ref="inputRef"
              v-model="searchQuery"
              type="text"
              placeholder="Rechercher une tâche par titre, description, #id…"
              class="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 outline-none text-sm"
            >
            <div class="flex items-center gap-2 shrink-0">
              <button
                v-if="hasFilters"
                class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                @click="clearFilters"
              >reset filtres</button>
              <kbd class="px-1.5 py-0.5 text-xs bg-zinc-800 text-zinc-500 rounded border border-zinc-700">ESC</kbd>
            </div>
          </div>

          <!-- Filters -->
          <div class="px-4 py-2.5 border-b border-zinc-800 shrink-0 space-y-2">
            <!-- Statut chips -->
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold mr-1">Statut</span>
              <button
                v-for="s in STATUTS"
                :key="s.key"
                class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-all border"
                :class="filterStatut === s.key
                  ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                  : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'"
                @click="toggleStatut(s.key)"
              >
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="s.dot" />
                {{ s.label }}
              </button>
            </div>

            <!-- Agent + Périmètre -->
            <div v-if="tasksStore.agents.length > 0 || tasksStore.perimetresData.length > 0" class="flex items-center gap-3 flex-wrap">
              <!-- Agents -->
              <div v-if="tasksStore.agents.length > 0" class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold mr-1">Agent</span>
                <button
                  v-for="agent in tasksStore.agents.slice(0, 8)"
                  :key="agent.id"
                  class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all border font-mono"
                  :class="filterAgentId === agent.id
                    ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                    : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'"
                  :style="filterAgentId === Number(agent.id)
                    ? { color: agentFg(agent.name), backgroundColor: agentBg(agent.name), borderColor: agentFg(agent.name) + '66' }
                    : {}"
                  @click="toggleAgent(Number(agent.id))"
                >
                  {{ agent.name }}
                </button>
              </div>

              <!-- Périmètres -->
              <div v-if="tasksStore.perimetresData.length > 0" class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold mr-1">Périmètre</span>
                <button
                  v-for="p in tasksStore.perimetresData"
                  :key="p.id"
                  class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all border font-mono"
                  :class="filterPerimetre === p.name
                    ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                    : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'"
                  :style="filterPerimetre === p.name
                    ? { color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentFg(p.name) + '66' }
                    : {}"
                  @click="togglePerimetre(p.name)"
                >
                  {{ p.name }}
                </button>
              </div>
            </div>
          </div>

          <!-- Results -->
          <div class="flex-1 overflow-y-auto min-h-0">
            <div v-if="filteredTasks.length === 0" class="flex flex-col items-center justify-center py-12 gap-2">
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-6 h-6 text-zinc-700">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
              </svg>
              <p class="text-sm text-zinc-600">
                {{ debouncedQuery || hasFilters ? 'Aucun résultat' : 'Aucune tâche chargée' }}
              </p>
            </div>

            <div v-else>
              <div class="px-4 py-1.5 flex items-center justify-between">
                <p class="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">
                  {{ filteredTasks.length }} tâche{{ filteredTasks.length > 1 ? 's' : '' }}
                </p>
              </div>
              <div
                v-for="(task, index) in filteredTasks"
                :key="task.id"
                class="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-l-2"
                :class="index === selectedIndex
                  ? 'bg-zinc-800 border-violet-500'
                  : 'border-transparent hover:bg-zinc-800/50 hover:border-zinc-600'"
                @click="selectTask(task)"
                @mouseenter="selectedIndex = index"
              >
                <!-- Status dot -->
                <span class="w-2 h-2 rounded-full shrink-0 mt-0.5" :class="statutDot(task.statut)" />

                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-zinc-600 shrink-0">#{{ task.id }}</span>
                    <span class="text-sm text-zinc-100 truncate font-medium">{{ task.titre }}</span>
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span
                      v-if="task.agent_name"
                      class="text-[11px] font-mono truncate"
                      :style="{ color: agentFg(task.agent_name) }"
                    >{{ task.agent_name }}</span>
                    <span
                      v-if="task.perimetre"
                      class="text-[10px] font-mono px-1 py-0.5 rounded shrink-0"
                      :style="{ color: agentFg(task.perimetre), backgroundColor: agentBg(task.perimetre) }"
                    >{{ task.perimetre }}</span>
                  </div>
                </div>

                <!-- Effort dot -->
                <span
                  v-if="task.effort"
                  class="w-2 h-2 rounded-full shrink-0"
                  :class="task.effort === 1 ? 'bg-emerald-500' : task.effort === 2 ? 'bg-amber-500' : 'bg-red-500'"
                  :title="task.effort === 1 ? 'Small' : task.effort === 2 ? 'Medium' : 'Large'"
                />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-4 py-2 border-t border-zinc-800 flex items-center gap-4 text-xs text-zinc-600 shrink-0">
            <span><kbd class="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700">↑↓</kbd> naviguer</span>
            <span><kbd class="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700">↵</kbd> ouvrir</span>
            <span class="ml-auto"><kbd class="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700">Ctrl+K</kbd> toggle</span>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.12s ease;
}
.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
</style>
