/**
 * Composable for StreamView event buffering, micro-batching, and eviction.
 * Extracted from StreamView.vue to keep the component under 400 lines.
 *
 * @module composables/useStreamEvents
 */

import { ref, watch, nextTick } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { renderMarkdown } from '@renderer/utils/renderMarkdown'
import { parsePromptContext } from '@renderer/utils/parsePromptContext'
import type { StreamEvent } from '@renderer/types/stream'

/** Maximum number of events retained in the active-tab sliding window (T1167). */
export const MAX_EVENTS = 2000
/** Maximum number of events retained while the tab is hidden (T962/T1167). */
export const MAX_EVENTS_HIDDEN = 200

export function useStreamEvents(terminalId: string) {
  const tabsStore = useTabsStore()

  const events = ref<StreamEvent[]>([])
  const collapsed = ref<Record<string, boolean>>({})
  const scrollContainer = ref<HTMLElement | null>(null)
  /** Incremental pendingQuestion — set on AskUserQuestion, cleared on user/result (T1864). */
  const pendingQuestion = ref<string | null>(null)

  let nextEventId = 1
  function assignEventId(e: StreamEvent): void {
    if (e._id == null) e._id = nextEventId++
  }

  // ── Micro-batching (T676) ───────────────────────────────────────────────────
  let pendingEvents: StreamEvent[] = []
  let flushPending = false

  function flushEvents(): void {
    if (pendingEvents.length === 0) { flushPending = false; return }
    // T1855: skip expensive renderMarkdown for hidden tabs — deferred to activation watcher
    const active = tabsStore.activeTabId === terminalId
    for (const e of pendingEvents) {
      assignEventId(e)
      // Incremental pendingQuestion tracking (T1864): clear on user/result events
      if (e.type === 'user' || e.type === 'result') {
        pendingQuestion.value = null
      }
      if (e.message?.content) {
        // Pre-render user text blocks with parsePromptContext (T1864)
        if (e.type === 'user') {
          for (const block of e.message.content) {
            if (block.type === 'text' && block.text != null) {
              // T1855: skip expensive renderMarkdown for hidden tabs
              if (active) block._html = renderMarkdown(parsePromptContext(block.text).base)
            }
          }
        } else {
          for (const block of e.message.content) {
            if (block.type === 'text' && block.text != null) {
              if (active) block._html = renderMarkdown(block.text)
            } else if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
              // Incremental pendingQuestion tracking (T1864): set on AskUserQuestion
              const q = (block.input as Record<string, unknown> | undefined)?.question
              if (typeof q === 'string') {
                pendingQuestion.value = q
              } else if (block._question) {
                pendingQuestion.value = block._question
              }
              if (!block.input?.['question']) {
                // T1764: input.question is lost after Electron IPC structured-clone — bridge from
                // the synthetic ask_user event present in the same micro-batch.
                const askUserEv = pendingEvents.find(pe => pe.type === 'ask_user' && pe.text)
                if (askUserEv?.text) {
                  block._question = askUserEv.text
                  pendingQuestion.value = askUserEv.text
                }
              }
            } else if (block.type === 'tool_result') {
              const raw = !block.content ? '' : typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(c => c.text ?? '').join('\n') : String(block.content)
              const stripped = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
              block._lineCount = stripped.split('\n').length
              block._isLong = block._lineCount > 15
              if (active) block._html = renderMarkdown(stripped)
            }
          }
        }
      }
      // Incremental pendingQuestion tracking (T1864): set on ask_user synthetic events
      if (e.type === 'ask_user' && e.text) {
        pendingQuestion.value = e.text
      }
      // Pre-render markdown for top-level text events (non-Claude CLIs) — T1197
      if (e.type === 'text' && e.text != null) {
        if (active) e._html = renderMarkdown(e.text)
      }
      events.value.push(e)
    }
    pendingEvents = []
    flushPending = false

    // Sliding window eviction — purge collapsed keys by stable _id (T823).
    // T1855: hidden tabs use stricter limit to reduce memory footprint.
    const limit = active ? MAX_EVENTS : MAX_EVENTS_HIDDEN
    if (events.value.length > limit) {
      const evicted = events.value.splice(0, events.value.length - limit)
      const evictedIds = new Set(evicted.map(e => e._id))
      for (const key of Object.keys(collapsed.value)) {
        if (evictedIds.has(parseInt(key.split('-')[0], 10))) delete collapsed.value[key]
      }
    }
    // T1855: skip scrollToBottom for hidden tabs — no visible container
    if (active) scrollToBottom()
  }

  function enqueueEvent(raw: Record<string, unknown>): void {
    pendingEvents.push(raw as StreamEvent)
    if (!flushPending) { flushPending = true; nextTick(flushEvents) }
  }

  // ── Scroll helpers ──────────────────────────────────────────────────────────

  function isNearBottom(): boolean {
    if (!scrollContainer.value) return true
    const el = scrollContainer.value
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }

  function scrollToBottom(force = false): void {
    if (!force && !isNearBottom()) return
    nextTick(() => { if (scrollContainer.value) scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight })
  }

  // ── Hidden-tab eviction (T962) ──────────────────────────────────────────────
  // T1865: _html is no longer cleared on deactivation — the ~400KB memory cost
  // of keeping rendered HTML for ≤200 events is negligible for Electron, and it
  // eliminates 600-800 synchronous renderMarkdown calls on tab re-activation.
  watch(() => tabsStore.activeTabId === terminalId, (isActive) => {
    if (isActive) {
      // T1855: render _html for blocks that arrived while the tab was hidden
      for (const e of events.value) {
        if (e.message?.content) {
          for (const block of e.message.content) {
            if (block.type === 'text' && block.text != null && !block._html) {
              block._html = e.type === 'user'
                ? renderMarkdown(parsePromptContext(block.text).base)
                : renderMarkdown(block.text)
            } else if (block.type === 'tool_result' && !block._html) {
              const raw = !block.content ? '' : typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(c => c.text ?? '').join('\n') : String(block.content)
              block._html = renderMarkdown(raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, ''))
            }
          }
        }
        if (e.type === 'text' && e.text != null && !e._html) {
          e._html = renderMarkdown(e.text)
        }
      }
    } else {
      if (events.value.length > MAX_EVENTS_HIDDEN) {
        const evicted = events.value.splice(0, events.value.length - MAX_EVENTS_HIDDEN)
        const evictedIds = new Set(evicted.map(e => e._id))
        for (const key of Object.keys(collapsed.value)) {
          if (evictedIds.has(parseInt(key.split('-')[0], 10))) delete collapsed.value[key]
        }
      }
    }
  })

  // ── Collapse helpers ────────────────────────────────────────────────────────

  function toggleCollapsed(key: string, defaultCollapsed = false): void {
    collapsed.value[key] = !(collapsed.value[key] ?? defaultCollapsed)
  }

  function cleanup(): void {
    events.value = []
    collapsed.value = {}
    pendingEvents = []
    pendingQuestion.value = null
  }

  return {
    events, collapsed, scrollContainer, pendingQuestion,
    assignEventId, enqueueEvent, flushEvents,
    scrollToBottom, toggleCollapsed, cleanup,
  }
}
