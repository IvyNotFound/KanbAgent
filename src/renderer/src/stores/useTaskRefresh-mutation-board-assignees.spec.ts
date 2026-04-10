/**
 * useTaskRefresh-mutation-board-assignees.spec.ts
 * Split from useTaskRefresh-mutation.spec.ts
 * Targets surviving mutations:
 * - boardAssignees rebuild after refresh (ArithmeticOperator guard)
 * T1348
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { makeDeps, installMockElectronAPI } from './__helpers__/useTaskRefresh-mutation.helpers'

installMockElectronAPI()

vi.mock('@renderer/stores/agents', () => ({
  useAgentsStore: () => ({
    fetchAgentGroups: vi.fn(),
    agentRefresh: vi.fn(),
  }),
  AGENT_CTE_SQL: 'SELECT * FROM agents',
}))

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    notificationsEnabled: true,
    loadWorktreeDefault: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    push: vi.fn(),
  }),
}))


// ─── boardAssignees rebuild after refresh (ArithmeticOperator guard) ──────────
// Mutation target: replace !deps.boardAssignees.value.has() with has()

describe('useTaskRefresh — boardAssignees rebuild correctness', () => {
  const originalNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(global as Record<string, unknown>).Notification = Object.assign(vi.fn(), { permission: 'denied' })
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = originalNotification
  })

  it('new task_id entry is initialized to [] before pushing first assignee', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 7701
    const boardAssignees = ref(new Map<number, { agent_id: number; agent_name: string; role: string | null; assigned_at: string }[]>())
    const queryMock = vi.fn()
      .mockResolvedValueOnce([]) // 1: live tasks
      .mockResolvedValueOnce([]) // 2: done tasks
      .mockResolvedValueOnce([]) // 3: agents (AGENT_CTE_SQL)
      .mockResolvedValueOnce([]) // 4: stats
      .mockResolvedValueOnce([]) // 5: perimetres
      .mockResolvedValueOnce([   // 6: boardAssignees
        { task_id: taskId, agent_id: 10, agent_name: 'dev', role: 'primary' },
      ])

    const deps = makeDeps({ boardAssignees, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    expect(boardAssignees.value.has(taskId)).toBe(true)
    expect(boardAssignees.value.get(taskId)).toHaveLength(1)
    expect(boardAssignees.value.get(taskId)![0].agent_name).toBe('dev')
  })

  it('multiple assignees for same task are all added (not just first)', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 8801
    const boardAssignees = ref(new Map<number, { agent_id: number; agent_name: string; role: string | null; assigned_at: string }[]>())
    const queryMock = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { task_id: taskId, agent_id: 1, agent_name: 'dev-a', role: 'primary' },
        { task_id: taskId, agent_id: 2, agent_name: 'dev-b', role: 'reviewer' },
        { task_id: taskId, agent_id: 3, agent_name: 'dev-c', role: null },
      ])

    const deps = makeDeps({ boardAssignees, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    const assignees = boardAssignees.value.get(taskId)!
    expect(assignees).toHaveLength(3)
    expect(assignees.map(a => a.agent_name)).toEqual(['dev-a', 'dev-b', 'dev-c'])
  })

  it('boardAssignees.clear() is called before rebuild — old stale entries removed', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const boardAssignees = ref(new Map<number, { agent_id: number; agent_name: string; role: string | null; assigned_at: string }[]>())
    boardAssignees.value.set(999, [{ agent_id: 5, agent_name: 'old', role: null, assigned_at: '' }])

    const queryMock = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { task_id: 100, agent_id: 10, agent_name: 'new-dev', role: 'primary' },
      ])

    const deps = makeDeps({ boardAssignees, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    // Stale entry for task 999 must be gone (clear() was called)
    expect(boardAssignees.value.has(999)).toBe(false)
    // New entry for task 100 must be present
    expect(boardAssignees.value.has(100)).toBe(true)
  })
})
