<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentAccent } from '@renderer/utils/agentColor'
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
    <!-- Transition wraps v-if for MD3 entry/exit motion -->
    <!-- data-testid="palette-backdrop" required by tests (@click.self compat) -->
    <Transition name="palette">
      <div
        v-if="modelValue"
        data-testid="palette-backdrop"
        class="d-flex align-center justify-center"
        @click.self="close"
        @keydown="handleKeydown"
      >
        <v-card
          class="d-flex flex-column"
          width="100%"
          max-width="672"
          rounded="xl"
          elevation="8"
          :style="{ height: 'min(72vh, 640px)', overflow: 'hidden' }"
        >

          <!-- Search row -->
          <div class="d-flex align-center ga-3 px-4 py-1 flex-shrink-0">
            <v-text-field
              ref="inputRef"
              v-model="searchQuery"
              data-testid="search-input"
              variant="plain"
              hide-details
              :placeholder="t('commandPalette.placeholder')"
              prepend-inner-icon="mdi-magnify"
              clearable
              class="flex-grow-1"
            />
            <div class="d-flex align-center ga-2 flex-shrink-0">
              <v-btn
                v-if="hasFilters"
                variant="text"
                size="small"
                color="primary"
                @click="clearFilters"
              >{{ t('commandPalette.resetFilters') }}</v-btn>
              <kbd class="palette-kbd">ESC</kbd>
            </div>
          </div>

          <v-divider />

          <!-- Filters -->
          <div class="pa-3 d-flex flex-column ga-1 flex-shrink-0">
            <!-- Status chips -->
            <div class="d-flex align-center ga-2 flex-wrap">
              <span class="text-caption font-weight-bold text-medium-emphasis">{{ t('commandPalette.status') }}</span>
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

            <!-- Agent + Perimeter chips -->
            <div
              v-if="tasksStore.agents.length > 0 || tasksStore.perimetresData.length > 0"
              class="d-flex align-center ga-3 flex-wrap"
            >
              <div v-if="tasksStore.agents.length > 0" class="d-flex align-center ga-2 flex-wrap">
                <span class="text-caption font-weight-bold text-medium-emphasis">{{ t('commandPalette.agent') }}</span>
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
                    :style="filterAgentId === Number(agent.id)
                      ? { color: agentFg(agent.name), backgroundColor: agentBg(agent.name), borderColor: agentFg(agent.name) + '66', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.75rem' }
                      : { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.75rem' }"
                  >{{ agent.name }}</v-chip>
                </v-chip-group>
              </div>

              <div v-if="tasksStore.perimetresData.length > 0" class="d-flex align-center ga-2 flex-wrap">
                <span class="text-caption font-weight-bold text-medium-emphasis">{{ t('commandPalette.perimeter') }}</span>
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
                    :style="filterPerimetre === p.name
                      ? { color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentFg(p.name) + '66', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.75rem' }
                      : { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.75rem' }"
                  >{{ p.name }}</v-chip>
                </v-chip-group>
              </div>
            </div>
          </div>

          <v-divider />

          <!-- Results -->
          <v-list class="flex-grow-1 overflow-y-auto" bg-color="transparent" density="compact">
            <template v-if="filteredTasks.length === 0">
              <div class="d-flex flex-column align-center justify-center py-12 ga-2">
                <v-icon size="24" class="text-disabled">mdi-magnify</v-icon>
                <p class="text-caption text-medium-emphasis">
                  {{ debouncedQuery || hasFilters ? t('commandPalette.noResults') : t('commandPalette.noTasksLoaded') }}
                </p>
              </div>
            </template>

            <template v-else>
              <div class="px-5 py-2 text-caption font-weight-bold text-medium-emphasis">
                {{ filteredTasks.length }} {{ t('commandPalette.tasks', filteredTasks.length) }}
              </div>
              <v-list-item
                v-for="(task, index) in filteredTasks"
                :key="task.id"
                :active="index === selectedIndex"
                active-color="primary"
                class="px-5"
                @click="selectTask(task)"
                @mouseenter="selectedIndex = index"
              >
                <div class="d-flex align-start ga-2">
                  <span
                    class="status-dot flex-shrink-0"
                    :style="{ marginTop: '4px', backgroundColor: STATUTS.find(s => s.key === task.status)?.color ?? 'rgba(var(--v-theme-on-surface), 0.38)' }"
                  />
                  <div style="min-width: 0; flex: 1;">
                    <div class="d-flex align-center ga-2">
                      <span
                        class="text-caption text-medium-emphasis flex-shrink-0"
                        style="font-family: ui-monospace, Consolas, monospace;"
                      >#{{ task.id }}</span>
                      <span class="text-body-2 font-weight-medium text-truncate">{{ task.title }}</span>
                    </div>
                    <div class="d-flex align-center ga-2 mt-1">
                      <span
                        v-if="task.agent_name"
                        class="text-caption"
                        :style="{ color: agentAccent(task.agent_name), fontFamily: 'ui-monospace, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }"
                      >{{ task.agent_name }}</span>
                      <span
                        v-if="task.scope"
                        class="text-caption rounded-sm px-1 flex-shrink-0"
                        :style="{ color: agentFg(task.scope), backgroundColor: agentBg(task.scope), fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '10px' }"
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

          <v-divider />

          <!-- Footer -->
          <div class="d-flex align-center ga-4 px-5 py-2 flex-shrink-0">
            <span class="d-flex align-center ga-1 text-caption text-medium-emphasis">
              <kbd class="palette-kbd">↑↓</kbd> {{ t('commandPalette.navigate') }}
            </span>
            <span class="d-flex align-center ga-1 text-caption text-medium-emphasis">
              <kbd class="palette-kbd">↵</kbd> {{ t('commandPalette.open') }}
            </span>
            <span class="d-flex align-center ga-1 text-caption text-medium-emphasis ml-auto">
              <kbd class="palette-kbd">Ctrl+K</kbd> toggle
            </span>
          </div>

        </v-card>
      </div>
    </Transition>
  </v-dialog>
</template>

<style scoped>
/* MD3 entry/exit motion — v-card slides from -8px above */
.palette-enter-from :deep(.v-card),
.palette-leave-to   :deep(.v-card) { transform: translateY(-8px); opacity: 0; }

/* v-text-field compact height overrides — no prop equivalent for min-height:0 */
:deep(.v-field__input) { min-height: 0; padding-top: 8px; padding-bottom: 8px; font-size: 0.875rem; }
:deep(.v-input__control) { min-height: 0; }

/* Chip border softening — outlined chip default border too prominent on dark bg */
:deep(.v-chip--variant-outlined) { border-color: rgba(var(--v-theme-on-surface), 0.18) !important; }

/* Selected list item — MD3 primary left indicator */
:deep(.v-list-item--active) { border-left: 2px solid rgb(var(--v-theme-primary)); }

/* Status / effort dots */
.status-dot,
.effort-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

/* kbd key caps */
.palette-kbd {
  padding: 2px 6px; font-size: 0.75rem; font-family: ui-monospace, Consolas, monospace;
  background: rgba(var(--v-theme-on-surface), 0.08); border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
