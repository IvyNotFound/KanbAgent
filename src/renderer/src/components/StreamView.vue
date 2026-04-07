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

// Lightbox state — T1718
const lightboxOpen = ref<boolean>(false)
const lightboxSrc = ref<string>('')
function openLightbox(src: string): void {
  lightboxSrc.value = src
  lightboxOpen.value = true
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

const agentName = computed(() => tabsStore.tabs.find(t => t.id === props.terminalId)?.agentName ?? '')

const accentFg = computed(() => { void colorVersion.value; return agentName.value ? agentFg(agentName.value) : 'hsl(270, 60%, 68%)' })
const accentBg = computed(() => { void colorVersion.value; return agentName.value ? agentBg(agentName.value) : 'hsl(270, 30%, 18%)' })
const accentBorder = computed(() => { void colorVersion.value; return agentName.value ? agentBorder(agentName.value) : 'hsl(270, 30%, 32%)' })

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
  <div class="flex flex-col h-full bg-surface-base text-content-primary font-mono text-sm">
    <!-- Agent color accent header bar (T680) -->
    <div v-if="agentName" class="h-0.5 w-full shrink-0" :style="{ background: accentFg }" />

    <!-- Messages scroll area -->
    <div ref="scrollContainer" class="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3">
      <div
        v-if="displayEvents.length === 0 && !isStreaming"
        class="flex items-center justify-center h-full text-content-subtle text-xs"
        data-testid="empty-state"
      >
        {{ t('stream.waitingMessages') }}
      </div>

      <template v-for="event in displayEvents" :key="event._id">
        <!-- system:init -->
        <div
          v-if="event.type === 'system' && event.subtype === 'init'"
          class="text-content-subtle text-xs italic"
          data-testid="block-system-init"
        >
          {{ t('stream.sessionStarted') }}
          <span v-if="event.session_id" class="ml-1 font-mono">· {{ event.session_id.slice(0, 8) }}…</span>
          <template v-if="sessionContextMap.get(event._id!)">
            <button
              class="ml-2 text-content-faint hover:text-content-muted transition-colors not-italic"
              @click="toggleCollapsed(`init-ctx-${event._id}`, true)"
            >{{ (collapsed[`init-ctx-${event._id}`] ?? true) ? '▶ ' + t('stream.ctx') : '▼ ' + t('stream.ctx') }}</button>
            <div
              v-show="!(collapsed[`init-ctx-${event._id}`] ?? true)"
              class="mt-1 ml-4 not-italic text-content-faint whitespace-pre-wrap font-mono text-xs"
            >{{ sessionContextMap.get(event._id!) }}</div>
          </template>
        </div>

        <!-- error:spawn / error:exit -->
        <div
          v-if="event.type === 'error:spawn' || event.type === 'error:exit'"
          class="flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-xs font-mono"
          data-testid="block-error"
        >
          <span class="shrink-0 text-red-400">⚠</span>
          <div class="select-text cursor-text">
            <span class="font-semibold text-red-400">{{ event.type }}</span>
            <span class="ml-2 whitespace-pre-wrap">{{ event.error }}</span>
            <pre v-if="event.stderr" class="mt-2 text-red-200 text-xs whitespace-pre-wrap">{{ event.stderr }}</pre>
          </div>
        </div>

        <!-- user bubble — right-aligned (T603) -->
        <div
          v-if="event.type === 'user' && event.message"
          class="flex justify-end"
          data-testid="block-user"
        >
          <div
            class="bg-surface-secondary border rounded-lg px-4 py-3 max-w-[80%] whitespace-pre-wrap break-words text-sm text-content-primary leading-relaxed select-text cursor-text"
            :style="{ borderColor: accentBorder }"
          >
            <template v-for="(block, bIdx) in event.message.content" :key="bIdx">
              <div v-if="block.type === 'text'" v-html="renderMarkdown(parsePromptContext(block.text ?? '').base)" />
              <img
                v-else-if="block.type === 'image_ref' && block.objectUrl"
                :src="block.objectUrl"
                class="user-thumbnail"
                alt=""
                data-testid="user-thumbnail"
                @click="openLightbox(block.objectUrl!)"
              />
            </template>
          </div>
        </div>

        <!-- assistant blocks -->
        <template v-if="event.type === 'assistant' && event.message">
          <template v-for="(block, bIdx) in event.message.content" :key="`${event._id}-${bIdx}`">
            <!-- text block — Markdown + DOMPurify (T678), agent color bg (T720) -->
            <div
              v-if="block.type === 'text'"
              class="stream-markdown rounded-lg px-4 py-3 border border-l-4 leading-relaxed select-text cursor-text"
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
          class="flex flex-wrap gap-4 text-xs text-content-subtle border-t border-edge-subtle pt-2"
          data-testid="block-result"
        >
          <span v-if="event.num_turns !== undefined">{{ t('stream.turns', event.num_turns, { named: { n: event.num_turns } }) }}</span>
          <span v-if="event.cost_usd !== undefined">${{ event.cost_usd.toFixed(4) }}</span>
          <span v-if="event.duration_ms !== undefined">{{ (event.duration_ms / 1000).toFixed(1) }}s</span>
          <span v-if="event.session_id" class="ml-auto font-mono text-content-faint">{{ event.session_id.slice(0, 8) }}…</span>
        </div>

        <!-- text block — plain text output from non-Claude CLIs (T1197) -->
        <div
          v-if="event.type === 'text'"
          class="stream-markdown rounded-lg px-4 py-3 border border-l-4 leading-relaxed select-text cursor-text"
          :style="{ backgroundColor: accentBg, borderColor: accentBorder, borderLeftColor: accentFg }"
          data-testid="block-text-raw"
          v-html="event._html ?? event.text ?? ''"
        />

        <!-- error block — error events from non-Claude CLIs (T1197) -->
        <div
          v-if="event.type === 'error'"
          class="flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-xs font-mono"
          data-testid="block-error-raw"
        >
          <span class="shrink-0 text-red-400">⚠</span>
          <span class="whitespace-pre-wrap select-text cursor-text">{{ event.text }}</span>
        </div>
      </template>

      <!-- Streaming indicator — thinking preview (T731) or generic dots -->
      <div
        v-if="isStreaming"
        class="flex items-center gap-2 text-xs min-w-0"
        :style="{ color: accentFg }"
        data-testid="streaming-indicator"
      >
        <span class="inline-flex gap-0.5 shrink-0">
          <span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]" :style="{ backgroundColor: accentFg }" />
          <span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:150ms]" :style="{ backgroundColor: accentFg }" />
          <span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:300ms]" :style="{ backgroundColor: accentFg }" />
        </span>
        <span v-if="activeThinkingText" class="flex items-center gap-1 min-w-0">
          <span class="shrink-0 font-medium" data-testid="thinking-label">{{ t('stream.thinking') }}</span>
          <span class="truncate italic opacity-75 text-content-muted" data-testid="thinking-preview">{{ activeThinkingText.slice(-120) }}</span>
        </span>
        <span v-else class="opacity-75">{{ t('stream.streaming') }}</span>
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

    <!-- Lightbox dialog — fullscreen image preview on thumbnail click (T1718) -->
    <v-dialog v-model="lightboxOpen" max-width="90vw" data-testid="lightbox-dialog">
      <v-card>
        <v-img :src="lightboxSrc" max-height="85vh" contain />
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="lightboxOpen = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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

/* image thumbnail in user bubble — T1718 */
.user-thumbnail {
  display: block;
  max-height: 160px;
  max-width: 240px;
  border-radius: 8px;
  cursor: pointer;
  object-fit: contain;
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
