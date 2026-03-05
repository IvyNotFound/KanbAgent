import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'

// Mock window.electronAPI
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  terminalKill: vi.fn(),
  findProjectDb: vi.fn().mockResolvedValue(null),
  getTaskLinks: vi.fn().mockResolvedValue({ success: true, links: [] }),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'New Group', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


import { useHookEventsStore } from '@renderer/stores/hookEvents'


describe('stores/hookEvents — push() (T779)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('increments id monotonically on each push', () => {
    const store = useHookEventsStore()
    store.push({ event: 'SessionStart', payload: null, ts: 1 })
    store.push({ event: 'SessionStart', payload: null, ts: 2 })
    store.push({ event: 'SessionStart', payload: null, ts: 3 })
    expect(store.events[0].id).toBeLessThan(store.events[1].id)
    expect(store.events[1].id).toBeLessThan(store.events[2].id)
  })

  it('extracts sessionId from payload.session_id', () => {
    const store = useHookEventsStore()
    store.push({ event: 'SessionStart', payload: { session_id: 'abc-123' }, ts: 1 })
    expect(store.events[0].sessionId).toBe('abc-123')
  })

  it('sets sessionId to null when payload.session_id is absent', () => {
    const store = useHookEventsStore()
    store.push({ event: 'SessionStart', payload: null, ts: 1 })
    expect(store.events[0].sessionId).toBeNull()
  })

  it('extracts toolUseId from payload.tool_use_id', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { tool_use_id: 'tu-42', tool_name: 'Bash' }, ts: 1 })
    expect(store.events[0].toolUseId).toBe('tu-42')
  })

  it('sets toolUseId to undefined when payload.tool_use_id is absent', () => {
    const store = useHookEventsStore()
    store.push({ event: 'SessionStart', payload: {}, ts: 1 })
    expect(store.events[0].toolUseId).toBeUndefined()
  })

  it('adds event to events[]', () => {
    const store = useHookEventsStore()
    store.push({ event: 'SessionStart', payload: null, ts: 100 })
    expect(store.events).toHaveLength(1)
    expect(store.events[0].event).toBe('SessionStart')
    expect(store.events[0].ts).toBe(100)
  })

  it('caps at MAX_EVENTS (2000) — oldest event removed when exceeded', () => {
    const store = useHookEventsStore()
    for (let i = 0; i < 2001; i++) {
      store.push({ event: 'SessionStart', payload: null, ts: i })
    }
    expect(store.events.length).toBe(2000)
    // Oldest (ts=0) should be gone, newest (ts=2000) should be present
    expect(store.events[store.events.length - 1].ts).toBe(2000)
    expect(store.events.some(e => e.ts === 0)).toBe(false)
  })

  it('PreToolUse sets activeTools[sessionId] = tool_name', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { session_id: 'sess-1', tool_name: 'Bash' }, ts: 1 })
    expect(store.activeTools['sess-1']).toBe('Bash')
  })

  it('PostToolUse removes activeTools[sessionId]', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { session_id: 'sess-1', tool_name: 'Bash' }, ts: 1 })
    store.push({ event: 'PostToolUse', payload: { session_id: 'sess-1' }, ts: 2 })
    expect(store.activeTools['sess-1']).toBeUndefined()
  })

  it('non-tool event leaves activeTools unchanged', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { session_id: 'sess-1', tool_name: 'Bash' }, ts: 1 })
    store.push({ event: 'SessionStart', payload: { session_id: 'sess-1' }, ts: 2 })
    expect(store.activeTools['sess-1']).toBe('Bash')
  })

  it('null sessionId uses __global__ key in activeTools', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Read' }, ts: 1 })
    expect(store.activeTools['__global__']).toBe('Read')
  })
})


describe('stores/hookEvents — eventsForSession() (T779)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns filtered computed for sessionId', async () => {
    const store = useHookEventsStore()
    store.push({ event: 'SessionStart', payload: { session_id: 'A' }, ts: 1 })
    store.push({ event: 'SessionStart', payload: { session_id: 'B' }, ts: 2 })
    const forA = store.eventsForSession('A')
    expect(forA.value).toHaveLength(1)
    expect(forA.value[0].sessionId).toBe('A')
  })

  it('computed updates reactively on new push with same sessionId', async () => {
    const store = useHookEventsStore()
    const forA = store.eventsForSession('A')
    expect(forA.value).toHaveLength(0)
    store.push({ event: 'SessionStart', payload: { session_id: 'A' }, ts: 1 })
    await nextTick()
    expect(forA.value).toHaveLength(1)
  })
})


describe('stores/hookEvents — activeToolForSession() (T779)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns active tool name for a session', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { session_id: 'sess-X', tool_name: 'Glob' }, ts: 1 })
    const tool = store.activeToolForSession('sess-X')
    expect(tool.value).toBe('Glob')
  })

  it('returns null when session is idle (no active tool)', () => {
    const store = useHookEventsStore()
    const tool = store.activeToolForSession('sess-unknown')
    expect(tool.value).toBeNull()
  })

  it('returns null after PostToolUse clears the tool', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { session_id: 'sess-Y', tool_name: 'Write' }, ts: 1 })
    store.push({ event: 'PostToolUse', payload: { session_id: 'sess-Y' }, ts: 2 })
    const tool = store.activeToolForSession('sess-Y')
    expect(tool.value).toBeNull()
  })
})

