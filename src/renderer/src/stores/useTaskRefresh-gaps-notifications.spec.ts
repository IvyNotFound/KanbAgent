/**
 * useTaskRefresh-gaps-notifications.spec.ts — T1314
 * Split from useTaskRefresh-gaps.spec.ts
 *
 * Covers:
 * - L92: tasks.value.length > 0 (notification guard)
 * - L97: status includes check (in_progress / done)
 * - L98: notification cooldown boundary < 5000ms
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import {
  installElectronAPI,
  makeDeps,
  makeTransitionQuery,
  loadWithNotifications,
  loadWithoutNotifications,
} from './__helpers__/useTaskRefresh-gaps.helpers'

installElectronAPI()

// ─── L92: tasks.value.length > 0 ─────────────────────────────────────────────
describe('useTaskRefresh — notification guard: tasks.value.length (L92)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
  })

  it('does NOT fire notification when tasks.value.length === 0 (exactly zero)', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const deps = makeDeps({
      tasks: ref([]),
      query: makeTransitionQuery(1, 'done'),
    })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).not.toHaveBeenCalled()
  })

  it('DOES fire notification when tasks.value.length === 1 (boundary: one task)', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90001
    const taskRef = ref([{ id: taskId, title: 'One', status: 'todo', agent_name: 'a' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).toHaveBeenCalled()
  })
})

// ─── L97: includes('in_progress') and includes('done') ───────────────────────
describe('useTaskRefresh — notification: status includes check (L97)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
  })

  it('fires notification with title "Task started" on todo -> in_progress', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90100
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_name: 'b' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'in_progress') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).toHaveBeenCalledWith('Task started', expect.objectContaining({ body: expect.stringContaining('T') }))
  })

  it('fires notification with title "Task completed" on in_progress -> done', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90200
    const taskRef = ref([{ id: taskId, title: 'Done', status: 'in_progress', agent_name: 'c' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).toHaveBeenCalledWith('Task completed', expect.anything())
  })

  it('does NOT fire when notificationsEnabled is false', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithoutNotifications()

    const taskId = 90300
    const taskRef = ref([{ id: taskId, title: 'Off', status: 'todo', agent_name: 'd' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).not.toHaveBeenCalled()
  })

  it('does NOT fire when Notification.permission is "denied"', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'denied' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90400
    const taskRef = ref([{ id: taskId, title: 'NoPerm', status: 'todo', agent_name: 'e' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).not.toHaveBeenCalled()
  })
})

// ─── L98: cooldown boundary < 5000 ───────────────────────────────────────────
describe('useTaskRefresh — notification cooldown boundary: < 5000ms (L98)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
    vi.useRealTimers()
  })

  it('blocks second notification at 4999ms (still < 5000)', async () => {
    const now = 1_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91001
    const taskRef = ref([{ id: taskId, title: 'B1', status: 'todo', agent_name: 'a' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    // First call — fires notification, records _lastNotifTs[taskId] = now
    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    // Advance 4999ms -> now - ts = 4999 < 5000 -> still blocked
    vi.setSystemTime(now + 4999)
    taskRef.value = [{ id: taskId, title: 'B1', status: 'todo', agent_name: 'a' }] as never
    await refresh()

    expect(mockCtor.mock.calls.length).toBe(count1) // blocked
  })

  it('allows second notification at exactly 5000ms (not < 5000)', async () => {
    const now = 2_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91002
    const taskRef = ref([{ id: taskId, title: 'B2', status: 'todo', agent_name: 'b' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    // Advance exactly 5000ms -> now - ts = 5000, which is NOT < 5000 -> allowed
    vi.setSystemTime(now + 5000)
    taskRef.value = [{ id: taskId, title: 'B2', status: 'todo', agent_name: 'b' }] as never
    await refresh()

    expect(mockCtor.mock.calls.length).toBe(count1 + 1) // allowed
  })

  it('allows second notification at 5001ms (clearly past cooldown)', async () => {
    const now = 3_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91003
    const taskRef = ref([{ id: taskId, title: 'B3', status: 'todo', agent_name: 'c' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    vi.setSystemTime(now + 5001)
    taskRef.value = [{ id: taskId, title: 'B3', status: 'todo', agent_name: 'c' }] as never
    await refresh()

    expect(mockCtor.mock.calls.length).toBe(count1 + 1)
  })

  it('nullish coalescing: new task (no prior entry) fires immediately', async () => {
    const now = 10_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91004
    const taskRef = ref([{ id: taskId, title: 'New', status: 'todo', agent_name: 'd' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    expect(mockCtor).toHaveBeenCalled()
  })
})
