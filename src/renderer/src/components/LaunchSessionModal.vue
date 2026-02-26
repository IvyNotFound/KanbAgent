<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { agentFg, agentBorder } from '@renderer/utils/agentColor'
import type { Agent, ClaudeInstance } from '@renderer/types'

const props = defineProps<{ agent: Agent }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const tabsStore = useTabsStore()
const tasksStore = useTasksStore()

/** Detected Claude Code instances (one per WSL distro that has claude installed) */
const claudeInstances = ref<ClaudeInstance[]>([])
const selectedInstance = ref<ClaudeInstance | null>(null)
const loading = ref(true)
const customPrompt = ref('')
const launching = ref(false)
const systemPrompt = ref<string | null>(null)
const systemPromptSuffix = ref<string | null>(null)
const thinkingMode = ref<'auto' | 'disabled'>('auto')
/** Active claude-* wrapper profile within the selected instance */
const selectedProfile = ref<string>('claude')
/** Claude Code conversation UUID from last session — used for --resume (task #218) */
const lastConvId = ref<string | null>(null)
/** Whether to use --resume mode on next launch */
const useResume = ref(false)

// Compute the full system prompt (system_prompt + system_prompt_suffix)
const fullSystemPrompt = computed(() => {
  const parts: string[] = []
  if (systemPrompt.value) parts.push(systemPrompt.value)
  if (systemPromptSuffix.value) parts.push(systemPromptSuffix.value)
  return parts.join('\n\n')
})

// Profiles available in the selected instance (~/bin/claude* wrapper scripts)
const activeProfiles = computed(() => selectedInstance.value?.profiles ?? ['claude'])

// When the selected instance changes, reset the profile to the first available
watch(selectedInstance, (inst) => {
  selectedProfile.value = inst?.profiles[0] ?? 'claude'
})

onMounted(async () => {
  // Detect WSL distros with Claude Code installed
  const rawInstances = await window.electronAPI.getClaudeInstances()
  claudeInstances.value = rawInstances as ClaudeInstance[]

  // Auto-select: prefer default distro, then first available
  if (claudeInstances.value.length > 0) {
    selectedInstance.value =
      claudeInstances.value.find(i => i.isDefault) ?? claudeInstances.value[0]
  }

  // Get the agent's system prompts and thinking mode from the DB
  if (tasksStore.dbPath) {
    const [promptResult, sessionRows] = await Promise.all([
      window.electronAPI.getAgentSystemPrompt(tasksStore.dbPath, props.agent.id),
      // Check for a stored conversation UUID to offer --resume (task #218)
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
      // Default to resume mode if a previous conversation exists
      useResume.value = true
    }
  }

  loading.value = false
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

async function launch() {
  launching.value = true
  try {
    // Pass dbPath + agentId so the main process can inject pre-computed startup context (task #220)
    const finalPrompt = await window.electronAPI.buildAgentPrompt(
      props.agent.name,
      customPrompt.value,
      tasksStore.dbPath ?? undefined,
      props.agent.id
    )

    const distro = selectedInstance.value?.distro
    // Use selected profile only if it differs from the default 'claude'
    const cmdProfile = selectedProfile.value !== 'claude' ? selectedProfile.value : undefined
    const convId = useResume.value && lastConvId.value ? lastConvId.value : undefined

    if (convId) {
      // Resume mode: skip system prompt injection entirely
      tabsStore.addTerminal(
        props.agent.name,
        distro,
        undefined,
        undefined,
        thinkingMode.value,
        cmdProfile,
        convId
      )
    } else if (fullSystemPrompt.value) {
      tabsStore.addTerminal(
        props.agent.name,
        distro,
        finalPrompt,
        fullSystemPrompt.value,
        thinkingMode.value,
        cmdProfile
      )
    } else {
      tabsStore.addTerminal(
        props.agent.name,
        distro,
        finalPrompt,
        undefined,
        thinkingMode.value,
        cmdProfile
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
      @keydown="handleKeydown"
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

          <!-- Claude Code instance selection -->
          <div>
            <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.claudeInstance') }}</p>

            <div v-if="loading" class="text-sm text-content-subtle animate-pulse">{{ t('common.loading') }}</div>

            <div v-else-if="claudeInstances.length === 0" class="text-sm text-content-subtle italic">
              {{ t('launch.noInstance') }}
            </div>

            <div v-else class="space-y-1.5">
              <label
                v-for="inst in claudeInstances"
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
                <span class="flex-1 text-sm font-mono text-content-secondary">{{ inst.distro }}</span>
                <span class="text-[10px] text-content-subtle font-mono shrink-0">{{ t('launch.instanceVersion', { version: inst.version }) }}</span>
                <span
                  v-if="inst.isDefault"
                  class="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-content-muted shrink-0"
                >{{ t('launch.defaultBadge') }}</span>
              </label>
            </div>
          </div>

          <!-- Resume session (task #218): shown when a previous conv_id exists -->
          <div v-if="lastConvId">
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

          <!-- Thinking mode -->
          <div>
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

          <!-- Profil API Claude (sélecteur masqué si aucun profil alternatif disponible) -->
          <div v-if="activeProfiles.length > 1">
            <p class="text-sm font-medium text-content-secondary mb-2">{{ t('launch.apiProfile') }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="profile in activeProfiles"
                :key="profile"
                class="px-3 py-2 rounded-lg border text-xs font-medium transition-all"
                :class="selectedProfile !== profile ? 'border-edge-default bg-surface-secondary/40 text-content-muted hover:border-content-faint' : ''"
                :style="selectedProfile === profile ? { borderColor: agentBorder(agent.name), backgroundColor: agentFg(agent.name) + '22', color: agentFg(agent.name) } : {}"
                @click="selectedProfile = profile"
              >
                {{ profile }}
              </button>
            </div>
            <p class="text-[10px] text-content-faint mt-1.5">
              {{ t('launch.profileNote') }}
            </p>
          </div>

          <!-- Prompt personnalisé -->
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
