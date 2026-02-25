<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import { agentFg, agentBg, agentBorder, perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'

// Configure marked for synchronous rendering
marked.setOptions({ async: false })

const { t, locale } = useI18n()
const store = useTasksStore()
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
  done:        'bg-zinc-700/50 text-zinc-300 border-zinc-600/50',
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('taskDetail.justNow')
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}j`
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') store.closeTask()
}

watch(task, (val) => {
  if (val) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
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
      <div class="relative w-full max-w-6xl max-h-[90vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden mx-4 select-text">

        <!-- Header -->
        <div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-zinc-100 leading-snug mb-2">{{ task.titre }}</p>
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
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all text-sm"
            @click="store.closeTask()"
          >✕</button>
        </div>

        <!-- Body : 2 colonnes -->
        <div class="flex flex-1 min-h-0 divide-x divide-zinc-800">

          <!-- Colonne gauche : description + commentaire tâche -->
          <div class="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5">
            <!-- Description -->
            <div v-if="task.description">
              <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">{{ t('taskDetail.description') }}</p>
              <div class="md-content text-sm text-zinc-300 leading-relaxed" v-html="renderedDescription"></div>
            </div>

            <p v-if="!task.description" class="text-sm text-zinc-600 italic pt-2">
              {{ t('taskDetail.noDescription') }}
            </p>
          </div>

          <!-- Colonne droite : conversation agents -->
          <div class="w-72 shrink-0 flex flex-col min-h-0">
            <div class="px-4 py-3 border-b border-zinc-800 shrink-0">
              <p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                {{ t('taskDetail.comments') }}
                <span v-if="store.taskComments.length > 0" class="ml-1 text-zinc-600">({{ store.taskComments.length }})</span>
              </p>
            </div>

            <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              <!-- Messages conversation -->
              <div
                v-for="comment in store.taskComments"
                :key="comment.id"
                class="flex flex-col gap-1"
              >
                <!-- Auteur + temps -->
                <div class="flex items-center justify-between gap-2 px-1">
                  <span
                    class="text-[11px] font-semibold font-mono truncate"
                    :style="{ color: agentFg(comment.agent_name ?? 'unknown') }"
                  >{{ comment.agent_name ?? '?' }}</span>
                  <span class="text-[10px] text-zinc-600 shrink-0" :title="formatDateFull(comment.created_at)">
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
                  v-html="renderMarkdown(comment.contenu)"
                ></div>
              </div>

              <p v-if="store.taskComments.length === 0" class="text-xs text-zinc-600 italic text-center py-4">
                {{ t('taskDetail.noComments') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-between gap-4 shrink-0">
          <div class="flex items-center gap-5">
            <p class="text-xs text-zinc-400">
              <span class="text-zinc-500 mr-1">{{ t('taskDetail.created') }}</span>{{ formatDateFull(task.created_at) }}
            </p>
            <p class="text-xs text-zinc-400">
              <span class="text-zinc-500 mr-1">{{ t('taskDetail.updated') }}</span>{{ formatDateFull(task.updated_at) }}
            </p>
          </div>
          <span class="text-xs text-zinc-500 font-mono">#{{ task.id }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>
