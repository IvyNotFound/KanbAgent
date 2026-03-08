<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore, parseDefaultCliInstance } from '@renderer/stores/settings'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import { useModalEscape } from '@renderer/composables/useModalEscape'
import { useLaunchSession } from '@renderer/composables/useLaunchSession'
import { CLI_CAPABILITIES, CLI_LABELS, CLI_BADGE, systemLabel as getSystemLabel } from '@renderer/utils/cliCapabilities'
import type { Agent } from '@renderer/types'
import type { CliType, CliInstance, CliCapabilities } from '@shared/cli-types'

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: [] }>()

useModalEscape(() => emit('close'))

const { t } = useI18n()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()
const { launchAgentTerminal } = useLaunchSession()

const selectedInstance = ref<CliInstance | null>(null)
const loading = ref(true)
const customPrompt = ref('')
const launching = ref(false)
const systemPrompt = ref<string | null>(null)
const systemPromptSuffix = ref<string | null>(null)
const thinkingMode = ref<'auto' | 'disabled'>('auto')
/** Claude Code conversation UUID from last session — used for --resume */
const lastConvId = ref<string | null>(null)
const useResume = ref(false)
/** Multi-instance mode: create an isolated git worktree before launching (ADR-006) */
const multiInstance = ref(true)
/** Tracks origin of multiInstance value for UI hint (T1143) */
const worktreeSource = ref<'global' | 'agent' | 'manual'>('global')
/** Error message if worktree creation fails */
const worktreeError = ref<string | null>(null)

const fullSystemPrompt = computed(() => {
  const parts: string[] = []
  if (systemPrompt.value) parts.push(systemPrompt.value)
  if (systemPromptSuffix.value) parts.push(systemPromptSuffix.value)
  return parts.join('\n\n')
})

/** CLI derived from selected instance, falling back to first enabled CLI */
const selectedCli = computed<CliType>(() =>
  selectedInstance.value?.cli ?? (settingsStore.enabledClis[0] as CliType) ?? 'claude'
)

/** Capabilities of the currently selected CLI — drives conditional sections (T1036) */
const caps = computed<CliCapabilities>(() => CLI_CAPABILITIES[selectedCli.value])

/** All instances across every enabled CLI — the unified list shown to the user */
const allAvailableInstances = computed(() =>
  settingsStore.allCliInstances.filter(i => settingsStore.enabledClis.includes(i.cli as CliType))
)

/** Platform-aware "no CLI detected" message */
const noInstanceText = computed(() => {
  const p = window.electronAPI.platform
  if (p === 'darwin') return t('launch.noInstanceMac')
  if (p === 'linux')  return t('launch.noInstanceLinux')
  return t('launch.noInstanceWin')
})

function systemLabel(inst: CliInstance): string {
  return getSystemLabel(inst.type, inst.distro)
}

onMounted(async () => {
  // Use warmup cache if available — only detect if empty (T1118)
  if (settingsStore.allCliInstances.length === 0) {
    await settingsStore.refreshCliDetection()
  }

  // Auto-select: prefer stored preference (cli:distro), fall back to default, then first (T1090)
  const instances = allAvailableInstances.value
  if (instances.length > 0) {
    const stored = settingsStore.defaultCliInstance
    const parsed = parseDefaultCliInstance(stored)
    selectedInstance.value =
      (stored
        ? instances.find(i =>
            i.distro === parsed.distro &&
            (parsed.cli === null || i.cli === parsed.cli)
          )
        : undefined)
      ?? instances.find(i => i.isDefault)
      ?? instances[0]
      ?? null
  }

  if (tasksStore.dbPath) {
    const [promptResult, sessionRows] = await Promise.all([
      window.electronAPI.getAgentSystemPrompt(tasksStore.dbPath, props.agent.id),
      window.electronAPI.queryDb(
        tasksStore.dbPath,
        `SELECT claude_conv_id FROM sessions
         WHERE agent_id = ? AND claude_conv_id IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [props.agent.id]
      ) as Promise<Array<{ claude_conv_id: string }>>
    ])
    if (promptResult.success) {
      systemPrompt.value = promptResult.systemPrompt
      systemPromptSuffix.value = promptResult.systemPromptSuffix
      thinkingMode.value = (promptResult.thinkingMode as 'auto' | 'disabled') ?? 'auto'
    }
    if (sessionRows.length > 0 && sessionRows[0].claude_conv_id) {
      lastConvId.value = sessionRows[0].claude_conv_id
      useResume.value = false
    }
  }

  // Cascade resolution: agent override > global default (T1143)
  const agentWorktree = props.agent.worktree_enabled
  if (agentWorktree !== null && agentWorktree !== undefined) {
    multiInstance.value = agentWorktree === 1
    worktreeSource.value = 'agent'
  } else {
    multiInstance.value = settingsStore.worktreeDefault
    worktreeSource.value = 'global'
  }

  loading.value = false
})

// Track manual override of worktree toggle (T1143)
watch(multiInstance, () => {
  if (!loading.value) worktreeSource.value = 'manual'
})

async function launch() {
  launching.value = true
  worktreeError.value = null
  try {
    // Multi-instance: create a git worktree before launching (ADR-006)
    let workDir: string | undefined
    if (multiInstance.value && tasksStore.projectPath) {
      const sessionNonce = Date.now().toString()
      const result = await window.electronAPI.worktreeCreate(
        tasksStore.projectPath,
        sessionNonce,
        props.agent.name
      )
      if (!result.success) {
        worktreeError.value = result.error ?? 'unknown error'
        return
      }
      workDir = result.workDir
    }

    const convId = caps.value.convResume && useResume.value && lastConvId.value ? lastConvId.value : undefined
    const activeThinking = caps.value.thinkingMode ? thinkingMode.value : undefined
    const activeSystemPrompt = caps.value.systemPrompt ? fullSystemPrompt.value : undefined

    await launchAgentTerminal(props.agent, undefined, {
      customPrompt: customPrompt.value,
      instance: selectedInstance.value,
      cli: selectedCli.value,
      convId,
      workDir,
      thinkingMode: activeThinking,
      systemPrompt: convId ? false : (activeSystemPrompt ?? ''),
      activate: true,
    })
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
      <div class="w-96 bg-surface-primary border border-edge-default rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <!-- Header -->
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-edge-subtle"
          :style="{ borderLeftColor: agentFg(agent.name), borderLeftWidth: '3px' }"
        >
          <div>
            <p class="text-xs text-content-subtle uppercase tracking-wider font-semibold mb-0.5">{{ t('launch.title') }}</p>
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
        <div class="px-5 py-4 space-y-4">

          <!-- Unified instance list: all CLIs × all environments (Windows, WSL distros, local) -->
          <div>
            <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.instance') }}</p>

            <div v-if="loading" class="text-sm text-content-subtle animate-pulse">{{ t('common.loading') }}</div>

            <div v-else-if="allAvailableInstances.length === 0" class="text-sm text-content-subtle italic">
              {{ noInstanceText }}
            </div>

            <div v-else class="space-y-1.5">
              <label
                v-for="inst in allAvailableInstances"
                :key="`${inst.cli}-${inst.distro}`"
                class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all"
                :class="selectedInstance?.cli === inst.cli && selectedInstance?.distro === inst.distro
                  ? ''
                  : 'border-edge-default hover:border-content-faint bg-surface-secondary/40'"
                :style="selectedInstance?.cli === inst.cli && selectedInstance?.distro === inst.distro
                  ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '15' }
                  : {}"
              >
                <input
                  v-model="selectedInstance"
                  type="radio"
                  :value="inst"
                  :style="{ accentColor: agentFg(agent.name) }"
                />
                <!-- CLI badge -->
                <span class="w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold bg-surface-tertiary text-content-muted shrink-0">
                  {{ CLI_BADGE[inst.cli] }}
                </span>
                <!-- System label + CLI name -->
                <span class="flex-1 text-sm font-mono text-content-secondary">
                  <span class="text-content-muted">{{ systemLabel(inst) }}</span>
                  <span class="mx-1 text-content-faint">—</span>
                  <span>{{ CLI_LABELS[inst.cli] }}</span>
                </span>
                <!-- Version -->
                <span class="text-[10px] text-content-subtle font-mono shrink-0">v{{ inst.version }}</span>
                <!-- Default badge (WSL only) -->
                <span
                  v-if="inst.isDefault && inst.type === 'wsl'"
                  class="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-content-muted shrink-0"
                >{{ t('launch.defaultBadge') }}</span>
              </label>
            </div>
          </div>

          <!-- Resume session — convResume CLIs only (Claude) (T1036) -->
          <Transition
            enter-active-class="transition-all duration-200 overflow-hidden"
            enter-from-class="opacity-0 max-h-0"
            enter-to-class="opacity-100 max-h-32"
            leave-active-class="transition-all duration-150 overflow-hidden"
            leave-from-class="opacity-100 max-h-32"
            leave-to-class="opacity-0 max-h-0"
          >
            <div v-if="caps.convResume && lastConvId">
              <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.prevSession') }}</p>
              <label class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all"
                :class="useResume ? '' : 'border-edge-default bg-surface-secondary/40 hover:border-content-faint'"
                :style="useResume ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '15' } : {}"
              >
                <input v-model="useResume" type="checkbox" :style="{ accentColor: agentFg(agent.name) }" />
                <span class="text-sm text-content-secondary">{{ t('launch.resume', { resume: '--resume' }) }}</span>
              </label>
              <p class="text-[10px] text-content-faint mt-1">{{ t('launch.resumeNote') }}</p>
            </div>
          </Transition>

          <!-- Thinking mode — thinkingMode CLIs only (Claude) (T1036) -->
          <Transition
            enter-active-class="transition-all duration-200 overflow-hidden"
            enter-from-class="opacity-0 max-h-0"
            enter-to-class="opacity-100 max-h-32"
            leave-active-class="transition-all duration-150 overflow-hidden"
            leave-from-class="opacity-100 max-h-32"
            leave-to-class="opacity-0 max-h-0"
          >
            <div v-if="caps.thinkingMode">
              <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.thinkingMode') }}</p>
              <div class="flex gap-2">
                <button
                  class="flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
                  :class="thinkingMode !== 'auto' ? 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint' : ''"
                  :style="thinkingMode === 'auto' ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name) } : {}"
                  @click="thinkingMode = 'auto'"
                >
                  {{ t('launch.auto') }}
                </button>
                <button
                  class="flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
                  :class="thinkingMode !== 'disabled' ? 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint' : ''"
                  :style="thinkingMode === 'disabled' ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name) } : {}"
                  @click="thinkingMode = 'disabled'"
                >
                  {{ t('launch.disabled') }}
                </button>
              </div>
              <p class="text-[10px] text-content-faint mt-1.5">
                {{ t('launch.thinkingNote') }}
              </p>
            </div>
          </Transition>

          <!-- Custom prompt -->
          <div>
            <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.startPrompt') }}</p>
            <textarea
              v-model="customPrompt"
              rows="3"
              spellcheck="true"
              :placeholder="t('launch.startPromptPlaceholder')"
              class="w-full bg-surface-secondary border border-edge-default rounded-lg px-3 py-2 text-xs font-mono text-content-secondary placeholder-content-faint resize-none outline-none focus:ring-1 transition-colors"
              :style="{ '--tw-ring-color': agentFg(agent.name) }"
            />
            <div class="flex items-center gap-1.5 mt-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 text-content-faint shrink-0">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
              </svg>
              <span class="text-[10px] text-content-faint">{{ t('launch.promptNote') }}</span>
            </div>
          </div>

          <!-- Multi-instance toggle (ADR-006) — worktree: true for all CLIs -->
          <div>
            <label class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all"
              :class="multiInstance ? '' : 'border-edge-default bg-surface-secondary/40 hover:border-content-faint'"
              :style="multiInstance ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '15' } : {}"
            >
              <input v-model="multiInstance" type="checkbox" :style="{ accentColor: agentFg(agent.name) }" />
              <span class="text-sm text-content-secondary">{{ t('launch.multiInstance') }}</span>
            </label>
            <p class="text-[10px] text-content-faint mt-1">{{ t('launch.multiInstanceNote') }}</p>
            <p class="text-[10px] text-content-faint mt-0.5 italic">
              {{ t('launch.worktreeSource', { source: worktreeSource === 'global' ? t('launch.worktreeSourceGlobal') : worktreeSource === 'agent' ? t('launch.worktreeSourceAgent') : t('launch.worktreeSourceManual') }) }}
            </p>
            <p v-if="worktreeError" class="text-[10px] text-red-400 mt-1">
              {{ t('launch.multiInstanceError', { error: worktreeError }) }}
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-4 border-t border-edge-subtle bg-surface-base/50 space-y-2">
          <p v-if="!loading && allAvailableInstances.length === 0" class="text-xs text-amber-500 text-right">
            {{ noInstanceText }}
          </p>
          <div class="flex items-center justify-between gap-2">
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-xs text-content-subtle hover:text-content-secondary hover:bg-surface-secondary rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="settingsStore.detectingClis"
              :title="t('launch.refreshDetection')"
              @click="settingsStore.refreshCliDetection(true)"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5" :class="settingsStore.detectingClis ? 'animate-spin' : ''">
                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
              {{ t('launch.refreshDetection') }}
            </button>
            <div class="flex items-center gap-2">
              <button
                class="px-4 py-2 text-sm text-content-muted hover:text-content-secondary hover:bg-surface-secondary rounded-lg transition-colors"
                @click="emit('close')"
              >
                {{ t('launch.cancel') }}
              </button>
              <button
                class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name), borderWidth: '1px' }"
                :disabled="loading || launching || allAvailableInstances.length === 0"
                @click="launch"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
                  <path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/>
                </svg>
                {{ launching ? t('launch.launching') : t('launch.launch') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
