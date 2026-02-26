<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { useToast } from '@renderer/composables/useToast'
import type { TaskAssignee } from '@renderer/types'

// Configure marked for synchronous rendering
marked.setOptions({ async: false })

const { t, locale } = useI18n()
const store = useTasksStore()
const { push: pushToast } = useToast()
const task = computed(() => store.selectedTask)

const statusLabel = (key: string) => ({
  todo:        t('columns.todo'),
  in_progress: t('columns.in_progress'),
  done:        t('columns.done'),
  archived:    t('columns.archived'),
}[key] ?? key)

const STATUS_COLORS: Record<string, string> = {
  todo:        'bg-amber-500/20 text-amber-300 border-amber-500/30',
  in_progress: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  done:        'bg-surface-tertiary/50 text-content-tertiary border-content-faint/50',
  archived:    'bg-violet-500/20 text-violet-300 border-violet-500/30',
}

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_BADGE: Record<number, string> = {
  1: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  2: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  3: 'bg-red-500/20 text-red-300 border-red-500/30',
}

function formatDateFull(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return new Date(iso).toLocaleString(dateLocale, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Normaliser les retours à la ligne
function normalizeNewlines(text: string): string {
  return text.replace(/\\n/g, '\n')
}

// Render markdown with DOMPurify sanitization
function renderMarkdown(text: string): string {
  const normalized = normalizeNewlines(text)
  const raw = marked.parse(normalized) as string
  return DOMPurify.sanitize(raw)
}

// Computed for description
const renderedDescription = computed(() => {
  if (!task.value?.description) return ''
  return renderMarkdown(task.value.description)
})

// Memoized rendered comments — avoids re-parsing markdown on every render
const renderedComments = computed(() =>
  store.taskComments.map(c => ({ ...c, _html: renderMarkdown(c.contenu) }))
)

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('taskDetail.justNow')
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}j`
}

// ── Assignees (ADR-008) ───────────────────────────────────────────────────────

const assignees = ref<TaskAssignee[]>([])
const loadingAssignees = ref(false)
const savingAssignees = ref(false)
const showAgentDropdown = ref(false)

const sortedAssignees = computed(() =>
  [...assignees.value].sort((a, b) => {
    if (a.role === 'primary') return -1
    if (b.role === 'primary') return 1
    return 0
  })
)

async function loadAssignees(taskId: number): Promise<void> {
  if (!store.dbPath) return
  loadingAssignees.value = true
  try {
    const res = await window.electronAPI.getTaskAssignees(store.dbPath, taskId)
    if (res.success) assignees.value = res.assignees as TaskAssignee[]
  } catch {
    assignees.value = []
  } finally {
    loadingAssignees.value = false
  }
}

function isAssigned(agentId: number): boolean {
  return assignees.value.some(a => a.agent_id === agentId)
}

function toggleAssignee(agent: { id: number; name: string }): void {
  const idx = assignees.value.findIndex(a => a.agent_id === agent.id)
  if (idx === -1) {
    assignees.value.push({ agent_id: agent.id, agent_name: agent.name, role: null, assigned_at: new Date().toISOString() })
  } else {
    assignees.value.splice(idx, 1)
  }
}

function setRole(agentId: number, role: string): void {
  const a = assignees.value.find(a => a.agent_id === agentId)
  if (a) a.role = (role || null) as TaskAssignee['role']
}

async function saveAssignees(): Promise<void> {
  if (!store.dbPath || !task.value) return
  savingAssignees.value = true
  try {
    await window.electronAPI.setTaskAssignees(
      store.dbPath,
      task.value.id,
      assignees.value.map(a => ({ agentId: a.agent_id, role: a.role }))
    )
    showAgentDropdown.value = false
  } catch {
    pushToast(t('taskDetail.saveError'), 'error')
  } finally {
    savingAssignees.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') store.closeTask()
}

watch(task, async (val) => {
  if (val) {
    document.removeEventListener('keydown', handleKeydown)
    document.addEventListener('keydown', handleKeydown)
    await loadAssignees(val.id)
  } else {
    document.removeEventListener('keydown', handleKeydown)
    assignees.value = []
    showAgentDropdown.value = false
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-150 ease-out"
    enter-from-class="opacity-0 scale-[0.98]"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition-all duration-100 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-[0.98]"
  >
    <div
      v-if="task"
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/65 backdrop-blur-sm"
        @click="store.closeTask()"
      ></div>

      <!-- Panel -->
      <div class="relative w-full max-w-6xl max-h-[90vh] bg-surface-primary border border-edge-default rounded-xl shadow-2xl flex flex-col overflow-hidden mx-4 select-text">

        <!-- Header -->
        <div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-edge-subtle shrink-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-content-primary leading-snug mb-2">{{ task.titre }}</p>
            <div class="flex flex-wrap gap-1.5">
              <span :class="['text-xs px-2 py-0.5 rounded-full border font-medium', STATUS_COLORS[task.statut]]">
                {{ statusLabel(task.statut) }}
              </span>
              <span
                v-if="task.perimetre"
                class="text-xs px-1.5 py-0.5 rounded font-mono border"
                :style="{
                  color: perimeterFg(task.perimetre),
                  backgroundColor: perimeterBg(task.perimetre),
                  borderColor: perimeterBorder(task.perimetre),
                }"
              >{{ task.perimetre }}</span>
              <AgentBadge v-if="task.agent_name" :name="task.agent_name" :perimetre="task.agent_perimetre" />
              <span
                v-if="task.effort"
                :class="['text-xs font-bold px-2 py-0.5 rounded font-mono border', EFFORT_BADGE[task.effort]]"
              >{{ EFFORT_LABEL[task.effort] }}</span>
            </div>
          </div>
          <button
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-all text-sm"
            @click="store.closeTask()"
          >✕</button>
        </div>

        <!-- Body : 2 colonnes -->
        <div class="flex flex-1 min-h-0 divide-x divide-edge-subtle">

          <!-- Colonne gauche : description + commentaire tâche -->
          <div class="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5">
            <!-- Description -->
            <div v-if="task.description">
              <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-2">{{ t('taskDetail.description') }}</p>
              <div class="md-content text-sm text-content-tertiary leading-relaxed" v-html="renderedDescription"></div>
            </div>

            <p v-if="!task.description" class="text-sm text-content-faint italic pt-2">
              {{ t('taskDetail.noDescription') }}
            </p>
          </div>

          <!-- Colonne droite : assignés + commentaires -->
          <div class="w-72 shrink-0 flex flex-col min-h-0">

            <!-- Section Assignés -->
            <div class="px-4 py-3 border-b border-edge-subtle shrink-0">
              <div class="flex items-center justify-between mb-2">
                <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider">
                  {{ t('taskDetail.assignees') }}
                  <span v-if="loadingAssignees" class="ml-1 text-content-faint">…</span>
                </p>
                <button
                  class="text-[10px] text-content-muted hover:text-content-secondary transition-colors"
                  @click="showAgentDropdown = !showAgentDropdown"
                >{{ showAgentDropdown ? '▲' : '▼' }} {{ t('taskDetail.addAssignee') }}</button>
              </div>

              <!-- Assigned agents list -->
              <div v-if="sortedAssignees.length > 0" class="space-y-1 mb-2">
                <div v-for="a in sortedAssignees" :key="a.agent_id" class="flex items-center gap-1.5">
                  <div
                    class="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold border"
                    :style="{ color: agentFg(a.agent_name), backgroundColor: agentBg(a.agent_name), borderColor: agentBorder(a.agent_name) }"
                    :title="a.agent_name"
                  >{{ a.agent_name.slice(0, 2).toUpperCase() }}</div>
                  <span class="text-xs text-content-secondary truncate flex-1 min-w-0">{{ a.agent_name }}</span>
                  <select
                    :value="a.role ?? ''"
                    class="text-[10px] bg-surface-secondary border border-edge-default rounded px-1 py-0.5 text-content-muted focus:outline-none shrink-0"
                    @change="setRole(a.agent_id, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">—</option>
                    <option value="primary">primary</option>
                    <option value="support">support</option>
                    <option value="reviewer">reviewer</option>
                  </select>
                  <button
                    class="text-content-faint hover:text-content-secondary text-xs shrink-0 transition-colors"
                    @click="toggleAssignee({ id: a.agent_id, name: a.agent_name })"
                  >✕</button>
                </div>
              </div>
              <p v-else-if="!showAgentDropdown && !loadingAssignees" class="text-xs text-content-faint italic mb-2">
                {{ t('taskDetail.noAssignees') }}
              </p>

              <!-- Agent picker dropdown -->
              <div v-if="showAgentDropdown" class="max-h-32 overflow-y-auto border border-edge-default rounded bg-surface-secondary mb-2">
                <button
                  v-for="agent in store.agents"
                  :key="agent.id"
                  class="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-surface-tertiary transition-colors text-left"
                  @click="toggleAssignee({ id: agent.id, name: agent.name })"
                >
                  <span
                    :class="['w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 text-[8px]', isAssigned(agent.id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-edge-default text-transparent']"
                  >✓</span>
                  <span :style="{ color: agentFg(agent.name) }" class="font-mono truncate">{{ agent.name }}</span>
                </button>
              </div>

              <!-- Save button -->
              <button
                class="w-full text-xs px-2 py-1 bg-surface-secondary hover:bg-surface-tertiary border border-edge-default rounded transition-colors text-content-secondary disabled:opacity-50"
                :disabled="savingAssignees"
                @click="saveAssignees"
              >{{ savingAssignees ? t('common.saving') : t('common.save') }}</button>
            </div>

            <!-- Comments header -->
            <div class="px-4 py-3 border-b border-edge-subtle shrink-0">
              <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider">
                {{ t('taskDetail.comments') }}
                <span v-if="store.taskComments.length > 0" class="ml-1 text-content-faint">({{ store.taskComments.length }})</span>
              </p>
            </div>

            <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              <!-- Messages conversation -->
              <div
                v-for="comment in renderedComments"
                :key="comment.id"
                class="flex flex-col gap-1"
              >
                <!-- Auteur + temps -->
                <div class="flex items-center justify-between gap-2 px-1">
                  <span
                    class="text-[11px] font-semibold font-mono truncate"
                    :style="{ color: agentFg(comment.agent_name ?? 'unknown') }"
                  >{{ comment.agent_name ?? '?' }}</span>
                  <span class="text-[10px] text-content-faint shrink-0" :title="formatDateFull(comment.created_at)">
                    {{ relativeTime(comment.created_at) }}
                  </span>
                </div>
                <!-- Bulle -->
                <div
                  class="md-bubble rounded-lg px-3 py-2 text-xs leading-relaxed break-words border"
                  :style="{
                    color: agentFg(comment.agent_name ?? 'unknown'),
                    backgroundColor: agentBg(comment.agent_name ?? 'unknown'),
                    borderColor: agentBorder(comment.agent_name ?? 'unknown'),
                  }"
                  v-html="comment._html"
                ></div>
              </div>

              <p v-if="store.taskComments.length === 0" class="text-xs text-content-faint italic text-center py-4">
                {{ t('taskDetail.noComments') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-edge-subtle bg-surface-base/50 flex items-center justify-between gap-4 shrink-0">
          <div class="flex items-center gap-5">
            <p class="text-xs text-content-muted">
              <span class="text-content-subtle mr-1">{{ t('taskDetail.created') }}</span>{{ formatDateFull(task.created_at) }}
            </p>
            <p class="text-xs text-content-muted">
              <span class="text-content-subtle mr-1">{{ t('taskDetail.updated') }}</span>{{ formatDateFull(task.updated_at) }}
            </p>
          </div>
          <span class="text-xs text-content-subtle font-mono">#{{ task.id }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>
