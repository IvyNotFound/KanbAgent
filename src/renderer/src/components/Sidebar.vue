<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import LaunchSessionModal from './LaunchSessionModal.vue'
import type { Agent } from '@renderer/types'

const store = useTasksStore()
const tabsStore = useTabsStore()

const launchTarget = ref<Agent | null>(null)


function hasOpenTerminal(agentName: string): boolean {
  return tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === agentName)
}



function openLaunchModal(event: MouseEvent, agent: Agent) {
  event.stopPropagation()
  const existing = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agent.name)
  if (existing) {
    tabsStore.setActive(existing.id)
    return
  }
  launchTarget.value = agent
}

const lastRefreshStr = computed(() => {
  if (!store.lastRefresh) return '—'
  return store.lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})

const projectName = computed(() => {
  if (!store.projectPath) return null
  return store.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? store.projectPath
})

function isAgentSelected(id: number | string): boolean {
  return store.selectedAgentId !== null && Number(store.selectedAgentId) === Number(id)
}

function taskCountFor(perimetre: string): number {
  return store.tasks.filter(t => t.perimetre === perimetre).length
}

function isLockOld(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 30 * 60 * 1000
}
</script>

<template>
  <aside class="w-72 shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col overflow-hidden">
    <!-- DB selector -->
    <div class="px-4 py-3 border-b border-zinc-800">
      <button
        class="w-full text-left group transition-colors"
        @click="store.selectProject()"
        :title="store.projectPath ?? 'Sélectionner un projet'"
      >
        <div class="flex items-baseline gap-2">
          <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider shrink-0">Projet</span>
          <span
            :class="[
              'text-sm font-medium truncate transition-colors',
              store.projectPath ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-500 group-hover:text-zinc-300 italic'
            ]"
          >{{ projectName ?? 'Sélectionner…' }}</span>
        </div>
        <span
          v-if="store.dbPath"
          class="block text-xs text-zinc-500 group-hover:text-zinc-400 truncate mt-0.5 font-mono transition-colors"
          :title="store.dbPath"
        >{{ store.dbPath.split(/[\\/]/).slice(-2).join('/') }}</span>
      </button>
    </div>

    <!-- Error -->
    <div v-if="store.error" class="px-3 py-2 bg-red-950/40 border-b border-red-800/50">
      <p class="text-xs text-red-400 break-all">{{ store.error }}</p>
    </div>

    <!-- Stats -->
    <div class="px-4 py-3 border-b border-zinc-800">
      <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Stats</p>
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-zinc-800 rounded-lg px-3 py-2">
          <p class="text-base font-semibold text-amber-400 font-mono">{{ store.stats.a_faire }}</p>
          <p class="text-xs text-zinc-500">À faire</p>
        </div>
        <div class="bg-zinc-800 rounded-lg px-3 py-2">
          <p class="text-base font-semibold text-emerald-400 font-mono">{{ store.stats.en_cours }}</p>
          <p class="text-xs text-zinc-500">En cours</p>
        </div>
        <div class="bg-zinc-800 rounded-lg px-3 py-2">
          <p class="text-base font-semibold text-zinc-400 font-mono">{{ store.stats.terminé }}</p>
          <p class="text-xs text-zinc-500">Terminé</p>
        </div>
        <div class="bg-zinc-800 rounded-lg px-3 py-2">
          <p class="text-base font-semibold text-violet-400 font-mono">{{ store.stats.validé }}</p>
          <p class="text-xs text-zinc-500">Validé</p>
        </div>
      </div>
    </div>

    <!-- Périmètres -->
    <div class="px-4 py-3 border-b border-zinc-800">
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Périmètres</p>
        <button
          v-if="store.selectedPerimetre !== null"
          class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
          @click="store.selectedPerimetre = null"
        >reset</button>
      </div>
      <div class="flex flex-col gap-1">
        <button
          v-for="p in store.perimetres"
          :key="p"
          :class="[
            'flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer',
            store.selectedPerimetre === p ? 'ring-1 ring-zinc-600' : 'hover:bg-zinc-900'
          ]"
          :style="store.selectedPerimetre === p ? { backgroundColor: agentBg(p), borderColor: agentBorder(p) } : {}"
          @click="store.togglePerimetreFilter(p)"
        >
          <span
            class="text-sm font-mono truncate"
            :style="{ color: agentFg(p) }"
          >{{ p }}</span>
          <span
            class="text-xs font-mono ml-2 px-1.5 py-0.5 rounded shrink-0"
            :style="{ color: agentFg(p), backgroundColor: agentBg(p) }"
          >{{ taskCountFor(p) }}</span>
        </button>
        <div v-if="store.perimetres.length === 0" class="text-sm text-zinc-600">Aucun périmètre</div>
      </div>
    </div>

    <!-- Agents -->
    <div class="px-4 py-3 border-b border-zinc-800 flex-1 overflow-y-auto min-h-0">
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Agents</p>
        <button
          v-if="store.selectedAgentId !== null"
          class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
          @click="store.selectedAgentId = null"
        >reset</button>
      </div>
      <div class="space-y-0.5">
        <div
          v-for="agent in store.agents"
          :key="agent.id"
          class="group relative"
        >
          <button
            :class="[
              'w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors cursor-pointer pr-8',
              isAgentSelected(agent.id) ? 'bg-zinc-800 ring-1 ring-zinc-600' : 'hover:bg-zinc-900'
            ]"
            @click="store.toggleAgentFilter(agent.id)"
          >
            <span class="relative shrink-0 flex items-center justify-center w-4 h-4">
              <!-- En cours : spinner -->
              <svg
                v-if="tabsStore.isAgentActive(agent.name)"
                class="w-3.5 h-3.5 animate-spin"
                viewBox="0 0 16 16" fill="none"
                :style="{ color: agentFg(agent.name) }"
              >
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
                <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <!-- En attente : cercle creux pulsant -->
              <svg
                v-else-if="hasOpenTerminal(agent.name) && !tabsStore.isAgentActive(agent.name)"
                class="w-3.5 h-3.5 animate-pulse"
                viewBox="0 0 14 14" fill="none"
                :style="{ color: agentFg(agent.name) }"
              >
                <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="2"/>
                <circle cx="7" cy="7" r="2" fill="currentColor"/>
              </svg>
              <!-- Par défaut : rond statique -->
              <span
                v-else
                class="w-2.5 h-2.5 rounded-full"
                :style="{ backgroundColor: agentFg(agent.name) }"
              ></span>
            </span>
            <span
              :class="['text-sm truncate font-mono', isAgentSelected(agent.id) ? 'text-zinc-100' : 'text-zinc-400']"
            >{{ agent.name }}</span>

          </button>
          <!-- Launch button -->
          <button
            class="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-all text-xs hover:scale-110"
            :style="{ color: agentFg(agent.name), backgroundColor: agentBg(agent.name) }"
            :title="`Lancer une session ${agent.name}`"
            @click="openLaunchModal($event, agent)"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
              <path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/>
            </svg>
          </button>
        </div>
        <div v-if="store.agents.length === 0" class="text-sm text-zinc-600 px-2">Aucun agent</div>
      </div>
    </div>

    <!-- Locks actifs -->
    <div v-if="store.locks.length > 0" class="px-4 py-3 border-t border-zinc-800">
      <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Locks actifs</p>
      <div class="space-y-1">
        <div
          v-for="lock in store.locks"
          :key="lock.id"
          :class="['text-sm truncate font-mono', isLockOld(lock.created_at) ? 'text-red-400' : 'text-zinc-400']"
          :title="lock.fichier"
        >
          {{ lock.fichier.split('/').pop() }}
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="px-4 py-2 border-t border-zinc-800">
      <p class="text-xs text-zinc-600">MAJ {{ lastRefreshStr }}</p>
    </div>
  </aside>

  <!-- Launch session modal -->
  <LaunchSessionModal
    v-if="launchTarget"
    :agent="launchTarget"
    @close="launchTarget = null"
  />
</template>
