<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import type { Agent } from '@renderer/types'

const { t } = useI18n()
const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const store = useTasksStore()
const settingsStore = useSettingsStore()

const name = ref(props.agent.name)
const thinkingMode = ref<'auto' | 'disabled'>(
  props.agent.thinking_mode === 'disabled' ? 'disabled' : 'auto'
)
const permissionMode = ref<'default' | 'auto'>(
  props.agent.permission_mode === 'auto' ? 'auto' : 'default'
)
const allowedTools = ref(props.agent.allowed_tools ?? '')
const autoLaunch = ref(props.agent.auto_launch !== 0)
const worktreeEnabled = ref<number | null>(props.agent.worktree_enabled ?? null)
// String to allow empty value (empty → -1 = unlimited in DB)
const maxSessions = ref(props.agent.max_sessions === -1 ? '' : String(props.agent.max_sessions ?? 3))
const maxSessionsInvalid = computed(() => maxSessions.value !== '' && (!/^\d+$/.test(maxSessions.value) || parseInt(maxSessions.value) < 1))
const maxSessionsDbValue = computed(() => maxSessions.value === '' ? -1 : parseInt(maxSessions.value))
const saving = ref(false)
const deleting = ref(false)
const error = ref<string | null>(null)
const newPerimetreName = ref('')
const addingPerimetre = ref(false)
const perimètreError = ref<string | null>(null)

onMounted(async () => {
  if (store.dbPath) {
    const result = await window.electronAPI.getAgentSystemPrompt(store.dbPath, props.agent.id)
    if (result.success) {
      thinkingMode.value = result.thinkingMode === 'disabled' ? 'disabled' : 'auto'
      permissionMode.value = result.permissionMode === 'auto' ? 'auto' : 'default'
    }
  }
})

async function deleteAgent() {
  if (!store.dbPath) return
  const confirmed = window.confirm(t('agent.deleteAgentConfirm', { name: props.agent.name }))
  if (!confirmed) return
  deleting.value = true
  error.value = null
  try {
    const result = await window.electronAPI.deleteAgent(store.dbPath, props.agent.id)
    if (result.hasHistory) {
      error.value = t('agent.deleteAgentHistoryError')
      return
    }
    if (!result.success) {
      error.value = result.error ?? 'Erreur inconnue'
      return
    }
    await store.refresh()
    emit('saved')
    emit('close')
  } finally {
    deleting.value = false
  }
}

async function addPerimetre() {
  if (!store.dbPath || !newPerimetreName.value.trim()) return
  addingPerimetre.value = true
  perimètreError.value = null
  try {
    const result = await window.electronAPI.addPerimetre(store.dbPath, newPerimetreName.value.trim())
    if (!result.success) {
      perimètreError.value = result.error ?? 'Erreur inconnue'
      return
    }
    newPerimetreName.value = ''
    await store.refresh()
  } finally {
    addingPerimetre.value = false
  }
}

async function save() {
  if (!store.dbPath || !name.value.trim()) return
  saving.value = true
  error.value = null
  try {
    const result = await window.electronAPI.updateAgent(store.dbPath, props.agent.id, {
      name: name.value.trim(),
      thinkingMode: thinkingMode.value,
      allowedTools: allowedTools.value.trim() || null,
      autoLaunch: autoLaunch.value,
      permissionMode: permissionMode.value,
      maxSessions: maxSessionsDbValue.value,
      worktreeEnabled: worktreeEnabled.value === null ? null : worktreeEnabled.value === 1,
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
      <div class="w-[750px] bg-surface-primary border border-edge-default rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

        <!-- Header -->
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-edge-subtle"
          :style="{ borderLeftColor: agentFg(agent.name), borderLeftWidth: '3px' }"
        >
          <div>
            <p class="text-xs text-content-subtle uppercase tracking-wider font-semibold mb-0.5">{{ t('agent.editTitle') }}</p>
            <p class="text-base font-mono font-semibold" :style="{ color: agentFg(agent.name) }">
              {{ agent.name }}
            </p>
          </div>
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors text-sm"
            @click="emit('close')"
          >✕</button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          <!-- Nom -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('sidebar.name') }}</label>
            <input
              v-model="name"
              class="w-full bg-surface-secondary border border-edge-default rounded-lg px-3 py-2 text-sm font-mono text-content-primary outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
              placeholder="nom-de-l-agent"
              @keydown.enter="save"
              @keydown.esc="emit('close')"
            />
          </div>

          <!-- Thinking mode -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('launch.thinkingMode') }}</label>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  thinkingMode === 'auto'
                    ? 'border-violet-500/60 bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="thinkingMode = 'auto'"
              >{{ t('launch.auto') }}</button>
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  thinkingMode === 'disabled'
                    ? 'border-amber-500/60 bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="thinkingMode = 'disabled'"
              >{{ t('launch.disabled') }}</button>
            </div>
            <p class="text-[10px] text-content-faint mt-1.5">{{ t('launch.thinkingNote') }}</p>
          </div>

          <!-- Tâches autorisées (--allowedTools) -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">
              {{ t('agent.allowedTools') }}
              <span class="normal-case font-normal text-content-faint ml-1">(--allowedTools)</span>
            </label>
            <textarea
              v-model="allowedTools"
              rows="3"
              spellcheck="false"
              placeholder="Bash,Edit,Read,Write,Glob,Grep&#10;Laisser vide = tous les outils autorisés"
              class="w-full bg-surface-secondary border border-edge-default rounded-lg px-3 py-2 text-xs font-mono text-content-secondary placeholder-content-faint resize-none outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors leading-relaxed"
            />
            <p class="text-[10px] text-content-faint mt-1.5">{{ t('agent.allowedToolsNote') }}</p>
          </div>

          <!-- Auto-launch toggle -->
          <div class="flex items-center justify-between py-1">
            <div>
              <p class="text-xs font-semibold text-content-muted uppercase tracking-wider">{{ t('agent.autoLaunch') }}</p>
              <p class="text-[10px] text-content-faint mt-0.5">{{ t('agent.autoLaunchDesc') }}</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="autoLaunch"
              class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1 focus:ring-offset-surface-primary"
              :class="autoLaunch ? 'bg-violet-500' : 'bg-surface-secondary border-edge-default'"
              @click="autoLaunch = !autoLaunch"
            >
              <span
                class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200"
                :class="autoLaunch ? 'translate-x-4' : 'translate-x-0'"
              />
            </button>
          </div>

          <!-- Max sessions parallèles -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('agent.maxSessions') }}</label>
            <input
              v-model="maxSessions"
              type="text"
              inputmode="numeric"
              :placeholder="t('agent.maxSessionsUnlimited')"
              class="w-full bg-surface-secondary border border-edge-default rounded-lg px-3 py-2 text-sm font-mono text-content-primary outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
              :class="{ 'border-red-500 focus:ring-red-500 focus:border-red-500': maxSessionsInvalid }"
            />
            <p class="text-[10px] text-content-faint mt-1.5">{{ t('agent.maxSessionsNote') }}</p>
            <p v-if="maxSessionsInvalid" class="text-[10px] text-red-400 mt-1">{{ t('agent.maxSessionsError') }}</p>
          </div>

          <!-- Permission mode -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('agent.permissionMode') }}</label>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  permissionMode === 'default'
                    ? 'border-violet-500/60 bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="permissionMode = 'default'"
              >{{ t('agent.permissionModeDefault') }}</button>
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  permissionMode === 'auto'
                    ? 'border-red-500/60 bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="permissionMode = 'auto'"
              >{{ t('agent.permissionModeAuto') }}</button>
            </div>
            <p v-if="permissionMode === 'auto'" class="text-[10px] text-red-400 dark:text-red-400 mt-1.5 font-medium">⚠ {{ t('agent.permissionModeWarning') }}</p>
          </div>

          <!-- Worktree isolation (T1143) -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('agent.worktreeEnabled') }}</label>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  worktreeEnabled === null
                    ? 'border-violet-500/60 bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="worktreeEnabled = null"
              >
                {{ t('agent.worktreeInherit') }}
              </button>
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  worktreeEnabled === 1
                    ? 'border-emerald-500/60 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="worktreeEnabled = 1"
              >
                {{ t('agent.worktreeOn') }}
              </button>
              <button
                :class="[
                  'flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                  worktreeEnabled === 0
                    ? 'border-amber-500/60 bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                    : 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                ]"
                @click="worktreeEnabled = 0"
              >
                {{ t('agent.worktreeOff') }}
              </button>
            </div>
            <p v-if="worktreeEnabled === null" class="text-[10px] text-content-faint mt-1.5">
              {{ t('agent.worktreeCurrentGlobal', { status: settingsStore.worktreeDefault ? t('agent.worktreeOn') : t('agent.worktreeOff') }) }}
            </p>
            <p class="text-[10px] text-content-faint mt-1">{{ t('agent.worktreeNote') }}</p>
          </div>

          <!-- Périmètres -->
          <div>
            <label class="block text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('agent.perimeter') }}</label>
            <div v-if="store.perimetresData.length === 0" class="text-xs text-content-faint italic mb-2">{{ t('agent.noPerimetre') }}</div>
            <div v-else class="flex flex-wrap gap-1.5 mb-2">
              <span
                v-for="p in store.perimetresData"
                :key="p.id"
                class="px-2 py-0.5 rounded text-xs font-mono bg-surface-secondary border border-edge-default text-content-secondary"
              >{{ p.name }}</span>
            </div>
            <div class="flex gap-2">
              <input
                v-model="newPerimetreName"
                class="flex-1 bg-surface-secondary border border-edge-default rounded-lg px-3 py-1.5 text-xs font-mono text-content-primary outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                :placeholder="t('agent.newPerimetrePlaceholder')"
                @keydown.enter="addPerimetre"
                @keydown.esc="newPerimetreName = ''"
              />
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-edge-default bg-surface-secondary text-content-secondary hover:border-violet-500 hover:text-violet-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="addingPerimetre || !newPerimetreName.trim()"
                @click="addPerimetre"
              >{{ t('agent.newPerimetre') }}</button>
            </div>
            <div v-if="perimètreError" class="mt-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800/50 rounded-md">
              <p class="text-xs text-red-700 dark:text-red-400">{{ perimètreError }}</p>
            </div>
          </div>

          <!-- Erreur -->
          <div v-if="error" class="px-3 py-2 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800/50 rounded-md">
            <p class="text-xs text-red-700 dark:text-red-400">{{ error }}</p>
          </div>

        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between gap-2 px-5 py-4 border-t border-edge-subtle bg-surface-base/50">
          <button
            class="px-4 py-2 text-sm font-medium text-red-500 hover:text-red-400 hover:bg-red-950/20 border border-red-800/40 hover:border-red-700/60 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="deleting || saving"
            @click="deleteAgent"
          >{{ deleting ? t('agent.deleting') : t('agent.deleteAgent') }}</button>
          <div class="flex items-center gap-2">
            <button
              class="px-4 py-2 text-sm text-content-muted hover:text-content-secondary hover:bg-surface-secondary rounded-lg transition-colors"
              @click="emit('close')"
            >{{ t('common.cancel') }}</button>
            <button
              class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name), borderWidth: '1px' }"
              :disabled="saving || deleting || !name.trim() || maxSessionsInvalid"
              @click="save"
            >{{ saving ? t('common.saving') : t('common.save') }}</button>
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>
