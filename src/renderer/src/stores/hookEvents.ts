import { defineStore } from 'pinia'
import { ref, computed, type ComputedRef } from 'vue'

export interface HookEvent {
  /** Unique monotonic counter */
  id: number
  /** Event type: PreToolUse | PostToolUse | SessionStart | SubagentStart | SubagentStop */
  event: string
  payload: unknown
  ts: number
  /** Claude session UUID extracted from payload.session_id */
  sessionId: string | null
  /** tool_use_id linking Pre↔Post pairs for duration analytics (T764). undefined if not present. */
  toolUseId?: string
}

let _seq = 0

/** Maximum total events kept in the store (memory cap). */
const MAX_EVENTS = 2000

/**
 * Global store for Claude Code hook events received via IPC `hook:event`.
 *
 * Events are stored in a single flat array with sessionId tags.
 * Components filter by their own sessionId to show relevant events.
 *
 * IPC listener is set up once in App.vue.
 */
export const useHookEventsStore = defineStore('hookEvents', () => {
  /** Flat list of all hook events (capped at MAX_EVENTS). */
  const events = ref<HookEvent[]>([])

  /** Session IDs with an active tool: sessionId → tool_name. */
  const activeTools = ref<Record<string, string>>({})

  function push(raw: { event: string; payload: unknown; ts: number }): void {
    const p = raw.payload as Record<string, unknown> | null
    const sessionId = p?.session_id as string ?? null
    const toolUseId = p?.tool_use_id as string | undefined
    const e: HookEvent = { id: ++_seq, event: raw.event, payload: raw.payload, ts: raw.ts, sessionId, toolUseId }

    events.value.push(e)
    // slice(-N) amortized: only triggers when limit exceeded, avoids O(N) shift() (T794)
    if (events.value.length > MAX_EVENTS) events.value = events.value.slice(-MAX_EVENTS)

    const key = sessionId ?? '__global__'
    if (raw.event === 'PreToolUse') {
      const toolName = (raw.payload as Record<string, unknown> | null)?.tool_name as string ?? '?'
      // Direct mutation on reactive proxy — no spread allocation (T794)
      activeTools.value[key] = toolName
    } else if (raw.event === 'PostToolUse') {
      delete activeTools.value[key]
    }
  }

  /** Memoized computed views by sessionId — avoids orphaned computeds on repeated calls. */
  const _sessionComputeds = new Map<string, ComputedRef<HookEvent[]>>()

  /** Reactive computed view of events for a given sessionId. */
  function eventsForSession(sessionId: string | null) {
    const key = sessionId ?? '__null__'
    if (!_sessionComputeds.has(key)) {
      _sessionComputeds.set(key, computed(() => events.value.filter(e => e.sessionId === sessionId)))
    }
    return _sessionComputeds.get(key)!
  }

  /** Memoized computed views by sessionId — avoids orphaned computeds on repeated calls. */
  const _activeToolComputeds = new Map<string, ComputedRef<string | null>>()

  /** Reactive computed active tool name for a given sessionId. null = idle. */
  function activeToolForSession(sessionId: string | null) {
    const key = sessionId ?? '__global__'
    if (!_activeToolComputeds.has(key)) {
      _activeToolComputeds.set(key, computed(() => activeTools.value[key] ?? null))
    }
    return _activeToolComputeds.get(key)!
  }

  return { events, activeTools, push, eventsForSession, activeToolForSession }
})
