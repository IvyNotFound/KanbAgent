<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import { useModalEscape } from '@renderer/composables/useModalEscape'
import type { Agent } from '@renderer/types'
import type { CliType, CliInstance, CliCapabilities } from '@shared/cli-types'

// ── Static capabilities map (T1036 / R2) ─────────────────────────────────────
// T1012 will eventually expose this via IPC; until then, source-of-truth is here.
const CLI_CAPABILITIES: Record<CliType, CliCapabilities> = {
  claude:   { worktree: true, profileSelection: true,  systemPrompt: true,  thinkingMode: true,  convResume: true  },
  codex:    { worktree: true, profileSelection: false, systemPrompt: true,  thinkingMode: false, convResume: false },
  gemini:   { worktree: true, profileSelection: false, systemPrompt: false, thinkingMode: false, convResume: false },
  opencode: { worktree: true, profileSelection: false, systemPrompt: false, thinkingMode: false, convResume: false },
  aider:    { worktree: true, profileSelection: false, systemPrompt: true,  thinkingMode: false, convResume: false },
  goose:    { worktree: true, profileSelection: false, systemPrompt: true,  thinkingMode: false, convResume: false },
}

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: [] }>()

useModalEscape(() => emit('close'))

const { t } = useI18n()
const tabsStore = useTabsStore()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

const selectedCli = ref<CliType>('claude')
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
const multiInstance = ref(false)
/** Error message if worktree creation fails */
const worktreeError = ref<string | null>(null)

const fullSystemPrompt = computed(() => {
  const parts: string[] = []
  if (systemPrompt.value) parts.push(systemPrompt.value)
  if (systemPromptSuffix.value) parts.push(systemPromptSuffix.value)
  return parts.join('\n\n')
})

/** Capabilities of the currently selected CLI — drives conditional sections (T1036) */
const caps = computed<CliCapabilities>(() => CLI_CAPABILITIES[selectedCli.value])

/** Instances detected for the currently selected CLI */
const instancesForCli = computed(() =>
  settingsStore.allCliInstances.filter(i => i.cli === selectedCli.value)
)

/** Show CLI selector only when multiple CLIs are enabled */
const multiCli = computed(() => settingsStore.enabledClis.length > 1)

const CLI_LABELS: Record<CliType, string> = {
  claude:   'Claude Code',
  codex:    'Codex',
  gemini:   'Gemini',
  opencode: 'OpenCode',
  aider:    'Aider',
  goose:    'Goose',
}

const CLI_BADGE: Record<CliType, string> = {
  claude:   'C',
  codex:    'X',
  gemini:   'G',
  opencode: 'O',
  aider:    'A',
  goose:    'G',
}

// When CLI changes, pick first detected instance for that CLI
watch(selectedCli, () => {
  selectedInstance.value = instancesForCli.value[0] ?? null
})

function instanceLabel(inst: CliInstance): string {
  if (inst.type === 'local') return 'Local'
  return inst.distro
}

onMounted(async () => {
  // Refresh CLI detection (tags all instances with their CLI type)
  await settingsStore.refreshCliDetection()

  // Default CLI = first enabled one (usually 'claude')
  selectedCli.value = settingsStore.enabledClis[0] ?? 'claude'

  // Auto-select instance: prefer stored preference, fall back to isDefault/first
  const instances = instancesForCli.value
  if (instances.length > 0) {
    const stored = settingsStore.defaultCliInstance
    selectedInstance.value =
      (stored ? instances.find(i => i.distro === stored) : undefined)
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

  loading.value = false
})

async function launch() {
  launching.value = true
  worktreeError.value = null
  try {
    const finalPrompt = await window.electronAPI.buildAgentPrompt(
      props.agent.name,
      customPrompt.value,
      tasksStore.dbPath ?? undefined,
      props.agent.id
    )

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

    const distro = selectedInstance.value?.distro
    const convId = caps.value.convResume && useResume.value && lastConvId.value ? lastConvId.value : undefined
    const activeThinking = caps.value.thinkingMode ? thinkingMode.value : undefined
    const activeSystemPrompt = caps.value.systemPrompt ? fullSystemPrompt.value : undefined

    if (convId) {
      tabsStore.addTerminal(
        props.agent.name, distro, undefined, undefined,
        activeThinking, undefined,convId,
        true, undefined, 'stream', selectedCli.value, workDir
      )
    } else if (activeSystemPrompt) {
      tabsStore.addTerminal(
        props.agent.name, distro, finalPrompt, activeSystemPrompt,
        activeThinking, undefined,undefined,
        true, undefined, 'stream', selectedCli.value, workDir
      )
    } else {
      tabsStore.addTerminal(
        props.agent.name, distro, finalPrompt, undefined,
        activeThinking, undefined,undefined,
        true, undefined, 'stream', selectedCli.value, workDir
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

          <!-- CLI selector — only when multiple CLIs are enabled -->
          <div v-if="multiCli">
            <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.selectCli') }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="cli in settingsStore.enabledClis"
                :key="cli"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                :class="selectedCli !== cli
                  ? 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint'
                  : ''"
                :style="selectedCli === cli ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name) } : {}"
                :title="settingsStore.allCliInstances.filter(i => i.cli === cli).length === 0 ? t('launch.cliUnavailable') : undefined"
                @click="selectedCli = cli"
              >
                <span class="w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold bg-surface-tertiary text-content-muted shrink-0">
                  {{ CLI_BADGE[cli] }}
                </span>
                {{ CLI_LABELS[cli] }}
              </button>
            </div>
          </div>

          <!-- Instance selection — profileSelection CLIs only (Claude) (T1036) -->
          <Transition
            enter-active-class="transition-all duration-200 overflow-hidden"
            enter-from-class="opacity-0 max-h-0"
            enter-to-class="opacity-100 max-h-64"
            leave-active-class="transition-all duration-150 overflow-hidden"
            leave-from-class="opacity-100 max-h-64"
            leave-to-class="opacity-0 max-h-0"
          >
            <div v-if="caps.profileSelection || instancesForCli.length > 1">
              <p class="text-sm font-medium text-content-secondary mb-2">
                {{ multiCli ? CLI_LABELS[selectedCli] + ' — ' + t('launch.instance') : t('launch.claudeInstance') }}
              </p>

              <div v-if="loading" class="text-sm text-content-subtle animate-pulse">{{ t('common.loading') }}</div>

              <div v-else-if="instancesForCli.length === 0" class="text-sm text-content-subtle italic">
                {{ t('launch.noInstance') }}
              </div>

              <div v-else class="space-y-1.5">
                <label
                  v-for="inst in instancesForCli"
                  :key="inst.distro"
                  class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all"
                  :class="selectedInstance?.distro === inst.distro
                    ? ''
                    : 'border-edge-default hover:border-content-faint bg-surface-secondary/40'"
                  :style="selectedInstance?.distro === inst.distro ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '15' } : {}"
                >
                  <input
                    v-model="selectedInstance"
                    type="radio"
                    :value="inst"
                    :style="{ accentColor: agentFg(agent.name) }"
                  />
                  <span class="flex-1 text-sm font-mono text-content-secondary">{{ instanceLabel(inst) }}</span>
                  <span class="text-[10px] text-content-subtle font-mono shrink-0">{{ t('launch.instanceVersion', { version: inst.version }) }}</span>
                  <span
                    v-if="inst.isDefault"
                    class="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-content-muted shrink-0"
                  >{{ t('launch.defaultBadge') }}</span>
                </label>
              </div>
            </div>
          </Transition>

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
                  Auto
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
            <p v-if="worktreeError" class="text-[10px] text-red-400 mt-1">
              {{ t('launch.multiInstanceError', { error: worktreeError }) }}
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-edge-subtle bg-surface-base/50">
          <button
            class="px-4 py-2 text-sm text-content-muted hover:text-content-secondary hover:bg-surface-secondary rounded-lg transition-colors"
            @click="emit('close')"
          >
            {{ t('launch.cancel') }}
          </button>
          <button
            class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name), borderWidth: '1px' }"
            :disabled="loading || launching"
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
  </Teleport>
</template>
