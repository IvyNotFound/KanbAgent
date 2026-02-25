<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import StatusColumn from './StatusColumn.vue'

const store = useTasksStore()

type BoardTab = 'backlog' | 'archive'
const activeTab = ref<BoardTab>('backlog')

const columns = [
  { key: 'a_faire' as const,  title: 'À faire',  accentClass: 'bg-amber-500' },
  { key: 'en_cours' as const, title: 'En cours', accentClass: 'bg-emerald-500' },
  { key: 'terminé' as const,  title: 'Terminé',  accentClass: 'bg-zinc-500' },
]

const activeAgentName = computed(() =>
  store.selectedAgentId !== null
    ? (store.agents.find(a => Number(a.id) === Number(store.selectedAgentId))?.name ?? null)
    : null
)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
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
          {{ tab === 'backlog' ? 'Backlog' : `Archive (${store.tasksByStatus.archivé.length})` }}
        </button>
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
          :tasks="store.tasksByStatus[col.key]"
          :accent-class="col.accentClass"
        />
      </div>
    </div>

    <!-- Archive view -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
      <div v-if="store.tasksByStatus.archivé.length === 0" class="flex items-center justify-center h-full">
        <p class="text-sm text-zinc-600 italic">Aucun ticket archivé</p>
      </div>
      <div v-else class="space-y-1.5">
        <button
          v-for="task in store.tasksByStatus.archivé"
          :key="task.id"
          class="w-full text-left px-4 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg transition-colors group"
          @click="store.openTask(task)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm text-zinc-300 group-hover:text-zinc-100 truncate transition-colors">{{ task.titre }}</p>
              <div class="flex items-center gap-2 mt-1">
                <span v-if="task.perimetre" class="text-[10px] font-mono text-zinc-600">{{ task.perimetre }}</span>
                <span v-if="task.agent_name" class="text-[10px] font-mono" :style="{ color: agentFg(task.agent_name) }">{{ task.agent_name }}</span>
              </div>
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
</template>
