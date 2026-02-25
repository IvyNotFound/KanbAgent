<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

const store = useTasksStore()

const SCOPED_TYPES = ['dev', 'test', 'ux']
const ALL_TYPES = ['dev', 'test', 'ux', 'review', 'review-master', 'arch', 'devops', 'doc']

const name = ref('')
const type = ref('dev')
const perimetre = ref('')
const thinkingMode = ref<'auto' | 'disabled'>('auto')
const systemPrompt = ref('')
const description = ref('')
const showPrompt = ref(false)
const loading = ref(false)
const nameError = ref('')

const isScoped = computed(() => SCOPED_TYPES.includes(type.value))

watch(type, () => {
  if (!isScoped.value) perimetre.value = ''
})

watch(name, () => { nameError.value = '' })

function defaultDescription(t: string): string {
  const map: Record<string, string> = {
    dev: 'Implémentation / nouvelles fonctionnalités',
    test: 'Tests & couverture',
    ux: 'Interface utilisateur & expérience',
    review: 'Audit local de périmètre',
    'review-master': 'Audit global, arbitrage inter-périmètres',
    arch: 'ADR, interfaces, décisions structurantes',
    devops: 'Commits, branches, CI/CD, releases',
    doc: 'README, CONTRIBUTING, JSDoc',
  }
  return map[t] ?? ''
}

watch(type, (t) => {
  if (!description.value || description.value === defaultDescription(ALL_TYPES.find(x => x !== t) ?? '')) {
    description.value = defaultDescription(t)
  }
}, { immediate: true })

async function submit() {
  if (!store.dbPath || !store.projectPath) return

  const trimmed = name.value.trim()
  if (!trimmed) { nameError.value = 'Le nom est requis'; return }
  if (!/^[a-z0-9-]+$/.test(trimmed)) { nameError.value = 'Lettres minuscules, chiffres et tirets uniquement'; return }

  loading.value = true
  try {
    const result = await window.electronAPI.createAgent(store.dbPath, store.projectPath, {
      name: trimmed,
      type: type.value,
      perimetre: isScoped.value && perimetre.value.trim() ? perimetre.value.trim() : null,
      thinkingMode: thinkingMode.value,
      systemPrompt: systemPrompt.value.trim() || null,
      description: description.value.trim() || defaultDescription(type.value),
    })

    if (!result.success) {
      if (result.error?.includes('existe déjà')) nameError.value = result.error
      else emit('toast', result.error ?? 'Erreur lors de la création', 'error')
      return
    }

    const msg = result.claudeMdUpdated
      ? `Agent "${trimmed}" créé et ajouté dans CLAUDE.md`
      : `Agent "${trimmed}" créé`
    emit('toast', msg, 'success')
    emit('created')
    emit('close')
  } finally {
    loading.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="emit('close')"
      @keydown="handleKeydown"
    >
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[440px] flex flex-col max-h-[85vh]">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h2 class="text-base font-semibold text-zinc-100">Nouvel agent</h2>
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Form -->
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          <!-- Nom -->
          <div>
            <label class="block text-xs text-zinc-400 mb-1">Nom <span class="text-red-400">*</span></label>
            <input
              v-model="name"
              type="text"
              autofocus
              placeholder="dev-back-api"
              :class="[
                'w-full bg-zinc-800 border rounded-md px-3 py-2 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500 transition-colors',
                nameError ? 'border-red-500' : 'border-zinc-700'
              ]"
            />
            <p v-if="nameError" class="text-xs text-red-400 mt-1">{{ nameError }}</p>
            <p v-else class="text-xs text-zinc-600 mt-1">Minuscules, chiffres et tirets</p>
          </div>

          <!-- Type -->
          <div>
            <label class="block text-xs text-zinc-400 mb-1">Type</label>
            <div class="grid grid-cols-4 gap-1">
              <button
                v-for="t in ALL_TYPES"
                :key="t"
                :class="[
                  'py-1.5 px-2 rounded text-xs font-mono transition-colors',
                  type === t ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                ]"
                @click="type = t"
              >{{ t }}</button>
            </div>
          </div>

          <!-- Périmètre (scoped only) -->
          <div v-if="isScoped">
            <label class="block text-xs text-zinc-400 mb-1">Périmètre</label>
            <input
              v-model="perimetre"
              type="text"
              placeholder="front-vuejs"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <!-- Description (pour CLAUDE.md) -->
          <div>
            <label class="block text-xs text-zinc-400 mb-1">Description <span class="text-zinc-600">(CLAUDE.md)</span></label>
            <input
              v-model="description"
              type="text"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="block text-xs text-zinc-400 mb-1">Thinking mode</label>
            <div class="flex gap-2">
              <button
                :class="['flex-1 py-1.5 text-xs rounded transition-colors', thinkingMode === 'auto' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700']"
                @click="thinkingMode = 'auto'"
              >Auto</button>
              <button
                :class="['flex-1 py-1.5 text-xs rounded transition-colors', thinkingMode === 'disabled' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700']"
                @click="thinkingMode = 'disabled'"
              >Désactivé</button>
            </div>
          </div>

          <!-- System prompt (optionnel, collapsible) -->
          <div>
            <button
              class="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              @click="showPrompt = !showPrompt"
            >
              <svg :class="['w-3 h-3 transition-transform', showPrompt ? 'rotate-90' : '']" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 3.5l5 4.5-5 4.5V3.5z"/>
              </svg>
              System prompt (optionnel)
            </button>
            <textarea
              v-if="showPrompt"
              v-model="systemPrompt"
              rows="4"
              placeholder="Instructions spécifiques à cet agent..."
              class="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-300 font-mono outline-none focus:ring-1 focus:ring-violet-500 resize-none"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-zinc-800 flex items-center justify-between shrink-0">
          <span class="text-xs text-zinc-600">Ctrl+Entrée pour créer</span>
          <div class="flex gap-2">
            <button
              class="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              @click="emit('close')"
            >Annuler</button>
            <button
              class="px-4 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
              :disabled="loading || !name.trim()"
              @click="submit"
            >
              {{ loading ? 'Création...' : 'Créer' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
