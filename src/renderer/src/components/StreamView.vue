<script setup lang="ts">
/**
 * StreamView — structured display of stream-json CLI messages (ADR-009 Option B).
 * Renders agent sessions as structured blocks: text, tool_use, tool_result, thinking, result.
 * Used in App.vue for tabs with viewMode === 'stream' (T597).
 */
import { computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { useAgentsStore } from '@renderer/stores/agents'
import { agentFg, agentBg, agentBorder, colorVersion } from '@renderer/utils/agentColor'
import { useStreamEvents } from '@renderer/composables/useStreamEvents'
import HookEventBar from './HookEventBar.vue'
import StreamToolBlock from './StreamToolBlock.vue'
import StreamInputBar from './StreamInputBar.vue'
import githubDarkUrl from 'highlight.js/styles/github-dark.css?url'
import githubUrl from 'highlight.js/styles/github.css?url'

// Re-export stream types so existing consumers keep their import paths (T816).
export type { StreamContentBlock, StreamEvent } from '@renderer/types/stream'
import type { StreamEvent } from '@renderer/types/stream'

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

import { ref } from 'vue'
const sessionId = ref<string | null>(null)
const ptyId = ref<string | null>(null)
const agentStopped = ref(false)

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

const agentName = computed(() => tabsStore.tabs.find(t => t.id === props.terminalId)?.agentName ?? '')

const accentFg = computed(() => { void colorVersion.value; return agentName.value ? agentFg(agentName.value) : 'hsl(270, 60%, 68%)' })
const accentBg = computed(() => { void colorVersion.value; return agentName.value ? agentBg(agentName.value) : 'hsl(270, 30%, 18%)' })
const accentBorder = computed(() => { void colorVersion.value; return agentName.value ? agentBorder(agentName.value) : 'hsl(270, 30%, 32%)' })

// Suppresses empty user bubbles from autonomous Claude reasoning (T679).
const displayEvents = computed(() =>
  events.value.filter(event => {
    if (event.type !== 'user') return true
    if (!event.message) return false
    return event.message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim().length > 0
  })
)

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

async function handleSend(text: string): Promise<void> {
  agentStopped.value = false
  const userEvent: StreamEvent = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
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
      // Auto-close for non-Claude CLIs — Claude uses Stop hook (App.vue / T1370)
      const t = tabsStore.tabs.find(tb => tb.id === props.terminalId)
      if (t && t.cli && t.cli !== 'claude') {
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
    <div v-if="agentName" class="stream-accent-bar" :style="{ background: accentFg }" />

    <!-- Messages scroll area -->
    <div ref="scrollContainer" class="stream-scroll">
      <div
        v-if="displayEvents.length === 0 && !isStreaming"
        class="stream-empty"
        data-testid="empty-state"
      >
        {{ t('stream.waitingMessages') }}
      </div>

      <template v-for="event in displayEvents" :key="event._id">
        <!-- system:init -->
        <div
          v-if="event.type === 'system' && event.subtype === 'init'"
          class="block-system-init"
          data-testid="block-system-init"
        >
          {{ t('stream.sessionStarted') }}
          <span v-if="event.session_id" class="init-session-id">· {{ event.session_id.slice(0, 8) }}…</span>
          <template v-if="sessionContextMap.get(event._id!)">
            <button
              class="init-ctx-btn"
              @click="toggleCollapsed(`init-ctx-${event._id}`, true)"
            >{{ (collapsed[`init-ctx-${event._id}`] ?? true) ? '▶ ' + t('stream.ctx') : '▼ ' + t('stream.ctx') }}</button>
            <div
              v-show="!(collapsed[`init-ctx-${event._id}`] ?? true)"
              class="init-ctx-body"
            >{{ sessionContextMap.get(event._id!) }}</div>
          </template>
        </div>

        <!-- error:spawn / error:exit -->
        <div
          v-if="event.type === 'error:spawn' || event.type === 'error:exit'"
          class="block-error"
          data-testid="block-error"
        >
          <span class="error-icon">⚠</span>
          <div class="error-body">
            <span class="error-type">{{ event.type }}</span>
            <span class="error-text">{{ event.error }}</span>
            <pre v-if="event.stderr" class="error-stderr">{{ event.stderr }}</pre>
          </div>
        </div>

        <!-- user bubble — right-aligned (T603) -->
        <div
          v-if="event.type === 'user' && event.message"
          class="block-user"
          data-testid="block-user"
        >
          <div
            class="user-bubble"
            :style="{ borderColor: accentBorder }"
          >
            <template v-for="(block, bIdx) in event.message.content" :key="bIdx">
              <span v-if="block.type === 'text'">{{ parsePromptContext(block.text ?? '').base }}</span>
            </template>
          </div>
        </div>

        <!-- assistant blocks -->
        <template v-if="event.type === 'assistant' && event.message">
          <template v-for="(block, bIdx) in event.message.content" :key="`${event._id}-${bIdx}`">
            <!-- text block — Markdown + DOMPurify (T678), agent color bg (T720) -->
            <div
              v-if="block.type === 'text'"
              class="stream-markdown block-text"
              :style="{ backgroundColor: accentBg, borderColor: accentBorder, borderLeftColor: accentFg }"
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
              @toggle-collapsed="toggleCollapsed"
            />
          </template>
        </template>

        <!-- result footer — cost / duration / turns -->
        <div
          v-if="event.type === 'result'"
          class="block-result"
          data-testid="block-result"
        >
          <span v-if="event.num_turns !== undefined">{{ t('stream.turns', event.num_turns, { named: { n: event.num_turns } }) }}</span>
          <span v-if="event.cost_usd !== undefined">${{ event.cost_usd.toFixed(4) }}</span>
          <span v-if="event.duration_ms !== undefined">{{ (event.duration_ms / 1000).toFixed(1) }}s</span>
          <span v-if="event.session_id" class="result-session-id">{{ event.session_id.slice(0, 8) }}…</span>
        </div>

        <!-- text block — plain text output from non-Claude CLIs (T1197) -->
        <div
          v-if="event.type === 'text'"
          class="stream-markdown block-text"
          :style="{ backgroundColor: accentBg, borderColor: accentBorder, borderLeftColor: accentFg }"
          data-testid="block-text-raw"
          v-html="event._html ?? event.text ?? ''"
        />

        <!-- error block — error events from non-Claude CLIs (T1197) -->
        <div
          v-if="event.type === 'error'"
          class="block-error"
          data-testid="block-error-raw"
        >
          <span class="error-icon">⚠</span>
          <span class="error-body-inline">{{ event.text }}</span>
        </div>
      </template>

      <!-- Streaming indicator — thinking preview (T731) or generic dots -->
      <div
        v-if="isStreaming"
        class="streaming-indicator"
        :style="{ color: accentFg }"
        data-testid="streaming-indicator"
      >
        <span class="bounce-dots">
          <span class="bounce-dot" :style="{ backgroundColor: accentFg }" />
          <span class="bounce-dot bounce-dot--d1" :style="{ backgroundColor: accentFg }" />
          <span class="bounce-dot bounce-dot--d2" :style="{ backgroundColor: accentFg }" />
        </span>
        <span v-if="activeThinkingText" class="thinking-text">
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
  background-color: var(--surface-base);
  color: var(--content-primary);
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  font-size: 14px;
}

.stream-accent-bar {
  height: 2px;
  width: 100%;
  flex-shrink: 0;
}

.stream-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stream-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--content-subtle);
  font-size: 12px;
}

/* system:init */
.block-system-init {
  color: var(--content-subtle);
  font-size: 12px;
  font-style: italic;
}
.init-session-id {
  margin-left: 4px;
  font-family: ui-monospace, monospace;
}
.init-ctx-btn {
  margin-left: 8px;
  font-style: normal;
  color: var(--content-faint);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: inherit;
  transition: color 0.15s;
}
.init-ctx-btn:hover { color: var(--content-muted); }
.init-ctx-body {
  margin-top: 4px;
  margin-left: 16px;
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
  gap: 8px;
  background: #450a0a;
  border: 1px solid #991b1b;
  border-radius: 8px;
  padding: 12px 16px;
  color: #fca5a5;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.error-icon {
  flex-shrink: 0;
  color: #f87171;
}
.error-body {
  user-select: text;
  cursor: text;
}
.error-type {
  font-weight: 600;
  color: #f87171;
}
.error-text {
  margin-left: 8px;
  white-space: pre-wrap;
}
.error-stderr {
  margin-top: 8px;
  color: #fecaca;
  font-size: 12px;
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
  background: var(--surface-secondary);
  border: 1px solid;
  border-radius: 8px;
  padding: 12px 16px;
  max-width: 80%;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  font-size: 14px;
  color: var(--content-primary);
  line-height: 1.625;
  user-select: text;
  cursor: text;
}

/* assistant text block */
.block-text {
  border-radius: 8px;
  padding: 12px 16px;
  border: 1px solid;
  border-left-width: 4px;
  line-height: 1.625;
  user-select: text;
  cursor: text;
}

/* result footer */
.block-result {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: var(--content-subtle);
  border-top: 1px solid var(--edge-subtle);
  padding-top: 8px;
}
.result-session-id {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  color: var(--content-faint);
}

/* streaming indicator */
.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
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
  gap: 4px;
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
