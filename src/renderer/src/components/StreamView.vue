<script setup lang="ts">
/**
 * StreamView — structured display of stream-json CLI messages (ADR-009 Option B).
 * Renders agent sessions as structured blocks: text, tool_use, tool_result, thinking, result.
 * Used in App.vue for tabs with viewMode === 'stream' (T597).
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentFg, agentBg, agentBorder, colorVersion } from '@renderer/utils/agentColor'
import { renderMarkdown } from '@renderer/utils/renderMarkdown'
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

const events = ref<StreamEvent[]>([])
const scrollContainer = ref<HTMLElement | null>(null)
const sessionId = ref<string | null>(null)
const ptyId = ref<string | null>(null)
const collapsed = ref<Record<string, boolean>>({})
const agentStopped = ref(false)

let nextEventId = 1
function assignEventId(e: StreamEvent): void {
  if (e._id == null) e._id = nextEventId++
}

// ── Computed ──────────────────────────────────────────────────────────────────

const isStreaming = computed(() => {
  if (events.value.length === 0) return false
  return events.value[events.value.length - 1].type === 'assistant'
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
 *
 * Supports two formats produced by build-agent-prompt:
 *  - New (multi-line): "<context block>\n---\n<base>" where context starts with "=== IDENTIFIANTS ==="
 *  - Legacy (single-line): "<context> -> <base>" where context contains "Session préc.:" or "Tâches:"
 *
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

/**
 * Maps each system:init event _id to the context string of its first following user message.
 * Used to display session/task metadata in the init block instead of the user bubble.
 */
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

// ── Collapse helpers ──────────────────────────────────────────────────────────

function toggleCollapsed(key: string, defaultCollapsed = false): void {
  collapsed.value[key] = !(collapsed.value[key] ?? defaultCollapsed)
}

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

// ── Micro-batching (T676) ─────────────────────────────────────────────────────
// Buffer IPC events in a non-reactive array, flush once per nextTick to avoid
// 1 re-render per JSONL line at high-frequency streaming.

const MAX_EVENTS = 500
let pendingEvents: StreamEvent[] = []
let flushPending = false

function flushEvents(): void {
  if (pendingEvents.length === 0) { flushPending = false; return }
  for (const e of pendingEvents) {
    assignEventId(e)
    if (e.message?.content) {
      for (const block of e.message.content) {
        if (block.type === 'text' && block.text != null) {
          block._html = renderMarkdown(block.text)
        } else if (block.type === 'tool_result') {
          const raw = !block.content ? '' : typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(c => c.text ?? '').join('\n') : String(block.content)
          const stripped = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
          block._lineCount = stripped.split('\n').length
          block._isLong = block._lineCount > 15
          block._html = renderMarkdown(stripped)
        }
      }
    }
    events.value.push(e)
  }
  pendingEvents = []
  flushPending = false

  // Sliding window eviction — purge collapsed keys by stable _id (T823).
  if (events.value.length > MAX_EVENTS) {
    const evicted = events.value.splice(0, events.value.length - MAX_EVENTS)
    const evictedIds = new Set(evicted.map(e => e._id))
    for (const key of Object.keys(collapsed.value)) {
      if (evictedIds.has(parseInt(key.split('-')[0], 10))) delete collapsed.value[key]
    }
  }
  scrollToBottom()
}

function isNearBottom(): boolean {
  if (!scrollContainer.value) return true
  const el = scrollContainer.value
  return el.scrollHeight - el.scrollTop - el.clientHeight < 150
}

function scrollToBottom(force = false): void {
  if (!force && !isNearBottom()) return
  nextTick(() => { if (scrollContainer.value) scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let unsubStreamMessage: (() => void) | null = null
let unsubConvId: (() => void) | null = null
let unsubExit: (() => void) | null = null

/**
 * Spawns the agent process and registers IPC subscriptions.
 * Subscriptions registered BEFORE agentSend to avoid race condition (T689).
 * Resume shortcut: sets sessionId from convId immediately so Send is enabled (ADR-009).
 */
onMounted(async () => {
  const tab = tabsStore.tabs.find(t => t.id === props.terminalId)
  if (!tab) return

  if (tab.convId && !tab.autoSend) sessionId.value = tab.convId

  try {
    const id = await window.electronAPI.agentCreate({
      projectPath: tasksStore.projectPath ?? undefined,
      wslDistro: tab.wslDistro ?? undefined,
      systemPrompt: tab.systemPrompt ?? undefined,
      thinkingMode: tab.thinkingMode ?? undefined,
      claudeCommand: tab.claudeCommand ?? undefined,
      convId: tab.convId ?? undefined,
    })
    ptyId.value = id
    tabsStore.setPtyId(props.terminalId, id)
    tabsStore.setStreamId(props.terminalId, id)

    unsubStreamMessage = window.electronAPI.onAgentStream(id, (raw: Record<string, unknown>) => {
      pendingEvents.push(raw as StreamEvent)
      if (!flushPending) { flushPending = true; nextTick(flushEvents) }
    })
    unsubConvId = window.electronAPI.onAgentConvId(id, (convId: string) => { sessionId.value = convId })
    unsubExit = window.electronAPI.onAgentExit(id, (_exitCode: number | null) => {
      if (isStreaming.value) { const e: StreamEvent = { type: 'result' }; assignEventId(e); events.value.push(e) }
    })

    if (tab.autoSend) {
      const autoEvent: StreamEvent = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: tab.autoSend }] } }
      assignEventId(autoEvent)
      events.value.push(autoEvent)
      scrollToBottom(true)
      await window.electronAPI.agentSend(id, tab.autoSend)
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
  events.value = []; collapsed.value = {}; pendingEvents = []
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
        En attente de messages…
      </div>

      <template v-for="event in displayEvents" :key="event._id">
        <!-- system:init -->
        <div
          v-if="event.type === 'system' && event.subtype === 'init'"
          class="text-content-subtle text-xs italic"
          data-testid="block-system-init"
        >
          Session démarrée
          <span v-if="event.session_id" class="ml-1 font-mono">· {{ event.session_id.slice(0, 8) }}…</span>
          <template v-if="sessionContextMap.get(event._id!)">
            <button
              class="ml-2 text-content-faint hover:text-content-muted transition-colors not-italic"
              @click="toggleCollapsed(`init-ctx-${event._id}`, true)"
            >{{ (collapsed[`init-ctx-${event._id}`] ?? true) ? '▶ ctx' : '▼ ctx' }}</button>
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
          <span v-if="event.num_turns !== undefined">{{ event.num_turns }} tour{{ event.num_turns > 1 ? 's' : '' }}</span>
          <span v-if="event.cost_usd !== undefined">${{ event.cost_usd.toFixed(4) }}</span>
          <span v-if="event.duration_ms !== undefined">{{ (event.duration_ms / 1000).toFixed(1) }}s</span>
          <span v-if="event.session_id" class="ml-auto font-mono text-content-faint">{{ event.session_id.slice(0, 8) }}…</span>
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
          <span class="shrink-0 font-medium" data-testid="thinking-label">Thinking…</span>
          <span class="truncate italic opacity-75 text-content-muted" data-testid="thinking-preview">{{ activeThinkingText.slice(-120) }}</span>
        </span>
        <span v-else class="opacity-75">En cours…</span>
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
