<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '@renderer/types'
import AgentBadge from './AgentBadge.vue'
import { useTasksStore } from '@renderer/stores/tasks'

const props = defineProps<{ task: Task }>()
const store = useTasksStore()

// Normaliser les retours à la ligne (gère le cas où \n est stocké comme texte)
const normalizedCommentaire = computed(() => {
  if (!props.task.commentaire) return ''
  return props.task.commentaire.replace(/\\n/g, '\n')
})

const PERIMETRE_COLORS: Record<string, string> = {
  'front-vuejs': 'bg-sky-500/15 text-sky-300',
  'back-electron': 'bg-violet-500/15 text-violet-300',
  'back-python': 'bg-amber-500/15 text-amber-300',
  'back-node': 'bg-emerald-500/15 text-emerald-300',
}

function perimetreColor(p: string | null): string {
  return p ? (PERIMETRE_COLORS[p] ?? 'bg-zinc-700 text-zinc-300') : 'bg-zinc-700 text-zinc-300'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const EFFORT_COLOR: Record<number, string> = {
  1: 'bg-emerald-500',
  2: 'bg-amber-500',
  3: 'bg-red-500',
}
</script>

<template>
  <div
    class="bg-zinc-800 border border-zinc-700 rounded-lg p-3 hover:border-zinc-600 transition-colors cursor-pointer"
    @click="store.openTask(task)"
  >
    <div class="flex items-start justify-between gap-2 mb-2">
      <p class="text-sm text-zinc-100 font-medium leading-snug flex-1 min-w-0">{{ task.titre }}</p>
      <span class="text-xs text-zinc-400 font-mono shrink-0">#{{ task.id }}</span>
      <span
        v-if="task.effort"
        :class="['w-2.5 h-2.5 rounded-full shrink-0 mt-0.5', EFFORT_COLOR[task.effort]]"
      />
    </div>

    <!-- Commentaire initial (tronqué à 3 lignes) -->
    <p
      v-if="normalizedCommentaire"
      class="text-xs text-zinc-400 leading-relaxed mb-2 line-clamp-3 whitespace-pre-wrap"
    >{{ normalizedCommentaire }}</p>

    <div class="flex flex-wrap gap-1 mb-2">
      <span
        v-if="task.perimetre"
        :class="['text-xs px-1.5 py-0.5 rounded font-mono', perimetreColor(task.perimetre)]"
      >{{ task.perimetre }}</span>
      <AgentBadge v-if="task.agent_name" :name="task.agent_name" :perimetre="task.agent_perimetre" />
    </div>

    <!-- Dates -->
    <div class="flex flex-col gap-0.5 mt-2 pt-2 border-t border-zinc-700/50">
      <p class="text-xs text-zinc-500">
        <span class="text-zinc-400">Créé</span> {{ formatDate(task.created_at) }}
      </p>
      <p class="text-xs text-zinc-500">
        <span class="text-zinc-400">Modifié</span> {{ formatDate(task.updated_at) }}
      </p>
    </div>
  </div>
</template>
