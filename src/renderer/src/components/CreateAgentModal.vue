<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
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

const { t, te } = useI18n()
const isEditMode = computed(() => props.mode === 'edit' && props.agent != null)

const store = useTasksStore()
const settingsStore = useSettingsStore()

const SCOPED_TYPES = ['dev', 'test', 'ux']
const ALL_TYPES = ['dev', 'test', 'ux', 'review', 'review-master', 'arch', 'devops', 'doc', 'secu', 'perf', 'data']

const name = ref('')
const type = ref('dev')
const perimetre = ref('')
const thinkingMode = ref<'auto' | 'disabled'>('auto')
const systemPrompt = ref('')
const systemPromptSuffix = ref('')
const description = ref('')
const worktreeEnabled = ref<number | null>(props.agent?.worktree_enabled ?? null)
// String to allow empty value (empty → -1 = unlimited in DB)
const maxSessions = ref(props.agent?.max_sessions === -1 ? '' : String(props.agent?.max_sessions ?? 3))
const maxSessionsInvalid = computed(() => maxSessions.value !== '' && (!/^\d+$/.test(maxSessions.value) || parseInt(maxSessions.value) < 1))
const maxSessionsDbValue = computed(() => maxSessions.value === '' ? -1 : parseInt(maxSessions.value))
const showPrompt = ref(false)
const loading = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const nameError = ref('')

const isScoped = computed(() => SCOPED_TYPES.includes(type.value))

watch(type, () => {
  if (!isScoped.value) perimetre.value = ''
})

watch(name, () => { nameError.value = '' })

/**
 * Normalizes the agent name on each keystroke: lowercase + spaces→hyphens.
 * Enforces the kebab-case convention used throughout the project (e.g. dev-front-vuejs).
 * Uses :value + @input instead of v-model to apply normalization before Vue sets the ref.
 */
function onNameInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  name.value = raw.toLowerCase().replace(/ /g, '-')
}

function defaultDescription(agentType: string): string {
  const typeKey = agentType === 'review-master' ? 'reviewMaster' : agentType
  const key = `agent.typeDesc.${typeKey}`
  return te(key) ? t(key as never) : ''
}

watch(type, (newType) => {
  if (!isEditMode.value) {
    if (!description.value || description.value === defaultDescription(ALL_TYPES.find(x => x !== newType) ?? '')) {
      description.value = defaultDescription(newType)
    }
  }
}, { immediate: true })

onMounted(async () => {
  if (isEditMode.value && props.agent) {
    const a = props.agent
    name.value = a.name
    type.value = ALL_TYPES.includes(a.type) ? a.type : 'dev'
    perimetre.value = a.scope ?? ''
    thinkingMode.value = a.thinking_mode === 'disabled' ? 'disabled' : 'auto'
    maxSessions.value = a.max_sessions === -1 ? '' : String(a.max_sessions ?? 3)
    worktreeEnabled.value = a.worktree_enabled ?? null
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
      if (maxSessionsInvalid.value) return
      const result = await window.electronAPI.updateAgent(store.dbPath, props.agent.id, {
        name: trimmed,
        type: type.value,
        scope: isScoped.value && perimetre.value.trim() ? perimetre.value.trim() : null,
        thinkingMode: thinkingMode.value,
        systemPrompt: systemPrompt.value.trim() || null,
        systemPromptSuffix: systemPromptSuffix.value.trim() || null,
        maxSessions: maxSessionsDbValue.value,
        worktreeEnabled: worktreeEnabled.value === null ? null : worktreeEnabled.value === 1,
      })
      if (!result.success) {
        emit('toast', result.error ?? t('agent.saveError'), 'error')
        return
      }
      emit('toast', t('agent.updated', { name: trimmed }), 'success')
      emit('saved')
      emit('close')
      return
    }

    // ── Create mode ────────────────────────────────────────────────────────
    if (!store.projectPath) return
    const result = await window.electronAPI.createAgent(store.dbPath, store.projectPath, {
      name: trimmed,
      type: type.value,
      scope: isScoped.value && perimetre.value.trim() ? perimetre.value.trim() : null,
      thinkingMode: thinkingMode.value,
      systemPrompt: systemPrompt.value.trim() || null,
      description: description.value.trim() || defaultDescription(type.value),
    })

    if (!result.success) {
      if (result.error?.includes('existe déjà')) nameError.value = result.error
      else emit('toast', result.error ?? t('agent.createError'), 'error')
      return
    }

    const msg = result.claudeMdUpdated
      ? t('agent.createdWithClaude', { name: trimmed })
      : t('agent.created', { name: trimmed })
    emit('toast', msg, 'success')
    emit('created')
    emit('close')
  } finally {
    loading.value = false
  }
}

async function deleteAgent() {
  if (!store.dbPath || !props.agent) return
  const confirmed = window.confirm(t('agent.deleteAgentConfirm', { name: props.agent.name }))
  if (!confirmed) return
  deleting.value = true
  deleteError.value = null
  try {
    const result = await window.electronAPI.deleteAgent(store.dbPath, props.agent.id)
    if (result.hasHistory) {
      deleteError.value = t('agent.deleteAgentHistoryError')
      return
    }
    if (!result.success) {
      deleteError.value = result.error ?? t('common.unknownError')
      return
    }
    await store.refresh()
    emit('close')
  } finally {
    deleting.value = false
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
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl w-[750px] flex flex-col max-h-[85vh]">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-edge-subtle shrink-0">
          <h2 class="text-base font-semibold text-content-primary">{{ isEditMode ? t('agent.editTitle') : t('agent.newTitle') }}</h2>
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
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
            <label class="block text-xs text-content-muted mb-1">{{ t('sidebar.name') }} <span class="text-red-400">*</span></label>
            <input
              :value="name"
              :class="[
                'w-full bg-surface-secondary border rounded-md px-3 py-2 text-sm text-content-primary font-mono outline-none focus:ring-1 focus:ring-violet-500 transition-colors',
                nameError ? 'border-red-500' : 'border-edge-default'
              ]"
              type="text"
              autofocus
              placeholder="dev-back-api"
              @input="onNameInput"
            />
            <p v-if="nameError" class="text-xs text-red-400 mt-1">{{ nameError }}</p>
            <p v-else class="text-xs text-content-faint mt-1">{{ t('agent.nameFormatShort') }}</p>
          </div>

          <!-- Type -->
          <div>
            <label class="block text-xs text-content-muted mb-1">{{ t('agent.type') }}</label>
            <div class="grid grid-cols-4 gap-1">
              <button
                v-for="t in ALL_TYPES"
                :key="t"
                :class="[
                  'py-1.5 px-2 rounded text-xs font-mono transition-colors',
                  type === t ? 'bg-violet-600 text-white' : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="type = t"
              >{{ t }}</button>
            </div>
          </div>

          <!-- Périmètre (scoped only) -->
          <div v-if="isScoped">
            <label class="block text-xs text-content-muted mb-1">{{ t('agent.perimeter') }}</label>
            <input
              v-model="perimetre"
              list="perimetres-list"
              type="text"
              placeholder="front-vuejs"
              class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm text-content-primary font-mono outline-none focus:ring-1 focus:ring-violet-500"
            />
            <datalist id="perimetres-list">
              <option v-for="p in store.perimetresData" :key="p.id" :value="p.name" />
            </datalist>
          </div>

          <!-- Description (pour CLAUDE.md) — create mode uniquement -->
          <div v-if="!isEditMode">
            <label class="block text-xs text-content-muted mb-1">{{ t('sidebar.description') }} <span class="text-content-faint">(CLAUDE.md)</span></label>
            <input
              v-model="description"
              type="text"
              class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm text-content-tertiary outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="block text-xs text-content-muted mb-1">{{ t('launch.thinkingMode') }}</label>
            <div class="flex gap-2">
              <button
                :class="['flex-1 py-1.5 text-xs rounded transition-colors', thinkingMode === 'auto' ? 'bg-violet-600 text-white' : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary']"
                @click="thinkingMode = 'auto'"
              >{{ t('launch.auto') }}</button>
              <button
                :class="['flex-1 py-1.5 text-xs rounded transition-colors', thinkingMode === 'disabled' ? 'bg-violet-600 text-white' : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary']"
                @click="thinkingMode = 'disabled'"
              >{{ t('launch.disabled') }}</button>
            </div>
          </div>

          <!-- Sessions parallèles max (edit mode uniquement) -->
          <div v-if="isEditMode">
            <label class="block text-xs text-content-muted mb-1">{{ t('agent.maxSessions') }}</label>
            <input
              v-model="maxSessions"
              type="text"
              inputmode="numeric"
              :placeholder="t('agent.maxSessionsUnlimited')"
              class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm font-mono text-content-primary outline-none focus:ring-1 focus:ring-violet-500 transition-colors"
              :class="{ 'border-red-500 focus:ring-red-500': maxSessionsInvalid }"
            />
            <p class="text-xs text-content-faint mt-1">{{ t('agent.maxSessionsNote') }}</p>
            <p v-if="maxSessionsInvalid" class="text-xs text-red-400 mt-1">{{ t('agent.maxSessionsError') }}</p>
          </div>

          <!-- Worktree isolation (edit mode uniquement) -->
          <div v-if="isEditMode">
            <label class="block text-xs text-content-muted mb-1">{{ t('agent.worktreeEnabled') }}</label>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 py-1.5 text-xs rounded transition-colors border',
                  worktreeEnabled === null
                    ? 'border-violet-500/60 bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'border-edge-default bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="worktreeEnabled = null"
              >{{ t('agent.worktreeInherit') }}</button>
              <button
                :class="[
                  'flex-1 py-1.5 text-xs rounded transition-colors border',
                  worktreeEnabled === 1
                    ? 'border-emerald-500/60 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                    : 'border-edge-default bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="worktreeEnabled = 1"
              >{{ t('agent.worktreeOn') }}</button>
              <button
                :class="[
                  'flex-1 py-1.5 text-xs rounded transition-colors border',
                  worktreeEnabled === 0
                    ? 'border-amber-500/60 bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                    : 'border-edge-default bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="worktreeEnabled = 0"
              >{{ t('agent.worktreeOff') }}</button>
            </div>
            <p v-if="worktreeEnabled === null" class="text-xs text-content-faint mt-1">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="text-xs text-content-faint mt-1">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- System prompt (optionnel, collapsible) -->
          <div>
            <button
              class="flex items-center gap-1.5 text-xs text-content-subtle hover:text-content-tertiary transition-colors"
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
                rows="14"
                spellcheck="true"
                :placeholder="t('agent.systemPromptPlaceholder')"
                class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-xs text-content-tertiary font-mono outline-none focus:ring-1 focus:ring-violet-500 resize-y"
              />
              <div v-if="isEditMode">
                <label class="block text-xs text-content-subtle mb-1">{{ t('agent.hiddenSuffix') }} <span class="text-content-faint">({{ t('agent.hiddenSuffixCode') }})</span></label>
                <textarea
                  v-model="systemPromptSuffix"
                  rows="12"
                  spellcheck="true"
                  :placeholder="t('agent.systemPromptSuffixPlaceholder')"
                  class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-xs text-content-tertiary font-mono outline-none focus:ring-1 focus:ring-violet-500 resize-y"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-edge-subtle flex flex-col gap-2 shrink-0">
          <p v-if="deleteError" class="text-xs text-red-400">{{ deleteError }}</p>
          <div class="flex items-center justify-between">
            <!-- Left: destructive action isolated from primary actions -->
            <div>
              <button
                v-if="isEditMode"
                class="px-4 py-1.5 text-sm bg-red-700 hover:bg-red-600 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="deleting || loading"
                @click="deleteAgent"
              >{{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}</button>
            </div>
            <!-- Right: primary actions + shortcut hint near the submit button -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-content-faint">{{ isEditMode ? t('agent.saveShortcut') : t('agent.createShortcut') }}</span>
              <button
                class="px-4 py-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors"
                @click="emit('close')"
              >{{ t('common.cancel') }}</button>
              <button
                class="px-4 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="loading || !name.trim() || (isEditMode && maxSessionsInvalid)"
                @click="submit"
              >
                {{ loading ? (isEditMode ? t('common.saving') : t('agent.creating')) : (isEditMode ? t('common.save') : t('agent.create')) }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
