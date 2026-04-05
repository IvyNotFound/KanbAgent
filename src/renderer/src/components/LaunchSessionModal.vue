<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore, parseDefaultCliInstance } from '@renderer/stores/settings'
import { agentBorder, agentAccent } from '@renderer/utils/agentColor'
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
  <v-dialog model-value max-width="560" scrollable @update:model-value="emit('close')">
    <div data-testid="launch-modal-backdrop" @click.self="emit('close')">
    <v-card elevation="3" class="overflow-hidden">
        <!-- Header -->
        <v-toolbar
          color="transparent"
          density="compact"
          :style="{ borderLeft: '3px solid ' + agentBorder(agent.name) }"
        >
          <v-toolbar-title class="pl-1">
            <p class="text-label-medium" style="color: var(--content-muted); letter-spacing: 0.02em; font-weight: 600; line-height: 1.2;">{{ t('launch.title') }}</p>
            <span class="agent-title" :style="{ color: agentAccent(agent.name) }">{{ agent.name }}</span>
          </v-toolbar-title>
          <v-spacer />
          <v-btn
            data-testid="btn-close"
            icon
            size="small"
            variant="text"
            @click="emit('close')"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>

        <v-divider />

        <!-- Loading bar -->
        <v-progress-linear v-if="loading" indeterminate color="primary" height="2" />

        <!-- Body -->
        <v-card-text class="d-flex flex-column ga-4 pa-5">

          <!-- Unified instance list: all CLIs × all environments (Windows, WSL distros, local) -->
          <div>
            <p class="section-title mb-2 text-body-2">{{ t('launch.instance') }}</p>

            <div v-if="loading" class="text-body-2 text-medium-emphasis">{{ t('common.loading') }}</div>

            <div v-else-if="allAvailableInstances.length === 0" class="text-body-2" style="color: var(--content-muted); font-style: italic;">
              {{ noInstanceText }}
            </div>

            <div v-else class="d-flex flex-column ga-2">
              <label
                v-for="inst in allAvailableInstances"
                :key="`${inst.cli}-${inst.distro}`"
                class="instance-row"
                :class="selectedInstance?.cli === inst.cli && selectedInstance?.distro === inst.distro ? '' : 'instance-row--idle'"
                :style="selectedInstance?.cli === inst.cli && selectedInstance?.distro === inst.distro
                  ? { borderColor: agentBorder(agent.name), backgroundColor: agentAccent(agent.name) + '15' }
                  : {}"
              >
                <input
                  v-model="selectedInstance"
                  type="radio"
                  :value="inst"
                  :style="{ accentColor: agentAccent(agent.name) }"
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
            enter-active-class="expand-enter-active"
            enter-from-class="expand-enter-from"
            enter-to-class="expand-enter-to"
            leave-active-class="expand-leave-active"
            leave-from-class="expand-leave-from"
            leave-to-class="expand-leave-to"
          >
            <div v-if="caps.convResume && lastConvId">
              <p class="section-title mb-2 text-body-2">{{ t('launch.prevSession') }}</p>
              <v-switch
                v-model="useResume"
                data-testid="switch-resume"
                density="compact"
                hide-details
                :color="agentAccent(agent.name)"
                :label="t('launch.resume', { resume: '--resume' })"
                class="launch-switch"
              />
              <p class="field-hint mt-1 text-caption">{{ t('launch.resumeNote') }}</p>
            </div>
          </Transition>

          <!-- Thinking mode — thinkingMode CLIs only (Claude) (T1036) -->
          <Transition
            enter-active-class="expand-enter-active"
            enter-from-class="expand-enter-from"
            enter-to-class="expand-enter-to"
            leave-active-class="expand-leave-active"
            leave-from-class="expand-leave-from"
            leave-to-class="expand-leave-to"
          >
            <div v-if="caps.thinkingMode">
              <p class="section-title mb-2 text-body-2">{{ t('launch.thinkingMode') }}</p>
              <v-btn-toggle
                v-model="thinkingMode"
                density="compact"
                rounded="lg"
                class="w-100"
              >
                <v-btn
                  value="auto"
                  size="small"
                  flex-grow-1
                  class="flex-1"
                  :style="thinkingMode === 'auto' ? { borderColor: agentBorder(agent.name), backgroundColor: agentAccent(agent.name) + '22', color: agentAccent(agent.name) } : {}"
                  @click="thinkingMode = 'auto'"
                >
                  {{ t('launch.auto') }}
                </v-btn>
                <v-btn
                  value="disabled"
                  size="small"
                  class="flex-1"
                  :style="thinkingMode === 'disabled' ? { borderColor: agentBorder(agent.name), backgroundColor: agentAccent(agent.name) + '22', color: agentAccent(agent.name) } : {}"
                  @click="thinkingMode = 'disabled'"
                >
                  {{ t('launch.disabled') }}
                </v-btn>
              </v-btn-toggle>
              <p class="field-hint mt-1 text-caption">
                {{ t('launch.thinkingNote') }}
              </p>
            </div>
          </Transition>

          <!-- Custom prompt -->
          <div>
            <v-textarea
              v-model="customPrompt"
              :label="t('launch.startPrompt')"
              :placeholder="t('launch.startPromptPlaceholder')"
              rows="3"
              auto-grow
              spellcheck="true"
              variant="outlined"
              density="compact"
              hide-details="auto"
              :base-color="agentAccent(agent.name)"
              :color="agentAccent(agent.name)"
              class="launch-textarea"
            />
            <div class="d-flex align-center ga-2 mt-2">
              <v-icon size="12" style="color: var(--content-faint); flex-shrink: 0;">mdi-information-outline</v-icon>
              <span class="field-hint text-caption" style="margin-top: 0;">{{ t('launch.promptNote') }}</span>
            </div>
          </div>

          <!-- Multi-instance toggle (ADR-006) — worktree: true for all CLIs -->
          <div>
            <v-switch
              v-model="multiInstance"
              data-testid="switch-worktree"
              density="compact"
              hide-details
              :color="agentAccent(agent.name)"
              :label="t('launch.multiInstance')"
              class="launch-switch"
            />
            <p class="field-hint mt-1 text-caption">{{ t('launch.multiInstanceNote') }}</p>
            <p class="field-hint text-caption" style="font-style: italic;">
              {{ t('launch.worktreeSource', { source: worktreeSource === 'global' ? t('launch.worktreeSourceGlobal') : worktreeSource === 'agent' ? t('launch.worktreeSourceAgent') : t('launch.worktreeSourceManual') }) }}
            </p>
            <p v-if="worktreeError" class="field-hint field-hint--error text-caption">
              {{ t('launch.multiInstanceError', { error: worktreeError }) }}
            </p>
          </div>
        </v-card-text>

        <v-divider />

        <!-- Footer -->
        <v-card-actions class="flex-column align-stretch pa-4 ga-2">
          <p v-if="!loading && allAvailableInstances.length === 0" data-testid="no-instance-warning" class="no-instance-warning text-caption text-right">
            {{ noInstanceText }}
          </p>
          <div class="d-flex align-center justify-space-between ga-2">
            <v-btn
              data-testid="btn-refresh"
              variant="text"
              :loading="settingsStore.detectingClis"
              prepend-icon="mdi-refresh"
              @click="settingsStore.refreshCliDetection(true)"
            >
              {{ t('launch.refreshDetection') }}
            </v-btn>
            <div class="d-flex align-center ga-2">
              <v-btn
                data-testid="btn-cancel"
                variant="text"
                size="default"
                style="min-width: 80px;"
                @click="emit('close')"
              >
                {{ t('launch.cancel') }}
              </v-btn>
              <v-btn
                data-testid="btn-launch"
                variant="tonal"
                :color="agentAccent(agent.name)"
                size="default"
                style="min-width: 80px;"
                :disabled="loading || launching || allAvailableInstances.length === 0"
                :loading="launching"
                @click="launch"
              >
                <v-icon size="14">mdi-play</v-icon>
                {{ t('launch.launch') }}
              </v-btn>
            </div>
          </div>
        </v-card-actions>
    </v-card>
    </div>
  </v-dialog>
</template>

<style scoped>
/* Header typography */
.agent-title {
  font-size: 16px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-weight: 600;
}
:deep(.v-toolbar-title.agent-title) {
  font-size: 16px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-weight: 600;
}

.section-title {
  font-weight: 500;
  color: var(--content-secondary);
}
.field-hint {
  /* content-muted (zinc-400) = 6.25:1 on surface-dialog (zinc-800) — WCAG AA compliant.
     content-faint (zinc-600) was only 2.07:1, well below the 4.5:1 minimum for 12px text. */
  color: var(--content-muted);
  margin-top: 4px;
}
.field-hint--error {
  color: rgb(var(--v-theme-error));
}

/* Instance rows (radio) */
.instance-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--shape-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
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

/* Switch label font size override */
.launch-switch :deep(.v-label) {
  font-size: 14px;
  color: var(--content-secondary);
}

/* Textarea font override for monospace feel */
.launch-textarea :deep(textarea) {
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
}

.no-instance-warning {
  color: rgb(var(--v-theme-warning));
  text-align: right;
}

/* Expand/collapse animation for conditional sections (replaces Tailwind Transition classes — T1389) */
.expand-enter-active {
  transition: all var(--md-duration-short4) var(--md-easing-standard);
  overflow: hidden;
}
.expand-enter-from {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to {
  opacity: 1;
  max-height: 8rem;
}
.expand-leave-active {
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  overflow: hidden;
}
.expand-leave-from {
  opacity: 1;
  max-height: 8rem;
}
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
