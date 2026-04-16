import { defineStore } from 'pinia'
import { ref, computed, effectScope, type ComputedRef, type EffectScope } from 'vue'

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

/** Max memoized computed entries per Map — simple LRU eviction (T1135). */
const MAX_CACHED_COMPUTEDS = 20

/** Maximum total events kept in the store (memory cap). */
const MAX_EVENTS = 500

/** TTL for hook events — events older than this are pruned on each push (T1135). */
const HOOK_EVENT_TTL_MS = 5 * 60 * 1000

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

    // Single atomic reassign — avoids double reactive mutation that caused duplicate renders (T1814)
    const cutoff = e.ts - HOOK_EVENT_TTL_MS
    const fresh = [...events.value, e].filter(ev => ev.ts > cutoff)
    events.value = fresh.length > MAX_EVENTS ? fresh.slice(-MAX_EVENTS) : fresh

    const key = sessionId ?? '__global__'
    if (raw.event === 'PreToolUse') {
      const toolName = (raw.payload as Record<string, unknown> | null)?.tool_name as string ?? '?'
      // Direct mutation on reactive proxy — no spread allocation (T794)
      activeTools.value[key] = toolName
    } else if (raw.event === 'PostToolUse') {
      delete activeTools.value[key]
    }
  }

  interface ScopedComputed<T> {
    ref: ComputedRef<T>
    scope: EffectScope
  }

  /** Memoized computed views by sessionId — avoids orphaned computeds on repeated calls. */
  const _sessionComputeds = new Map<string, ScopedComputed<HookEvent[]>>()

  /** Reactive computed view of events for a given sessionId. */
  function eventsForSession(sessionId: string | null) {
    const key = sessionId ?? '__null__'
    if (!_sessionComputeds.has(key)) {
      const scope = effectScope()
      const ref = scope.run(() => computed(() => events.value.filter(e => e.sessionId === sessionId)))!
      _sessionComputeds.set(key, { ref, scope })
      // LRU eviction — stop reactive scope before dropping entry (T1954)
      if (_sessionComputeds.size > MAX_CACHED_COMPUTEDS) {
        const oldestKey = _sessionComputeds.keys().next().value!
        _sessionComputeds.get(oldestKey)!.scope.stop()
        _sessionComputeds.delete(oldestKey)
      }
    }
    return _sessionComputeds.get(key)!.ref
  }

  /** Memoized computed views by sessionId — avoids orphaned computeds on repeated calls. */
  const _activeToolComputeds = new Map<string, ScopedComputed<string | null>>()

  /** Reactive computed active tool name for a given sessionId. null = idle. */
  function activeToolForSession(sessionId: string | null) {
    const key = sessionId ?? '__global__'
    if (!_activeToolComputeds.has(key)) {
      const scope = effectScope()
      const ref = scope.run(() => computed(() => activeTools.value[key] ?? null))!
      _activeToolComputeds.set(key, { ref, scope })
      // LRU eviction — stop reactive scope before dropping entry (T1954)
      if (_activeToolComputeds.size > MAX_CACHED_COMPUTEDS) {
        const oldestKey = _activeToolComputeds.keys().next().value!
        _activeToolComputeds.get(oldestKey)!.scope.stop()
        _activeToolComputeds.delete(oldestKey)
      }
    }
    return _activeToolComputeds.get(key)!.ref
  }

  return { events, activeTools, push, eventsForSession, activeToolForSession }
})
