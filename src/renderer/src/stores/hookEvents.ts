import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface HookEvent {
  /** Unique monotonic counter */
  id: number
  /** Event type: PreToolUse | PostToolUse | SessionStart | SubagentStart | SubagentStop */
  event: string
  payload: unknown
  ts: number
  /** Claude session UUID extracted from payload.session_id */
  sessionId: string | null
}

let _seq = 0

/** Maximum total events kept in the store (memory cap). */
const MAX_EVENTS = 200

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
    const sessionId = (raw.payload as Record<string, unknown> | null)?.session_id as string ?? null
    const e: HookEvent = { id: ++_seq, event: raw.event, payload: raw.payload, ts: raw.ts, sessionId }

    events.value.push(e)
    if (events.value.length > MAX_EVENTS) events.value.shift()

    const key = sessionId ?? '__global__'
    if (raw.event === 'PreToolUse') {
      const toolName = (raw.payload as Record<string, unknown> | null)?.tool_name as string ?? '?'
      activeTools.value = { ...activeTools.value, [key]: toolName }
    } else if (raw.event === 'PostToolUse') {
      const copy = { ...activeTools.value }
      delete copy[key]
      activeTools.value = copy
    }
  }

  /** Reactive computed view of events for a given sessionId. */
  function eventsForSession(sessionId: string | null) {
    return computed(() => events.value.filter(e => e.sessionId === sessionId))
  }

  /** Reactive computed active tool name for a given sessionId. null = idle. */
  function activeToolForSession(sessionId: string | null) {
    const key = sessionId ?? '__global__'
    return computed(() => activeTools.value[key] ?? null)
  }

  return { events, activeTools, push, eventsForSession, activeToolForSession }
})
