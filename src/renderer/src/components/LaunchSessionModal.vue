<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: [] }>()

const tabsStore = useTabsStore()

const wslUsers = ref<string[]>([])
const selectedUser = ref<string | null>(null)
const loading = ref(true)

const autoSendMessage = computed(
  () => `Bonjour, lance toi en tant que l'agent ${props.agent.name} et initie ta session`
)

onMounted(async () => {
  wslUsers.value = await window.electronAPI.getWslUsers()
  if (wslUsers.value.length === 1) {
    selectedUser.value = wslUsers.value[0]
  }
  loading.value = false
})

function launch() {
  tabsStore.addTerminal(
    props.agent.name,
    selectedUser.value ?? undefined,
    autoSendMessage.value
  )
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <!-- Modal -->
      <div class="w-96 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <!-- Header -->
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-zinc-800"
          :style="{ borderLeftColor: agentFg(agent.name), borderLeftWidth: '3px' }"
        >
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-0.5">Lancer une session</p>
            <p class="text-base font-mono font-semibold" :style="{ color: agentFg(agent.name) }">
              {{ agent.name }}
            </p>
          </div>
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm"
            @click="emit('close')"
          >✕</button>
        </div>

        <!-- Body -->
        <div class="px-5 py-4 space-y-4">

          <!-- WSL user selection -->
          <div>
            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Utilisateur WSL</p>

            <div v-if="loading" class="text-sm text-zinc-500 animate-pulse">Chargement…</div>

            <div v-else-if="wslUsers.length === 0" class="text-sm text-zinc-500 italic">
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

          <!-- Prompt preview -->
          <div>
            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Prompt envoyé</p>
            <div
              class="px-3 py-2.5 rounded-lg text-xs font-mono text-zinc-300 leading-relaxed"
              :style="{ backgroundColor: agentBg(agent.name), borderColor: agentBorder(agent.name), borderWidth: '1px' }"
            >
              {{ autoSendMessage }}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800 bg-zinc-950/50">
          <button
            class="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
            @click="emit('close')"
          >
            Annuler
          </button>
          <button
            class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name), borderWidth: '1px' }"
            :disabled="loading || (wslUsers.length > 0 && !selectedUser)"
            @click="launch"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
              <path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/>
            </svg>
            Lancer
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
