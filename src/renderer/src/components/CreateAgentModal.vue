<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Agent } from '@renderer/types'

const props = defineProps<{
  mode?: 'create' | 'edit'
  agent?: Agent
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created'): void
  (e: 'saved'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

const { t } = useI18n()
const isEditMode = computed(() => props.mode === 'edit' && props.agent != null)

const store = useTasksStore()

const SCOPED_TYPES = ['dev', 'test', 'ux']
const ALL_TYPES = ['dev', 'test', 'ux', 'review', 'review-master', 'arch', 'devops', 'doc']

const name = ref('')
const type = ref('dev')
const perimetre = ref('')
const thinkingMode = ref<'auto' | 'disabled'>('auto')
const systemPrompt = ref('')
const systemPromptSuffix = ref('')
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
  if (!isEditMode.value) {
    if (!description.value || description.value === defaultDescription(ALL_TYPES.find(x => x !== t) ?? '')) {
      description.value = defaultDescription(t)
    }
  }
}, { immediate: true })

onMounted(async () => {
  if (isEditMode.value && props.agent) {
    const a = props.agent
    name.value = a.name
    type.value = ALL_TYPES.includes(a.type) ? a.type : 'dev'
    perimetre.value = a.perimetre ?? ''
    thinkingMode.value = a.thinking_mode === 'disabled' ? 'disabled' : 'auto'
    // Load system_prompt and system_prompt_suffix from DB (may be more up-to-date than agent prop)
    if (store.dbPath) {
      const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, a.id)
      if (result.success) {
        systemPrompt.value = result.systemPrompt ?? ''
        systemPromptSuffix.value = result.systemPromptSuffix ?? ''
        thinkingMode.value = result.thinkingMode === 'disabled' ? 'disabled' : 'auto'
        if (systemPrompt.value || systemPromptSuffix.value) showPrompt.value = true
      }
    }
  }
})

async function submit() {
  if (!store.dbPath) return

  const trimmed = name.value.trim()
  if (!trimmed) { nameError.value = t('agent.nameRequired'); return }
  if (!/^[a-z0-9-]+$/.test(trimmed)) { nameError.value = t('agent.nameFormat'); return }

  loading.value = true
  try {
    // ── Edit mode ──────────────────────────────────────────────────────────
    if (isEditMode.value && props.agent) {
      const result = await window.electronAPI.updateAgent(store.dbPath, props.agent.id, {
        name: trimmed,
        type: type.value,
        perimetre: isScoped.value && perimetre.value.trim() ? perimetre.value.trim() : null,
        thinkingMode: thinkingMode.value,
        systemPrompt: systemPrompt.value.trim() || null,
        systemPromptSuffix: systemPromptSuffix.value.trim() || null,
      })
      if (!result.success) {
        emit('toast', result.error ?? 'Erreur lors de la sauvegarde', 'error')
        return
      }
      emit('toast', `Agent "${trimmed}" mis à jour`, 'success')
      emit('saved')
      emit('close')
      return
    }

    // ── Create mode ────────────────────────────────────────────────────────
    if (!store.projectPath) return
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
          <h2 class="text-base font-semibold text-zinc-100">{{ isEditMode ? t('agent.editTitle') : t('agent.newTitle') }}</h2>
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
            <label class="block text-xs text-zinc-400 mb-1">{{ t('sidebar.name') }} <span class="text-red-400">*</span></label>
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
            <p v-else class="text-xs text-zinc-600 mt-1">{{ t('agent.nameFormatShort') }}</p>
          </div>

          <!-- Type -->
          <div>
            <label class="block text-xs text-zinc-400 mb-1">{{ t('agent.type') }}</label>
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
            <label class="block text-xs text-zinc-400 mb-1">{{ t('agent.perimeter') }}</label>
            <input
              v-model="perimetre"
              type="text"
              placeholder="front-vuejs"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <!-- Description (pour CLAUDE.md) — create mode uniquement -->
          <div v-if="!isEditMode">
            <label class="block text-xs text-zinc-400 mb-1">{{ t('sidebar.description') }} <span class="text-zinc-600">(CLAUDE.md)</span></label>
            <input
              v-model="description"
              type="text"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="block text-xs text-zinc-400 mb-1">{{ t('launch.thinkingMode') }}</label>
            <div class="flex gap-2">
              <button
                :class="['flex-1 py-1.5 text-xs rounded transition-colors', thinkingMode === 'auto' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700']"
                @click="thinkingMode = 'auto'"
              >{{ t('launch.auto') }}</button>
              <button
                :class="['flex-1 py-1.5 text-xs rounded transition-colors', thinkingMode === 'disabled' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700']"
                @click="thinkingMode = 'disabled'"
              >{{ t('launch.disabled') }}</button>
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
              System prompt {{ isEditMode ? '' : t('agent.systemPromptOptional') }}
            </button>
            <div v-if="showPrompt" class="mt-2 flex flex-col gap-2">
              <textarea
                v-model="systemPrompt"
                rows="4"
                placeholder="Instructions spécifiques à cet agent..."
                class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-300 font-mono outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              />
              <div v-if="isEditMode">
                <label class="block text-xs text-zinc-500 mb-1">{{ t('agent.hiddenSuffix') }} <span class="text-zinc-600">({{ t('agent.hiddenSuffixCode') }})</span></label>
                <textarea
                  v-model="systemPromptSuffix"
                  rows="3"
                  placeholder="Suffixe injecté en fin de system prompt (protocole agent, etc.)..."
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-300 font-mono outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-zinc-800 flex items-center justify-between shrink-0">
          <span class="text-xs text-zinc-600">{{ isEditMode ? t('agent.saveShortcut') : t('agent.createShortcut') }}</span>
          <div class="flex gap-2">
            <button
              class="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              @click="emit('close')"
            >{{ t('common.cancel') }}</button>
            <button
              class="px-4 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
              :disabled="loading || !name.trim()"
              @click="submit"
            >
              {{ loading ? (isEditMode ? t('common.saving') : t('agent.creating')) : (isEditMode ? t('common.save') : t('agent.create')) }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
