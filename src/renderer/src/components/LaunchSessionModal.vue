<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore, parseDefaultCliInstance } from '@renderer/stores/settings'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import { useModalEscape } from '@renderer/composables/useModalEscape'
import { useLaunchSession, MAX_AGENT_SESSIONS } from '@renderer/composables/useLaunchSession'
import { useToast } from '@renderer/composables/useToast'
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
const toast = useToast()

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
  if (settingsStore.maxFileLinesEnabled) {
    parts.push(`Always produce and maintain files of maximum ${settingsStore.maxFileLinesCount} lines. Split files that exceed this limit into logical modules.`)
  }
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

    const result = await launchAgentTerminal(props.agent, undefined, {
      customPrompt: customPrompt.value,
      instance: selectedInstance.value,
      cli: selectedCli.value,
      convId,
      workDir,
      thinkingMode: activeThinking,
      systemPrompt: convId ? false : (activeSystemPrompt ?? ''),
      activate: true,
    })
    if (result === 'session-limit') {
      const max = props.agent.max_sessions ?? MAX_AGENT_SESSIONS
      toast.push(t('board.sessionLimitReached', { agent: props.agent.name, max }), 'warn')
      return
    }
    if (result === 'error') {
      toast.push(t('board.launchFailed', { agent: props.agent.name }), 'error')
      return
    }
    emit('close')
  } finally {
    launching.value = false
  }
}
</script>

<template>
  <v-dialog model-value max-width="384" scrollable @update:model-value="emit('close')">
    <div data-testid="launch-modal-backdrop" @click.self="emit('close')">
    <v-card class="d-flex flex-column overflow-hidden">
        <!-- Header -->
        <div
          class="modal-header"
          :style="{ borderLeftColor: agentFg(agent.name), borderLeftWidth: '3px' }"
        >
          <div>
            <p class="section-label mb-1">{{ t('launch.title') }}</p>
            <p class="agent-title" :style="{ color: agentFg(agent.name) }">
              {{ agent.name }}
            </p>
          </div>
          <button class="btn-close" @click="emit('close')">✕</button>
        </div>

        <!-- Body -->
        <div class="modal-body">

          <!-- Unified instance list: all CLIs × all environments (Windows, WSL distros, local) -->
          <div>
            <p class="section-title mb-2">{{ t('launch.instance') }}</p>

            <div v-if="loading" class="text-body-2 loading-pulse">{{ t('common.loading') }}</div>

            <div v-else-if="allAvailableInstances.length === 0" class="text-body-2" style="color: var(--content-subtle); font-style: italic;">
              {{ noInstanceText }}
            </div>

            <div v-else class="d-flex flex-column ga-2">
              <label
                v-for="inst in allAvailableInstances"
                :key="`${inst.cli}-${inst.distro}`"
                class="instance-row"
                :class="selectedInstance?.cli === inst.cli && selectedInstance?.distro === inst.distro ? '' : 'instance-row--idle'"
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
                <span class="cli-badge">
                  {{ CLI_BADGE[inst.cli] }}
                </span>
                <!-- System label + CLI name -->
                <span class="instance-label">
                  <span style="color: var(--content-muted)">{{ systemLabel(inst) }}</span>
                  <span style="color: var(--content-faint); margin: 0 4px;">—</span>
                  <span>{{ CLI_LABELS[inst.cli] }}</span>
                </span>
                <!-- Version -->
                <span class="version-badge">v{{ inst.version }}</span>
                <!-- Default badge (WSL only) -->
                <span
                  v-if="inst.isDefault && inst.type === 'wsl'"
                  class="default-badge"
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
              <p class="section-title mb-2">{{ t('launch.prevSession') }}</p>
              <label
                class="instance-row"
                :class="useResume ? '' : 'instance-row--idle'"
                :style="useResume ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '15' } : {}"
              >
                <input v-model="useResume" type="checkbox" :style="{ accentColor: agentFg(agent.name) }" />
                <span class="text-body-2" style="color: var(--content-secondary)">{{ t('launch.resume', { resume: '--resume' }) }}</span>
              </label>
              <p class="field-hint">{{ t('launch.resumeNote') }}</p>
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
              <p class="section-title mb-2">{{ t('launch.thinkingMode') }}</p>
              <div class="d-flex ga-2">
                <button
                  class="toggle-btn"
                  :class="thinkingMode !== 'auto' ? 'toggle-btn--idle' : ''"
                  :style="thinkingMode === 'auto' ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name) } : {}"
                  @click="thinkingMode = 'auto'"
                >
                  {{ t('launch.auto') }}
                </button>
                <button
                  class="toggle-btn"
                  :class="thinkingMode !== 'disabled' ? 'toggle-btn--idle' : ''"
                  :style="thinkingMode === 'disabled' ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name) } : {}"
                  @click="thinkingMode = 'disabled'"
                >
                  {{ t('launch.disabled') }}
                </button>
              </div>
              <p class="field-hint">
                {{ t('launch.thinkingNote') }}
              </p>
            </div>
          </Transition>

          <!-- Custom prompt -->
          <div>
            <p class="section-title mb-2">{{ t('launch.startPrompt') }}</p>
            <textarea
              v-model="customPrompt"
              rows="3"
              spellcheck="true"
              :placeholder="t('launch.startPromptPlaceholder')"
              class="form-textarea"
              :style="{ '--focus-color': agentFg(agent.name) }"
            />
            <div class="d-flex align-center ga-2 mt-2">
              <svg viewBox="0 0 16 16" fill="currentColor" style="width: 12px; height: 12px; color: var(--content-faint); flex-shrink: 0;">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
              </svg>
              <span class="field-hint" style="margin-top: 0;">{{ t('launch.promptNote') }}</span>
            </div>
          </div>

          <!-- Multi-instance toggle (ADR-006) — worktree: true for all CLIs -->
          <div>
            <label
              class="instance-row"
              :class="multiInstance ? '' : 'instance-row--idle'"
              :style="multiInstance ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '15' } : {}"
            >
              <input v-model="multiInstance" type="checkbox" :style="{ accentColor: agentFg(agent.name) }" />
              <span class="text-body-2" style="color: var(--content-secondary)">{{ t('launch.multiInstance') }}</span>
            </label>
            <p class="field-hint">{{ t('launch.multiInstanceNote') }}</p>
            <p class="field-hint" style="font-style: italic;">
              {{ t('launch.worktreeSource', { source: worktreeSource === 'global' ? t('launch.worktreeSourceGlobal') : worktreeSource === 'agent' ? t('launch.worktreeSourceAgent') : t('launch.worktreeSourceManual') }) }}
            </p>
            <p v-if="worktreeError" class="field-hint field-hint--error">
              {{ t('launch.multiInstanceError', { error: worktreeError }) }}
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <p v-if="!loading && allAvailableInstances.length === 0" data-testid="no-instance-warning" class="no-instance-warning">
            {{ noInstanceText }}
          </p>
          <div class="d-flex align-center justify-space-between ga-2">
            <button
              class="btn-refresh"
              :disabled="settingsStore.detectingClis"
              :title="t('launch.refreshDetection')"
              @click="settingsStore.refreshCliDetection(true)"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" style="width: 14px; height: 14px;" :class="settingsStore.detectingClis ? 'spin' : ''">
                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
              {{ t('launch.refreshDetection') }}
            </button>
            <div class="d-flex align-center ga-2">
              <button class="btn-ghost" @click="emit('close')">
                {{ t('launch.cancel') }}
              </button>
              <button
                class="btn-launch"
                :style="{ backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name), borderColor: agentBorder(agent.name) }"
                :disabled="loading || launching || allAvailableInstances.length === 0"
                @click="launch"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" style="width: 14px; height: 14px;">
                  <path d="M3.5 2.635a.5.5 0 0 1 .752-.43l9 5.364a.5.5 0 0 1 0 .862l-9 5.365A.5.5 0 0 1 3.5 13.364V2.635z"/>
                </svg>
                {{ launching ? t('launch.launching') : t('launch.launch') }}
              </button>
            </div>
          </div>
        </div>
    </v-card>
    </div>
  </v-dialog>
</template>

<style scoped>
/* Card layout */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.modal-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--edge-subtle);
  background: var(--surface-base);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

/* Header typography */
.section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.agent-title {
  font-size: 16px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-weight: 600;
}
.section-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--content-secondary);
}
.field-hint {
  font-size: 10px;
  color: var(--content-faint);
  margin-top: 4px;
}
.field-hint--error {
  color: #f87171;
}

/* Close button */
.btn-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--content-subtle);
  cursor: pointer;
  font-size: 14px;
  transition: all 150ms;
}
.btn-close:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}

/* Instance rows (radio/checkbox) */
.instance-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 150ms;
}
.instance-row--idle {
  border-color: var(--edge-default);
  background: rgba(var(--v-theme-surface-variant, 39, 39, 42), 0.4);
}
.instance-row--idle:hover {
  border-color: var(--content-faint);
}
.cli-badge {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  background: var(--surface-tertiary);
  color: var(--content-muted);
  flex-shrink: 0;
}
.instance-label {
  flex: 1;
  font-size: 14px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-secondary);
}
.version-badge {
  font-size: 10px;
  color: var(--content-subtle);
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  flex-shrink: 0;
}
.default-badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--surface-tertiary);
  color: var(--content-muted);
  flex-shrink: 0;
}

/* Toggle buttons */
.toggle-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
}
.toggle-btn--idle {
  border-color: var(--edge-default);
  background: rgba(var(--v-theme-surface-variant, 39, 39, 42), 0.4);
  color: var(--content-muted);
}
.toggle-btn--idle:hover {
  border-color: var(--content-faint);
}

/* Textarea */
.form-textarea {
  width: 100%;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-secondary);
  outline: none;
  transition: border-color 150ms;
  resize: none;
  box-sizing: border-box;
}
.form-textarea::placeholder {
  color: var(--content-faint);
}
.form-textarea:focus {
  border-color: var(--focus-color, #8b5cf6);
  box-shadow: 0 0 0 1px var(--focus-color, #8b5cf6);
}

/* Loading pulse */
.loading-pulse {
  color: var(--content-subtle);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Spin animation for refresh icon */
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Footer buttons */
.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--content-subtle);
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-refresh:hover:not(:disabled) {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}
.btn-refresh:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-ghost {
  padding: 8px 16px;
  font-size: 14px;
  color: var(--content-muted);
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-ghost:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}
.btn-launch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border-style: solid;
  border-width: 1px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-launch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.no-instance-warning {
  font-size: 12px;
  color: #f59e0b;
  text-align: right;
}
</style>
