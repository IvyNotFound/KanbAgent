<script setup lang="ts">
/**
 * StreamView — structured display of stream-json CLI messages (ADR-009 Option B).
 *
 * Chat-bubble layout: assistant messages rendered as left-aligned bubbles, user messages
 * as right-aligned bubbles. Tool calls delegated to StreamToolBlock for per-tool structured
 * display (Edit: diff view, Bash: command block, Read/Write/Grep/Glob: metadata, Agent: description).
 * Copy-code button injected into all markdown code blocks via useCopyCode composable.
 * Thinking text previewed live in the status bar (last 120 chars). Collapsible blocks
 * auto-collapse when >15 lines. ANSI sequences stripped before rendering.
 *
 * Used in App.vue for tabs with viewMode === 'stream' (T597).
 */
import { computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { useAgentsStore } from '@renderer/stores/agents'
import { agentFg, agentBg, agentBorder, agentAccent, colorVersion, getOnColor, isDark, hexToRgb } from '@renderer/utils/agentColor'
import { renderMarkdown } from '@renderer/utils/renderMarkdown'
import { useStreamEvents } from '@renderer/composables/useStreamEvents'
import { useCopyCode } from '@renderer/composables/useCopyCode'
import HookEventBar from './HookEventBar.vue'
import StreamToolBlock from './StreamToolBlock.vue'
import StreamInputBar from './StreamInputBar.vue'
import githubDarkUrl from 'highlight.js/styles/github-dark.css?url'
import githubUrl from 'highlight.js/styles/github.css?url'

// Re-export stream types so existing consumers keep their import paths (T816).
export type { StreamContentBlock, StreamEvent } from '@renderer/types/stream'
import type { StreamEvent, StreamContentBlock } from '@renderer/types/stream'

const props = defineProps<{
  /** Tab identifier — used to look up tab config in tabsStore. */
  terminalId: string
}>()

const tabsStore = useTabsStore()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()
const agentsStore = useAgentsStore()
const { t } = useI18n()

// Dynamic highlight.js theme — switches between github.css (light) and github-dark.css (T895)
function applyHljsTheme(theme: string): void {
  const id = 'hljs-theme'
  let link = document.getElementById(id) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href = theme === 'dark' ? githubDarkUrl : githubUrl
}
watch(() => settingsStore.theme, applyHljsTheme, { immediate: true })

const {
  events, collapsed, scrollContainer,
  assignEventId, enqueueEvent,
  scrollToBottom, toggleCollapsed, cleanup,
} = useStreamEvents(props.terminalId)
useCopyCode(scrollContainer)

// Scroll to bottom when this tab is activated (T1797)
watch(
  () => tabsStore.activeTabId,
  async (newId) => {
    if (newId === props.terminalId) {
      await nextTick()
      scrollToBottom(true)
    }
  }
)

import { ref } from 'vue'
const sessionId = ref<string | null>(null)
const ptyId = ref<string | null>(null)
const agentStopped = ref(false)
/** T1772: prefill answer from AskUserQuestion option chip click */
const prefillAnswer = ref<string | undefined>(undefined)

function handleSelectOption(label: string): void {
  prefillAnswer.value = label
}

// ── Computed ──────────────────────────────────────────────────────────────────

const isStreaming = computed(() => {
  if (events.value.length === 0) return false
  const last = events.value[events.value.length - 1]
  return last.type === 'assistant' || last.type === 'text'
})

const activeThinkingText = computed<string | null>(() => {
  if (!isStreaming.value) return null
  const tab = tabsStore.tabs.find(t => t.id === props.terminalId)
  if (!tab?.thinkingMode) return null
  const blocks = events.value[events.value.length - 1]?.message?.content ?? []
  const last = blocks[blocks.length - 1]
  return last?.type === 'thinking' && last.text ? last.text : null
})

/**
 * Detect a pending AskUserQuestion in the current event stream.
 *
 * Source 1 (T1707): last assistant event contains a tool_use AskUserQuestion block
 *   with no matching tool_result (correlates via tool_use_id, falls back to user-event check).
 * Source 2 (T1708): a synthetic ask_user event was emitted by stream-handlers and
 *   no user reply has arrived yet. Source 1 takes priority to avoid double-detection.
 */
const pendingQuestion = computed<string | null>(() => {
  // Source 1 — tool_use AskUserQuestion without tool_result (Claude, T1707)
  for (let i = events.value.length - 1; i >= 0; i--) {
    const ev = events.value[i]
    if (ev.type === 'user' || ev.type === 'result') break
    if (ev.type === 'assistant' && ev.message) {
      const askBlock = ev.message.content.find(
        (b) => b.type === 'tool_use' && b.name === 'AskUserQuestion'
      )
      if (askBlock) {
        const toolUseId = askBlock.tool_use_id
        const answered = toolUseId
          ? events.value.slice(i + 1).some(
              (e) => e.type === 'assistant' &&
                e.message?.content.some(
                  (b) => b.type === 'tool_result' && b.tool_use_id === toolUseId
                )
            )
          : events.value.slice(i + 1).some((e) => e.type === 'user')
        if (!answered) {
          const q = (askBlock.input as Record<string, unknown> | undefined)?.question
          // T1764: if input.question is not a string, do NOT return null here — fall through
          // to Source 2 (synthetic ask_user event) which may have the text.
          if (typeof q === 'string') return q
        }
        break
      }
    }
  }

  // Source 2 — synthetic ask_user event without user reply (T1708)
  for (let i = events.value.length - 1; i >= 0; i--) {
    const ev = events.value[i]
    if (ev.type === 'user') break
    if (ev.type === 'ask_user' && ev.text) return ev.text
  }

  return null
})

const agentName = computed(() => tabsStore.tabs.find(t => t.id === props.terminalId)?.agentName ?? '')

const accentFg = computed(() => { void colorVersion.value; return agentName.value ? agentFg(agentName.value) : 'rgb(var(--v-theme-secondary))' })
const accentBg = computed(() => { void colorVersion.value; return agentName.value ? agentBg(agentName.value) : 'rgba(var(--v-theme-secondary), 0.1)' })
const accentBorder = computed(() => { void colorVersion.value; return agentName.value ? agentBorder(agentName.value) : 'rgba(var(--v-theme-secondary), 0.3)' })
// Accent bar color: agentBg at 0.70 opacity — softer than the full-opaque agentFg, coherent with tab capsule design (T1769)
const accentBarColor = computed(() => {
  void colorVersion.value
  if (!agentName.value) return 'rgb(var(--v-theme-secondary))'
  const hex = agentBg(agentName.value)
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.70)` : hex
})
// MD3 on-color: dark text on light agent backgrounds, white on dark — ensures 4.5:1 contrast (T1500).
const userBubbleTextColor = computed(() => getOnColor(accentFg.value))
// On-color for text inside tool_use blocks (colored accentBg background) — T1544.
const accentOnColor = computed(() => {
  void colorVersion.value
  const bg = accentBg.value
  if (bg.startsWith('#')) return getOnColor(bg)
  return isDark() ? '#FFFFFF' : '#1C1B1F'
})
// Text/dot color for agent accent on neutral dark surface — agentAccent() (lighten2 dark / darken1 light)
// Use this instead of accentFg when agent color is displayed ON the surface, not on a badge bg (T1738)
const accentText = computed(() => {
  void colorVersion.value
  return agentName.value ? agentAccent(agentName.value) : 'rgb(var(--v-theme-secondary))'
})

// Suppresses empty user bubbles from autonomous Claude reasoning (T679).
// Also shows user events that contain image_ref blocks (T1718).
const displayEvents = computed(() =>
  events.value.filter(event => {
    if (event.type !== 'user') return true
    if (!event.message) return false
    const hasText = event.message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim().length > 0
    const hasImages = event.message.content.some(b => b.type === 'image_ref')
    return hasText || hasImages
  })
)

// Only show first system:init per session — subsequent inits (same session_id) are silent (T1458).
const visibleInitIds = computed(() => {
  const ids = new Set<number>()
  let lastSessionId: string | undefined
  for (const event of events.value) {
    if (event.type === 'system' && event.subtype === 'init') {
      if (event.session_id !== lastSessionId) {
        if (event._id != null) ids.add(event._id)
        lastSessionId = event.session_id ?? undefined
      }
    }
  }
  return ids
})

/**
 * Extract session/task context block from a launch prompt.
 * Returns { context, base } — context is null if no prefix detected.
 */
function parsePromptContext(text: string): { context: string | null; base: string } {
  const dashSep = '\n---\n'
  const dashIdx = text.indexOf(dashSep)
  if (dashIdx !== -1 && text.startsWith('=== IDENTIFIANTS ===')) {
    return { context: text.slice(0, dashIdx), base: text.slice(dashIdx + dashSep.length) }
  }
  const arrowIdx = text.indexOf(' -> ')
  if (arrowIdx !== -1) {
    const context = text.slice(0, arrowIdx)
    if (context.includes('Session préc.:') || context.includes('Tâches:')) {
      return { context, base: text.slice(arrowIdx + 4) }
    }
  }
  return { context: null, base: text }
}

const sessionContextMap = computed(() => {
  const map = new Map<number, string>()
  let lastInitId: number | null = null
  for (const event of displayEvents.value) {
    if (event.type === 'system' && event.subtype === 'init' && event._id != null) {
      lastInitId = event._id
    } else if (event.type === 'user' && event.message && lastInitId != null) {
      const text = event.message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
      const { context } = parsePromptContext(text)
      if (context) map.set(lastInitId, context)
      lastInitId = null
    }
  }
  return map
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

async function handleSend(text: string, atts: { path: string; objectUrl: string }[] = []): Promise<void> {
  agentStopped.value = false
  // Strip 📎 path lines for display — agent still receives the full text with paths (T1736)
  const displayText = text.replace(/(\n)?📎 [^\n]+/g, '').trim()
  const content: StreamContentBlock[] = [
    ...(displayText ? [{ type: 'text' as const, text: displayText }] : []),
    ...atts.map(a => ({ type: 'image_ref' as const, path: a.path, objectUrl: a.objectUrl })),
  ]
  const userEvent: StreamEvent = { type: 'user', message: { role: 'user', content } }
  assignEventId(userEvent)
  events.value.push(userEvent)
  scrollToBottom(true)
  try {
    if (ptyId.value) await window.electronAPI.agentSend(ptyId.value, text)
  } catch (err) {
    const errEvent: StreamEvent = { type: 'system', subtype: 'error', session_id: `Erreur agent: ${String(err)}` }
    assignEventId(errEvent)
    events.value.push(errEvent)
  }
}

function handleStop(): void {
  if (!ptyId.value || agentStopped.value) return
  agentStopped.value = true
  window.electronAPI.agentKill(ptyId.value)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let unsubStreamMessage: (() => void) | null = null
let unsubConvId: (() => void) | null = null
let unsubExit: (() => void) | null = null

onMounted(async () => {
  const tab = tabsStore.tabs.find(t => t.id === props.terminalId)
  if (!tab) return

  if (tab.convId && !tab.autoSend) sessionId.value = tab.convId

  try {
    const id = await window.electronAPI.agentCreate({
      projectPath: tasksStore.projectPath ?? undefined,
      workDir: tab.workDir ?? undefined,
      wslDistro: tab.wslDistro ?? undefined,
      systemPrompt: tab.systemPrompt ?? undefined,
      thinkingMode: tab.thinkingMode ?? undefined,
      claudeCommand: tab.claudeCommand ?? undefined,
      convId: tab.convId ?? undefined,
      cli: tab.cli ?? undefined,
      modelId: tab.modelId ?? undefined,
      // For CLIs that use positional args (e.g. opencode), pass the initial message at spawn time.
      initialMessage: tab.autoSend ?? undefined,
    })
    ptyId.value = id
    tabsStore.setPtyId(props.terminalId, id)
    tabsStore.setStreamId(props.terminalId, id)

    unsubStreamMessage = window.electronAPI.onAgentStream(id, (raw: Record<string, unknown>) => {
      enqueueEvent(raw)
    })
    unsubConvId = window.electronAPI.onAgentConvId(id, (convId: string) => { sessionId.value = convId })
    unsubExit = window.electronAPI.onAgentExit(id, (_exitCode: number | null) => {
      if (isStreaming.value) { const e: StreamEvent = { type: 'result' }; assignEventId(e); events.value.push(e) }
      // Auto-close all agent tabs on process exit (T1820)
      const t = tabsStore.tabs.find(tb => tb.id === props.terminalId)
      if (t) {
        const agent = agentsStore.agents.find(a => a.name === t.agentName)
        const isTaskCreator = t.agentName === 'task-creator' || agent?.type === 'task-creator'
        if (!isTaskCreator) {
          setTimeout(() => tabsStore.closeTab(props.terminalId), 3000)
        }
      }
    })

    if (tab.autoSend) {
      const autoEvent: StreamEvent = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: tab.autoSend }] } }
      assignEventId(autoEvent)
      events.value.push(autoEvent)
      scrollToBottom(true)
      // opencode/gemini: initial message was passed as positional arg via agentCreate(initialMessage) —
      // skip agentSend to avoid writing to stdin of a one-shot process.
      if (tab.cli !== 'opencode' && tab.cli !== 'gemini') {
        await window.electronAPI.agentSend(id, tab.autoSend)
      }
    }
  } catch (err) {
    const e: StreamEvent = { type: 'system', subtype: 'init', session_id: `Erreur agent: ${String(err)}` }
    assignEventId(e)
    events.value.push(e)
  }

  await nextTick()
  scrollContainer.value?.addEventListener('click', handleLinkClick, true)
})

// Redirect markdown link clicks to system browser (T753).
function handleLinkClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest('a')
  if (!target) return
  const href = target.getAttribute('href')
  if (!href || !/^https?:\/\//i.test(href)) return
  e.preventDefault(); e.stopPropagation()
  window.electronAPI.openExternal(href)
}

onUnmounted(() => {
  unsubStreamMessage?.(); unsubConvId?.(); unsubExit?.()
  scrollContainer.value?.removeEventListener('click', handleLinkClick, true)
  tabsStore.setStreamId(props.terminalId, null)
  if (ptyId.value && !agentStopped.value) window.electronAPI.agentKill(ptyId.value)
  cleanup()
})
</script>

<template>
  <div class="stream-view">
    <!-- Agent color accent header bar (T680) -->
    <div v-if="agentName" class="stream-accent-bar" :style="{ background: accentBarColor }" />

    <!-- Messages scroll area -->
    <div ref="scrollContainer" class="stream-scroll pa-4 ga-3" :style="{ '--stream-accent-fg': accentText }">
      <div
        v-if="displayEvents.length === 0 && !isStreaming"
        class="stream-empty text-caption"
        data-testid="empty-state"
      >
        {{ t('stream.waitingMessages') }}
      </div>

      <template v-for="event in displayEvents" :key="event._id">
        <!-- system:init — only first per session_id (T1458) -->
        <div
          v-if="event.type === 'system' && event.subtype === 'init' && visibleInitIds.has(event._id!)"
          class="block-system-init"
          data-testid="block-system-init"
        >
          <div class="d-flex align-center ga-2">
            <v-divider />
            <span class="text-caption text-medium-emphasis text-no-wrap">
              {{ t('stream.sessionStarted') }}<span v-if="event.session_id"> · {{ event.session_id.slice(0, 8) }}…</span>
            </span>
            <v-divider />
            <v-btn
              v-if="sessionContextMap.get(event._id!)"
              variant="text"
              size="x-small"
              density="compact"
              class="init-ctx-btn"
              @click="toggleCollapsed(`init-ctx-${event._id}`, true)"
            >{{ (collapsed[`init-ctx-${event._id}`] ?? true) ? '▶ ' + t('stream.ctx') : '▼ ' + t('stream.ctx') }}</v-btn>
          </div>
          <div
            v-if="sessionContextMap.get(event._id!)"
            v-show="!(collapsed[`init-ctx-${event._id}`] ?? true)"
            class="init-ctx-body mt-1 ml-4"
          >{{ sessionContextMap.get(event._id!) }}</div>
        </div>

        <!-- error:spawn / error:exit -->
        <div
          v-if="event.type === 'error:spawn' || event.type === 'error:exit'"
          class="block-error ga-2 py-3 px-4"
          data-testid="block-error"
        >
          <span class="error-icon">⚠</span>
          <div class="error-body">
            <span class="error-type">{{ event.type }}</span>
            <span class="error-text ml-2">{{ event.error }}</span>
            <pre v-if="event.stderr" class="error-stderr mt-2 text-caption">{{ event.stderr }}</pre>
          </div>
        </div>

        <!-- user bubble — right-aligned (T603) -->
        <div
          v-if="event.type === 'user' && event.message"
          class="block-user"
          data-testid="block-user"
        >
          <div
            class="user-bubble stream-markdown-user py-3 px-4 text-body-2"
            :style="{ background: accentFg, color: userBubbleTextColor }"
          >
            <template v-for="(block, bIdx) in event.message.content" :key="bIdx">
              <div v-if="block.type === 'text'" v-html="renderMarkdown(parsePromptContext(block.text ?? '').base)" />
              <img
                v-else-if="block.type === 'image_ref' && block.objectUrl"
                :src="block.objectUrl"
                class="user-bubble-img"
                data-testid="user-thumbnail"
                alt=""
              />
            </template>
          </div>
        </div>

        <!-- assistant blocks -->
        <template v-if="event.type === 'assistant' && event.message">
          <div class="block-assistant">
            <template v-for="(block, bIdx) in event.message.content" :key="`${event._id}-${bIdx}`">
              <!-- text block — Markdown + DOMPurify (T678) -->
              <div
                v-if="block.type === 'text'"
                class="stream-markdown block-text py-3 px-4"
                data-testid="block-text"
                v-html="block._html ?? ''"
              />

              <!-- tool_use / tool_result — delegated to StreamToolBlock (T816) -->
              <StreamToolBlock
                v-else-if="block.type === 'tool_use' || block.type === 'tool_result'"
                :block="block"
                :event-id="event._id!"
                :block-idx="bIdx"
                :collapsed="collapsed"
                :accent-fg="accentFg"
                :accent-bg="accentBg"
                :accent-border="accentBorder"
                :accent-on-color="accentOnColor"
                :accent-text="accentText"
                @toggle-collapsed="toggleCollapsed"
                @select-option="handleSelectOption"
              />
            </template>
          </div>
        </template>

        <!-- result footer — cost / duration / turns -->
        <div
          v-if="event.type === 'result'"
          class="block-result d-flex flex-wrap ga-2 py-2"
          data-testid="block-result"
        >
          <v-chip v-if="event.num_turns !== undefined" size="x-small" variant="tonal">
            {{ t('stream.turns', event.num_turns, { named: { n: event.num_turns } }) }}
          </v-chip>
          <v-chip v-if="event.cost_usd !== undefined" size="x-small" variant="tonal">
            ${{ event.cost_usd.toFixed(4) }}
          </v-chip>
          <v-chip v-if="event.duration_ms !== undefined" size="x-small" variant="tonal">
            {{ (event.duration_ms / 1000).toFixed(1) }}s
          </v-chip>
          <span v-if="event.session_id" class="result-session-id ml-auto text-caption">{{ event.session_id.slice(0, 8) }}…</span>
        </div>

        <!-- text block — plain text output from non-Claude CLIs (T1197) -->
        <div v-if="event.type === 'text'" class="block-assistant">
          <div
            class="stream-markdown block-text py-3 px-4"
            data-testid="block-text-raw"
            v-html="event._html ?? event.text ?? ''"
          />
        </div>

        <!-- error block — error events from non-Claude CLIs (T1197) -->
        <div
          v-if="event.type === 'error'"
          class="block-error ga-2 py-3 px-4"
          data-testid="block-error-raw"
        >
          <span class="error-icon">⚠</span>
          <span class="error-body-inline">{{ event.text }}</span>
        </div>
      </template>

      <!-- Streaming indicator — thinking preview (T731) or generic dots -->
      <div
        v-if="isStreaming"
        class="streaming-indicator ga-2 text-caption"
        :style="{ color: accentText }"
        data-testid="streaming-indicator"
      >
        <span class="bounce-dots">
          <span class="bounce-dot" :style="{ backgroundColor: accentText }" />
          <span class="bounce-dot bounce-dot--d1" :style="{ backgroundColor: accentText }" />
          <span class="bounce-dot bounce-dot--d2" :style="{ backgroundColor: accentText }" />
        </span>
        <span v-if="activeThinkingText" class="thinking-text ga-1">
          <span class="thinking-label" data-testid="thinking-label">{{ t('stream.thinking') }}</span>
          <span class="thinking-preview" data-testid="thinking-preview">{{ activeThinkingText.slice(-120) }}</span>
        </span>
        <span v-else class="streaming-label">{{ t('stream.streaming') }}</span>
      </div>
    </div>

    <!-- Hook events bar (T742) -->
    <HookEventBar :session-id="sessionId" />

    <!-- Input bar — delegated to StreamInputBar (T816) -->
    <StreamInputBar
      :is-streaming="isStreaming"
      :pty-id="ptyId"
      :agent-stopped="agentStopped"
      :session-id="sessionId"
      :accent-fg="accentFg"
      :accent-text="accentText"
      :accent-on-fg="userBubbleTextColor"
      :pending-question="pendingQuestion ?? undefined"
      :prefill-answer="prefillAnswer"
      @send="handleSend"
      @stop="handleStop"
    />
  </div>
</template>

<style scoped>
.stream-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background-color: var(--surface-base);
  color: var(--content-primary);
}

.stream-accent-bar {
  height: 2px;
  width: 100%;
  flex-shrink: 0;
}

.stream-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.stream-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--content-subtle);
}

/* system:init */
.block-system-init {
  color: var(--content-subtle);
  font-style: italic;
}
.init-session-id {
  font-family: ui-monospace, monospace;
}
.init-ctx-btn {
  font-style: normal !important;
  color: var(--content-faint) !important;
  font-size: inherit !important;
}
.init-ctx-body {
  font-style: normal;
  color: var(--content-faint);
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

/* error blocks */
.block-error {
  display: flex;
  align-items: flex-start;
  background: rgba(var(--v-theme-error), 0.12);
  border: 1px solid rgba(var(--v-theme-error), 0.4);
  border-radius: var(--shape-sm);
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.error-icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-error));
}
.error-body {
  user-select: text;
  cursor: text;
}
.error-type {
  font-weight: 600;
  color: rgb(var(--v-theme-error));
}
.error-text {
  white-space: pre-wrap;
}
.error-stderr {
  color: rgba(var(--v-theme-error), 0.8);
  white-space: pre-wrap;
}
.error-body-inline {
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
}

/* user bubble */
.block-user {
  display: flex;
  justify-content: flex-end;
}
.user-bubble {
  border-radius: 20px 20px 4px 20px;
  max-width: 70%;
  overflow-wrap: break-word;
  font-size: 0.875rem;
  line-height: 1.625;
  user-select: text;
  cursor: text;
}
/* T1736: inline image in user bubble */
.user-bubble-img {
  max-height: 200px;
  max-width: 100%;
  border-radius: 8px;
  display: block;
  margin-top: 4px;
}

/* assistant wrapper — left-aligned flex column */
.block-assistant {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* assistant text block — chat bubble, left side */
.block-text {
  border-radius: 4px 20px 20px 20px;
  background: var(--surface-secondary);
  border: none;
  max-width: 85%;
  font-size: 0.875rem;
  line-height: 1.625;
  user-select: text;
  cursor: text;
}

/* result footer */
.block-result {
  border-top: 1px solid var(--edge-subtle);
}
.result-session-id {
  font-family: ui-monospace, monospace;
  color: var(--content-faint);
}

/* streaming indicator */
.streaming-indicator {
  display: flex;
  align-items: center;
  min-width: 0;
}
.bounce-dots {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
}
.bounce-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: streamBounce 1s infinite;
}
.bounce-dot--d1 { animation-delay: 150ms; }
.bounce-dot--d2 { animation-delay: 300ms; }
@keyframes streamBounce {
  0%, 100% { transform: translateY(0); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
  50% { transform: translateY(-4px); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
}
.thinking-text {
  display: flex;
  align-items: center;
  min-width: 0;
}
.thinking-label { flex-shrink: 0; font-weight: 500; }
.thinking-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  opacity: 0.75;
  color: var(--content-muted);
}
.streaming-label { opacity: 0.75; }
</style>
