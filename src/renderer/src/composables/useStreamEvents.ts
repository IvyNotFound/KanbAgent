/**
 * Composable for StreamView event buffering, micro-batching, and eviction.
 * Extracted from StreamView.vue to keep the component under 400 lines.
 *
 * @module composables/useStreamEvents
 */

import { ref, watch, nextTick } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { renderMarkdown } from '@renderer/utils/renderMarkdown'
import type { StreamEvent } from '@renderer/types/stream'

export const MAX_EVENTS = 2000
export const MAX_EVENTS_HIDDEN = 200

export function useStreamEvents(terminalId: string) {
  const tabsStore = useTabsStore()

  const events = ref<StreamEvent[]>([])
  const collapsed = ref<Record<string, boolean>>({})
  const scrollContainer = ref<HTMLElement | null>(null)

  let nextEventId = 1
  function assignEventId(e: StreamEvent): void {
    if (e._id == null) e._id = nextEventId++
  }

  // ── Micro-batching (T676) ───────────────────────────────────────────────────
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

  // ── Hidden-tab eviction (T962) + _html clearing (T1135) ─────────────────────
  watch(() => tabsStore.activeTabId === terminalId, (isActive) => {
    if (!isActive) {
      // Clear rendered _html on remaining events — will be re-rendered on activate (T1135)
      for (const ev of events.value) {
        if (ev.message?.content) {
          for (const block of ev.message.content) {
            block._html = undefined
          }
        }
      }
      if (events.value.length > MAX_EVENTS_HIDDEN) {
        const evicted = events.value.splice(0, events.value.length - MAX_EVENTS_HIDDEN)
        const evictedIds = new Set(evicted.map(e => e._id))
        for (const key of Object.keys(collapsed.value)) {
          if (evictedIds.has(parseInt(key.split('-')[0], 10))) delete collapsed.value[key]
        }
      }
    } else {
      // Re-render _html when tab becomes active again (T1135)
      for (const ev of events.value) {
        if (ev.message?.content) {
          for (const block of ev.message.content) {
            if (block.type === 'text' && block.text != null && !block._html) {
              block._html = renderMarkdown(block.text)
            } else if (block.type === 'tool_result' && !block._html) {
              const raw = !block.content ? '' : typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(c => c.text ?? '').join('\n') : String(block.content)
              const stripped = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
              block._html = renderMarkdown(stripped)
            }
          }
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
  }

  return {
    events, collapsed, scrollContainer,
    assignEventId, enqueueEvent, flushEvents,
    scrollToBottom, toggleCollapsed, cleanup,
  }
}
