<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const store = useTasksStore()

const name = ref(props.agent.name)
const thinkingMode = ref<'auto' | 'disabled'>(
  props.agent.thinking_mode === 'disabled' ? 'disabled' : 'auto'
)
const allowedTools = ref(props.agent.allowed_tools ?? '')
const saving = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  if (store.dbPath) {
    const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, props.agent.id)
    if (result.success) {
      thinkingMode.value = result.thinkingMode === 'disabled' ? 'disabled' : 'auto'
    }
  }
})

async function save() {
  if (!store.dbPath || !name.value.trim()) return
  saving.value = true
  error.value = null
  try {
    const result = await window.electronAPI.updateAgent(store.dbPath, props.agent.id, {
      name: name.value.trim(),
      thinkingMode: thinkingMode.value,
      allowedTools: allowedTools.value.trim() || null,
    })
    if (!result.success) {
      error.value = result.error ?? 'Erreur inconnue'
      return
    }
    await store.refresh()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="w-[420px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">

        <!-- Header -->
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-zinc-800"
          :style="{ borderLeftColor: agentFg(agent.name), borderLeftWidth: '3px' }"
        >
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-0.5">Éditer l'agent</p>
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

          <!-- Nom -->
          <div>
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Nom</label>
            <input
              v-model="name"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
              placeholder="nom-de-l-agent"
              @keydown.enter="save"
              @keydown.esc="emit('close')"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Mode thinking</label>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  thinkingMode === 'auto'
                    ? 'border-violet-500/60 bg-violet-950/30 text-violet-300'
                    : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600'
                ]"
                @click="thinkingMode = 'auto'"
              >Auto</button>
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  thinkingMode === 'disabled'
                    ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
                    : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600'
                ]"
                @click="thinkingMode = 'disabled'"
              >Désactivé</button>
            </div>
            <p class="text-[10px] text-zinc-600 mt-1.5">Désactivé recommandé pour les agents devops, doc, test</p>
          </div>

          <!-- Tâches autorisées (--allowedTools) -->
          <div>
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Outils autorisés
              <span class="normal-case font-normal text-zinc-600 ml-1">(--allowedTools)</span>
            </label>
            <textarea
              v-model="allowedTools"
              rows="3"
              placeholder="Bash,Edit,Read,Write,Glob,Grep&#10;Laisser vide = tous les outils autorisés"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 resize-none outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors leading-relaxed"
            />
            <p class="text-[10px] text-zinc-600 mt-1.5">Séparés par virgules — injectés comme <code class="bg-zinc-800 px-1 rounded">--allowedTools</code> au lancement</p>
          </div>

          <!-- Erreur -->
          <div v-if="error" class="px-3 py-2 bg-red-950/40 border border-red-800/50 rounded-md">
            <p class="text-xs text-red-400">{{ error }}</p>
          </div>

        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800 bg-zinc-950/50">
          <button
            class="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
            @click="emit('close')"
          >Annuler</button>
          <button
            class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name), borderWidth: '1px' }"
            :disabled="saving || !name.trim()"
            @click="save"
          >{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
        </div>

      </div>
    </div>
  </Teleport>
</template>
