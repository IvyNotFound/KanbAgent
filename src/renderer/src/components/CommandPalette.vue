<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
import type { Task } from '@renderer/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'select-task', task: Task): void
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()

const searchQuery = ref('')
const debouncedQuery = ref('')
const selectedIndex = ref(0)
const inputRef = ref<{ focus: () => void } | null>(null)

const filterStatut = ref<string | null>(null)
const filterAgentId = ref<number | null>(null)
const filterPerimetre = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedQuery.value = val }, 300)
})

const STATUTS = computed(() => [
  { key: 'todo',        label: t('columns.todo'),        color: 'rgb(var(--v-theme-warning))' },
  { key: 'in_progress', label: t('columns.in_progress'), color: 'rgb(var(--v-theme-secondary))' },
  { key: 'done',        label: t('columns.done'),        color: 'var(--content-faint)' },
  { key: 'archived',    label: t('columns.archived'),    color: 'rgb(var(--v-theme-primary))' },
])

// Pre-computed lowercase index — recomputes only when tasks list changes, not on every keystroke
const searchIndex = computed<Map<number, string>>(() => {
  const map = new Map<number, string>()
  for (const t of tasksStore.tasks) {
    map.set(t.id, (t.title + ' ' + (t.description ?? '')).toLowerCase())
  }
  return map
})

const filteredTasks = computed<Task[]>(() => {
  const q = debouncedQuery.value.toLowerCase().trim()
  return tasksStore.tasks.filter(t => {
    if (filterStatut.value && t.status !== filterStatut.value) return false
    if (filterAgentId.value !== null && Number(t.agent_assigned_id) !== Number(filterAgentId.value)) return false
    if (filterPerimetre.value && t.scope !== filterPerimetre.value) return false
    if (!q) return true
    if (String(t.id) === q) return true
    return searchIndex.value.get(t.id)?.includes(q) ?? false
  }).slice(0, 20)
})

const hasFilters = computed(() =>
  filterStatut.value !== null || filterAgentId.value !== null || filterPerimetre.value !== null
)

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
onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (debounceTimer) clearTimeout(debounceTimer)
})

function effortColor(effort: number): string {
  if (effort === 1) return 'rgb(var(--v-theme-secondary))'
  if (effort === 2) return 'rgb(var(--v-theme-warning))'
  return 'rgb(var(--v-theme-error))'
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="672" @update:model-value="close">
    <!-- v-if="modelValue" ensures content is not rendered when closed (test compat for shallowMount) -->
    <!-- data-testid="palette-backdrop" allows @click.self backdrop test -->
    <div
      v-if="modelValue"
      data-testid="palette-backdrop"
      class="palette-backdrop"
      @click.self="close"
      @keydown="handleKeydown"
    >
      <div class="palette-panel elevation-8">

        <!-- Search input -->
        <div class="palette-search">
          <v-text-field
            ref="inputRef"
            v-model="searchQuery"
            data-testid="search-input"
            variant="plain"
            hide-details
            :placeholder="t('commandPalette.placeholder')"
            prepend-inner-icon="mdi-magnify"
            clearable
            class="palette-text-field"
          />
          <div class="d-flex align-center ga-2 flex-shrink-0">
            <v-btn
              v-if="hasFilters"
              variant="text"
              size="small"
              class="btn-reset text-caption"
              @click="clearFilters"
            >{{ t('commandPalette.resetFilters') }}</v-btn>
            <kbd class="palette-kbd">ESC</kbd>
          </div>
        </div>

        <!-- Filters -->
        <div class="palette-filters">
          <!-- Statut chips -->
          <div class="d-flex align-center ga-2 flex-wrap">
            <span class="filter-label text-caption font-weight-medium">{{ t('commandPalette.status') }}</span>
            <v-chip-group
              :model-value="filterStatut ?? undefined"
              @update:model-value="filterStatut = $event ?? null"
            >
              <v-chip
                v-for="s in STATUTS"
                :key="s.key"
                :value="s.key"
                variant="outlined"
                size="small"
              >
                <span class="status-dot mr-1" :style="{ backgroundColor: s.color }" />
                {{ s.label }}
              </v-chip>
            </v-chip-group>
          </div>

          <!-- Agent + Périmètre -->
          <div v-if="tasksStore.agents.length > 0 || tasksStore.perimetresData.length > 0" class="d-flex align-center ga-3 flex-wrap">
            <!-- Agents -->
            <div v-if="tasksStore.agents.length > 0" class="d-flex align-center ga-2 flex-wrap">
              <span class="filter-label text-caption font-weight-medium">{{ t('commandPalette.agent') }}</span>
              <v-chip-group
                :model-value="filterAgentId ?? undefined"
                @update:model-value="filterAgentId = $event != null ? Number($event) : null"
              >
                <v-chip
                  v-for="agent in tasksStore.agents.slice(0, 8)"
                  :key="agent.id"
                  :value="agent.id"
                  variant="outlined"
                  size="small"
                  class="filter-chip--mono"
                  :style="filterAgentId === Number(agent.id)
                    ? { color: agentFg(agent.name), backgroundColor: agentBg(agent.name), borderColor: agentFg(agent.name) + '66' }
                    : {}"
                >
                  {{ agent.name }}
                </v-chip>
              </v-chip-group>
            </div>

            <!-- Périmètres -->
            <div v-if="tasksStore.perimetresData.length > 0" class="d-flex align-center ga-2 flex-wrap">
              <span class="filter-label text-caption font-weight-medium">{{ t('commandPalette.perimeter') }}</span>
              <v-chip-group
                :model-value="filterPerimetre ?? undefined"
                @update:model-value="filterPerimetre = $event ?? null"
              >
                <v-chip
                  v-for="p in tasksStore.perimetresData"
                  :key="p.id"
                  :value="p.name"
                  variant="outlined"
                  size="small"
                  class="filter-chip--mono"
                  :style="filterPerimetre === p.name
                    ? { color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentFg(p.name) + '66' }
                    : {}"
                >
                  {{ p.name }}
                </v-chip>
              </v-chip-group>
            </div>
          </div>
        </div>

        <!-- Results -->
        <v-list class="palette-results" bg-color="transparent" :padding="false">
          <div v-if="filteredTasks.length === 0" class="palette-empty">
            <v-icon class="empty-icon" size="24">mdi-magnify</v-icon>
            <p class="text-caption" style="color: var(--content-faint)">
              {{ debouncedQuery || hasFilters ? t('commandPalette.noResults') : t('commandPalette.noTasksLoaded') }}
            </p>
          </div>

          <template v-else>
            <div class="palette-count">
              <p class="filter-label text-caption font-weight-medium">
                {{ filteredTasks.length }} {{ t('commandPalette.tasks', filteredTasks.length) }}
              </p>
            </div>
            <v-list-item
              v-for="(task, index) in filteredTasks"
              :key="task.id"
              :class="['palette-item', index === selectedIndex ? 'palette-item--selected' : '']"
              @click="selectTask(task)"
              @mouseenter="selectedIndex = index"
            >
              <!-- Inline row: status dot · content · effort dot
                   (avoids #prepend/#append slot syntax on custom element in test env) -->
              <div class="palette-item-row">
                <span
                  class="status-dot flex-shrink-0"
                  style="margin-top: 4px;"
                  :style="{ backgroundColor: STATUTS.find(s => s.key === task.status)?.color ?? 'var(--content-faint)' }"
                />
                <div style="min-width: 0; flex: 1;">
                  <div class="d-flex align-center ga-2">
                    <span class="task-id">#{{ task.id }}</span>
                    <span class="task-title text-body-2">{{ task.title }}</span>
                  </div>
                  <div class="d-flex align-center ga-2 mt-1">
                    <span
                      v-if="task.agent_name"
                      class="task-agent"
                      :style="{ color: agentFg(task.agent_name) }"
                    >{{ task.agent_name }}</span>
                    <span
                      v-if="task.scope"
                      class="task-scope"
                      :style="{ color: agentFg(task.scope), backgroundColor: agentBg(task.scope) }"
                    >{{ task.scope }}</span>
                  </div>
                </div>
                <span
                  v-if="task.effort"
                  class="effort-dot flex-shrink-0"
                  :style="{ backgroundColor: effortColor(task.effort) }"
                  :title="task.effort === 1 ? 'Small' : task.effort === 2 ? 'Medium' : 'Large'"
                />
              </div>
            </v-list-item>
          </template>
        </v-list>

        <!-- Footer -->
        <div class="palette-footer">
          <span class="palette-hint text-caption"><kbd class="palette-kbd">↑↓</kbd> {{ t('commandPalette.navigate') }}</span>
          <span class="palette-hint text-caption"><kbd class="palette-kbd">↵</kbd> {{ t('commandPalette.open') }}</span>
          <span class="palette-hint text-caption" style="margin-left: auto;"><kbd class="palette-kbd">Ctrl+K</kbd> toggle</span>
        </div>

      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.palette-backdrop {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}
.palette-panel {
  width: 100%;
  margin: 0 16px;
  background: var(--surface-dialog);
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface, 255, 255, 255), 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 72vh;
}

/* Search row */
.palette-search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 16px 4px 12px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.palette-text-field {
  flex: 1;
}
.palette-text-field :deep(.v-field__input) {
  font-size: 14px;
  min-height: 0;
  padding-top: 8px;
  padding-bottom: 8px;
}
.palette-text-field :deep(.v-input__control) {
  min-height: 0;
}

/* Filters */
.palette-filters {
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.filter-label {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--content-faint);
  flex-shrink: 0;
}
.filter-chip--mono :deep(.v-chip__content) {
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
}
/* Soften chip borders on dark background — selected chips override via inline :style */
.palette-filters :deep(.v-chip--variant-outlined) {
  border-color: rgba(var(--v-theme-on-surface), 0.18) !important;
  color: var(--content-subtle) !important;
}

/* Status / effort dots */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}
.effort-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

/* Results */
.palette-results {
  flex: 1;
  overflow-y: auto;
  min-height: 240px; /* ~3-4 items, prevents height jump when filters reduce results */
}
.palette-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  gap: 8px;
}
.empty-icon {
  width: 24px;
  height: 24px;
  color: var(--content-dim);
}
.palette-count {
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.palette-item {
  cursor: pointer;
  border-left: 2px solid transparent !important;
  padding: 8px 16px !important;
  min-height: 0 !important;
}
.palette-item:hover {
  background: rgba(var(--v-theme-on-surface, 255, 255, 255), 0.05) !important;
  border-left-color: var(--content-faint) !important;
}
.palette-item--selected {
  background: var(--surface-secondary) !important;
  border-left-color: rgb(var(--v-theme-primary)) !important;
}

.palette-item-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}

/* Task item content */
.task-id {
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-faint);
  flex-shrink: 0;
}
.task-title {
  font-weight: 500;
  color: var(--content-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-agent {
  font-size: 11px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-scope {
  font-size: 10px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  padding: 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* Footer */
.palette-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--edge-subtle);
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}
.palette-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--content-faint);
}
.palette-kbd {
  padding: 4px 8px;
  font-size: 11px;
  background: var(--surface-secondary);
  color: var(--content-subtle);
  border-radius: 4px;
  border: 1px solid var(--edge-default);
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.btn-reset {
  color: rgb(var(--v-theme-primary)) !important;
}
.btn-reset:hover {
  color: rgba(var(--v-theme-primary), 0.8) !important;
}
</style>
