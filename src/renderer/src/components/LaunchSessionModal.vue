<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: [] }>()

const tabsStore = useTabsStore()
const tasksStore = useTasksStore()

const wslUsers = ref<string[]>([])
const selectedUser = ref<string | null>(null)
const loading = ref(true)
const customPrompt = ref('')
const launching = ref(false)
const systemPrompt = ref<string | null>(null)
const systemPromptSuffix = ref<string | null>(null)
const thinkingMode = ref<'auto' | 'disabled' | 'budget_tokens'>('auto')

// Compute the full system prompt (system_prompt + system_prompt_suffix)
const fullSystemPrompt = computed(() => {
  const parts: string[] = []
  if (systemPrompt.value) parts.push(systemPrompt.value)
  if (systemPromptSuffix.value) parts.push(systemPromptSuffix.value)
  return parts.join('\n\n')
})

onMounted(async () => {
  wslUsers.value = await window.electronAPI.getWslUsers()
  if (wslUsers.value.length === 1) {
    selectedUser.value = wslUsers.value[0]
  }

  // Get the agent's system prompts and thinking mode from the DB
  if (tasksStore.dbPath) {
    const result = await window.electronAPI.getAgentSystemPrompt(tasksStore.dbPath, props.agent.id)
    if (result.success) {
      systemPrompt.value = result.systemPrompt
      systemPromptSuffix.value = result.systemPromptSuffix
      thinkingMode.value = (result.thinkingMode as 'auto' | 'disabled' | 'budget_tokens') ?? 'auto'
    }
  }

  loading.value = false
})

async function launch() {
  launching.value = true
  try {
    const finalPrompt = await window.electronAPI.buildAgentPrompt(props.agent.name, customPrompt.value)

    // If we have a full system prompt, pass it for direct injection
    // Otherwise, use the traditional autoSend approach
    if (fullSystemPrompt.value) {
      tabsStore.addTerminal(
        props.agent.name,
        selectedUser.value ?? undefined,
        finalPrompt,
        fullSystemPrompt.value,
        thinkingMode.value
      )
    } else {
      tabsStore.addTerminal(
        props.agent.name,
        selectedUser.value ?? undefined,
        finalPrompt,
        undefined,
        thinkingMode.value
      )
    }
    emit('close')
  } finally {
    launching.value = false
  }
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

          <!-- System Prompt (affiché) -->
          <div v-if="fullSystemPrompt">
            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">System Prompt (sera injecté)</p>
            <div class="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-400 max-h-32 overflow-y-auto">
              <pre class="whitespace-pre-wrap">{{ fullSystemPrompt }}</pre>
            </div>
          </div>

          <!-- Thinking mode -->
          <div>
            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Mode thinking</p>
            <div class="flex gap-2">
              <button
                class="flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
                :class="thinkingMode === 'auto'
                  ? 'border-violet-500/60 bg-violet-950/30 text-violet-300'
                  : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600'"
                @click="thinkingMode = 'auto'"
              >
                Auto
              </button>
              <button
                class="flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
                :class="thinkingMode === 'disabled'
                  ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
                  : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600'"
                @click="thinkingMode = 'disabled'"
              >
                Désactivé
              </button>
              <button
                class="relative flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all opacity-50 cursor-not-allowed border-zinc-700 bg-zinc-800/40 text-zinc-500"
                disabled
                title="Non disponible — flag CLI à venir"
              >
                Budget
                <span class="absolute -top-1.5 -right-1 text-[8px] font-bold uppercase tracking-wide bg-zinc-700 text-zinc-400 rounded px-1 py-0.5 leading-none">
                  soon
                </span>
              </button>
            </div>
            <p class="text-[10px] text-zinc-600 mt-1.5">
              Désactivé recommandé pour les agents devops, doc, test
            </p>
          </div>

          <!-- Prompt personnalisé -->
          <div>
            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Prompt de démarrage</p>
            <textarea
              v-model="customPrompt"
              rows="3"
              placeholder="Laisser vide pour le message de démarrage par défaut…"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 resize-none outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
            />
            <div class="flex items-center gap-1.5 mt-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 text-zinc-600 shrink-0">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
              </svg>
              <span class="text-[10px] text-zinc-600">Prompt système appliqué automatiquement</span>
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
            :disabled="loading || launching || (wslUsers.length > 0 && !selectedUser)"
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
