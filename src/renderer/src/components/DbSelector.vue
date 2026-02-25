<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'

const store = useTasksStore()
const tabsStore = useTabsStore()

const step = ref<'home' | 'create'>('home')
const wslUsers = ref<string[]>([])
const selectedUser = ref<string | null>(null)
const loadingUsers = ref(false)
const creating = ref(false)
const creatingError = ref<string | null>(null)

onMounted(async () => {
  loadingUsers.value = true
  wslUsers.value = await window.electronAPI.getWslUsers()
  if (wslUsers.value.length === 1) selectedUser.value = wslUsers.value[0]
  loadingUsers.value = false
})

async function create() {
  creating.value = true
  creatingError.value = null
  try {
    const path = await window.electronAPI.selectNewProjectDir()
    if (!path) { creating.value = false; return }

    const result = await window.electronAPI.initNewProject(path)
    if (!result.success) {
      creatingError.value = result.error ?? 'Erreur lors de l\'initialisation'
      creating.value = false
      return
    }

    store.setProjectPathOnly(path)
    tabsStore.addTerminal('setup', selectedUser.value ?? undefined, 'Initialisation d\'un nouveau projet passe en mode setup')
    store.watchForDb(path)
  } catch (e) {
    creatingError.value = String(e)
    creating.value = false
  }
}
</script>

<template>
  <!-- Accueil -->
  <div v-if="step === 'home'" class="h-full flex items-center justify-center">
    <div class="text-center space-y-6 max-w-sm px-6">
      <!-- Logo -->
      <div class="w-14 h-14 rounded-2xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center mx-auto">
        <svg viewBox="0 0 24 24" fill="none" class="w-7 h-7 text-violet-400">
          <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7l-9-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <h2 class="text-xl font-semibold text-zinc-100 mb-1">agent-viewer</h2>
        <p class="text-sm text-zinc-500">Visualisez les tâches de vos agents Claude en temps réel.</p>
      </div>

      <!-- 2 options -->
      <div class="grid grid-cols-2 gap-3">
        <!-- Ouvrir existant -->
        <button
          class="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-zinc-800/40 hover:bg-zinc-800 transition-all group"
          @click="store.selectProject()"
        >
          <div class="w-9 h-9 rounded-lg bg-zinc-700 group-hover:bg-zinc-600 flex items-center justify-center transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-zinc-300">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-200">Ouvrir</p>
            <p class="text-xs text-zinc-500 mt-0.5">Projet existant</p>
          </div>
        </button>

        <!-- Créer nouveau -->
        <button
          class="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-violet-500/30 hover:border-violet-500/60 bg-violet-500/5 hover:bg-violet-500/10 transition-all group"
          @click="step = 'create'"
        >
          <div class="w-9 h-9 rounded-lg bg-violet-500/20 group-hover:bg-violet-500/30 flex items-center justify-center transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-violet-400">
              <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-violet-300">Créer</p>
            <p class="text-xs text-zinc-500 mt-0.5">Nouveau projet</p>
          </div>
        </button>
      </div>

      <p v-if="store.error" class="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
        {{ store.error }}
      </p>
    </div>
  </div>

  <!-- Création de projet -->
  <div v-else class="h-full flex items-center justify-center">
    <div class="space-y-5 max-w-sm w-full px-6">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <button
          class="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          @click="step = 'home'"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
            <path fill-rule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H13a1 1 0 110 2H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
          Retour
        </button>
        <h2 class="text-base font-semibold text-zinc-100">Nouveau projet</h2>
      </div>

      <!-- Explication -->
      <div class="px-3 py-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-400 leading-relaxed space-y-1">
        <p>Le <code class="text-violet-300 bg-zinc-900 px-1 rounded">CLAUDE.md</code> maître sera téléchargé depuis le dépôt de référence et copié dans le dossier choisi.</p>
        <p>Un terminal <span class="text-violet-300 font-mono">setup</span> sera lancé automatiquement pour initialiser le projet.</p>
      </div>

      <!-- WSL user -->
      <div>
        <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Utilisateur WSL</p>

        <div v-if="loadingUsers" class="text-sm text-zinc-500 animate-pulse">Chargement…</div>

        <div v-else-if="wslUsers.length === 0" class="text-sm text-zinc-500 italic px-1">
          Aucun utilisateur détecté — shell WSL par défaut
        </div>

        <div v-else class="space-y-1.5">
          <label
            v-for="user in wslUsers"
            :key="user"
            class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all"
            :class="selectedUser === user
              ? 'border-violet-500/60 bg-violet-950/30'
              : 'border-zinc-700 hover:border-zinc-600 bg-zinc-800/40'"
          >
            <input
              type="radio"
              :value="user"
              v-model="selectedUser"
              class="accent-violet-500"
            />
            <span class="text-sm font-mono text-zinc-200">{{ user }}</span>
          </label>
        </div>
      </div>

      <!-- Bouton lancer -->
      <button
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
        :disabled="creating || loadingUsers || (wslUsers.length > 0 && !selectedUser)"
        @click="create"
      >
        <svg v-if="creating" class="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
          <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
        </svg>
        {{ creating ? 'Initialisation…' : 'Sélectionner le dossier et initialiser' }}
      </button>

      <p v-if="creatingError" class="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
        {{ creatingError }}
      </p>
    </div>
  </div>
</template>
