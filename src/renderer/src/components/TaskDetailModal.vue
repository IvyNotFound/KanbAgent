<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'
import type { TaskAssignee, TaskLink } from '@renderer/types'

// Configure marked for synchronous rendering
marked.setOptions({ async: false })

const { t, locale } = useI18n()
const store = useTasksStore()
const task = computed(() => store.selectedTask)

// ── Agents lookup ─────────────────────────────────────────────────────────────
const valideurAgent = computed(() =>
  store.agents.find(a => a.id === task.value?.agent_valideur_id) ?? null
)

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
  return parseUtcDate(iso).toLocaleString(dateLocale, {
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
  const diff = Date.now() - parseUtcDate(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('taskDetail.justNow')
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}j`
}

// ── Assignees (ADR-008, read-only — T571) ─────────────────────────────────────
// Synced from store.taskAssignees — display only, no mutation from UI

const assignees = ref<TaskAssignee[]>([])

// Sync display whenever the store loads assignees for the current task
watch(() => store.taskAssignees, (val) => { assignees.value = Array.isArray(val) ? [...val] : [] }, { immediate: true })

const sortedAssignees = computed(() =>
  [...assignees.value].sort((a, b) => {
    if (a.role === 'primary') return -1
    if (b.role === 'primary') return 1
    return 0
  })
)

// ── Dependencies (task_links) ─────────────────────────────────────────────────

const blocksLinks = computed<TaskLink[]>(() => {
  if (!task.value) return []
  const id = task.value.id
  return store.taskLinks.filter(l =>
    (l.type === 'bloque' && l.from_task === id) ||
    (l.type === 'depend_de' && l.to_task === id)
  )
})

const blockedByLinks = computed<TaskLink[]>(() => {
  if (!task.value) return []
  const id = task.value.id
  return store.taskLinks.filter(l =>
    (l.type === 'bloque' && l.to_task === id) ||
    (l.type === 'depend_de' && l.from_task === id)
  )
})

const relatedLinks = computed<TaskLink[]>(() => {
  if (!task.value) return []
  const id = task.value.id
  return store.taskLinks.filter(l =>
    (l.type === 'lie_a' || l.type === 'duplique') &&
    (l.from_task === id || l.to_task === id)
  )
})

const hasLinks = computed(() =>
  blocksLinks.value.length > 0 || blockedByLinks.value.length > 0 || relatedLinks.value.length > 0
)

// ── Blocked status (T553) ─────────────────────────────────────────────────────
// A task is blocked if it is 'todo' and has unresolved blockers (not done/archived)
const unresolvedBlockers = computed(() => {
  if (!task.value || task.value.statut !== 'todo') return []
  return blockedByLinks.value.filter(link => {
    const blockerStatut = link.from_task === task.value!.id ? link.to_statut : link.from_statut
    return blockerStatut !== 'done' && blockerStatut !== 'archived'
  })
})

const isBlocked = computed(() => unresolvedBlockers.value.length > 0)

function linkedTaskTitle(link: TaskLink): string {
  if (!task.value) return ''
  return link.from_task === task.value.id ? link.to_titre : link.from_titre
}

function linkedTaskStatut(link: TaskLink): string {
  if (!task.value) return ''
  return link.from_task === task.value.id ? link.to_statut : link.from_statut
}

function linkedTaskId(link: TaskLink): number {
  if (!task.value) return 0
  return link.from_task === task.value.id ? link.to_task : link.from_task
}

function openLinkedTask(link: TaskLink): void {
  const targetId = linkedTaskId(link)
  const target = store.tasks.find(t => t.id === targetId)
  if (target) store.openTask(target)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') store.closeTask()
}

watch(task, (val) => {
  if (val) {
    document.removeEventListener('keydown', handleKeydown)
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
    assignees.value = []
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

            <!-- T553: Blocked indicator -->
            <div
              v-if="isBlocked"
              class="px-4 py-2 border-b border-amber-500/30 bg-amber-500/10 shrink-0"
            >
              <p class="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1">{{ t('taskDetail.blockedTitle') }}</p>
              <ul class="space-y-0.5">
                <li
                  v-for="link in unresolvedBlockers"
                  :key="link.id"
                  class="text-[10px] text-amber-300/80"
                >
                  #{{ link.from_task === task.id ? link.to_task : link.from_task }}
                  {{ link.from_task === task.id ? link.to_titre : link.from_titre }}
                </li>
              </ul>
            </div>

            <!-- Section Agents (créateur / assigné / valideur) -->
            <div class="px-4 py-3 border-b border-edge-subtle shrink-0">
              <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-2">{{ t('taskDetail.agents') }}</p>
              <div class="space-y-1.5">
                <div v-if="task.agent_createur_name" class="flex items-center gap-2">
                  <span class="text-[10px] text-content-faint w-14 shrink-0">{{ t('taskDetail.creator') }}</span>
                  <AgentBadge :name="task.agent_createur_name" />
                </div>
                <div v-if="task.agent_name" class="flex items-center gap-2">
                  <span class="text-[10px] text-content-faint w-14 shrink-0">{{ t('taskDetail.assigned') }}</span>
                  <AgentBadge :name="task.agent_name" />
                </div>
                <div v-if="valideurAgent" class="flex items-center gap-2">
                  <span class="text-[10px] text-content-faint w-14 shrink-0">{{ t('taskDetail.validator') }}</span>
                  <AgentBadge :name="valideurAgent.name" />
                </div>
              </div>
            </div>

            <!-- Section Dependencies -->
            <div v-if="hasLinks" class="px-4 py-3 border-b border-edge-subtle shrink-0">
              <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-2">{{ t('taskDetail.dependencies') }}</p>

              <!-- Bloque -->
              <div v-if="blocksLinks.length > 0" class="mb-2">
                <p class="text-[10px] text-content-faint mb-1">{{ t('taskDetail.blocks') }}</p>
                <div class="space-y-1">
                  <button
                    v-for="link in blocksLinks"
                    :key="link.id"
                    class="w-full flex items-center gap-1.5 text-left hover:bg-surface-secondary rounded px-1 py-0.5 transition-colors group"
                    @click="openLinkedTask(link)"
                  >
                    <span :class="['text-[9px] px-1.5 py-0.5 rounded-full border font-medium shrink-0', STATUS_COLORS[linkedTaskStatut(link)] ?? 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40']">
                      {{ statusLabel(linkedTaskStatut(link)) }}
                    </span>
                    <span class="text-xs text-content-secondary truncate group-hover:text-content-primary transition-colors">#{{ linkedTaskId(link) }} {{ linkedTaskTitle(link) }}</span>
                  </button>
                </div>
              </div>

              <!-- Bloqué par -->
              <div v-if="blockedByLinks.length > 0" class="mb-2">
                <p class="text-[10px] text-content-faint mb-1">{{ t('taskDetail.blockedBy') }}</p>
                <div class="space-y-1">
                  <button
                    v-for="link in blockedByLinks"
                    :key="link.id"
                    class="w-full flex items-center gap-1.5 text-left hover:bg-surface-secondary rounded px-1 py-0.5 transition-colors group"
                    @click="openLinkedTask(link)"
                  >
                    <span :class="['text-[9px] px-1.5 py-0.5 rounded-full border font-medium shrink-0', STATUS_COLORS[linkedTaskStatut(link)] ?? 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40']">
                      {{ statusLabel(linkedTaskStatut(link)) }}
                    </span>
                    <span class="text-xs text-content-secondary truncate group-hover:text-content-primary transition-colors">#{{ linkedTaskId(link) }} {{ linkedTaskTitle(link) }}</span>
                  </button>
                </div>
              </div>

              <!-- Lié à -->
              <div v-if="relatedLinks.length > 0">
                <p class="text-[10px] text-content-faint mb-1">{{ t('taskDetail.relatedTo') }}</p>
                <div class="space-y-1">
                  <button
                    v-for="link in relatedLinks"
                    :key="link.id"
                    class="w-full flex items-center gap-1.5 text-left hover:bg-surface-secondary rounded px-1 py-0.5 transition-colors group"
                    @click="openLinkedTask(link)"
                  >
                    <span :class="['text-[9px] px-1.5 py-0.5 rounded-full border font-medium shrink-0', STATUS_COLORS[linkedTaskStatut(link)] ?? 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40']">
                      {{ statusLabel(linkedTaskStatut(link)) }}
                    </span>
                    <span class="text-xs text-content-secondary truncate group-hover:text-content-primary transition-colors">#{{ linkedTaskId(link) }} {{ linkedTaskTitle(link) }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Section Assignés (read-only — T571) -->
            <div class="px-4 py-3 border-b border-edge-subtle shrink-0">
              <p class="text-[10px] font-semibold text-content-subtle uppercase tracking-wider mb-2">
                {{ t('taskDetail.assignees') }}
              </p>

              <!-- Assigned agents list — display only -->
              <div v-if="sortedAssignees.length > 0" class="space-y-1">
                <div v-for="a in sortedAssignees" :key="a.agent_id" class="flex items-center gap-1.5">
                  <div
                    class="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold border"
                    :style="{ color: agentFg(a.agent_name), backgroundColor: agentBg(a.agent_name), borderColor: agentBorder(a.agent_name) }"
                    :title="a.agent_name"
                  >{{ a.agent_name.slice(0, 2).toUpperCase() }}</div>
                  <span class="text-xs text-content-secondary truncate flex-1 min-w-0">{{ a.agent_name }}</span>
                  <span class="text-[10px] text-content-faint shrink-0">{{ a.role ?? '—' }}</span>
                </div>
              </div>
              <p v-else class="text-xs text-content-faint italic">
                {{ t('taskDetail.noAssignees') }}
              </p>
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
