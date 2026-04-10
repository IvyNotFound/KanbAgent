/**
 * Shared helpers for useTaskRefresh-gaps split test files.
 * Extracted from useTaskRefresh-gaps.spec.ts (T1314).
 */
import { vi } from 'vitest'
import { ref } from 'vue'
import type { TaskRefreshDeps } from '@renderer/stores/useTaskRefresh'

// ─── electronAPI mock ─────────────────────────────────────────────────────────
export const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn(),
  unwatchDb: vi.fn(),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  findProjectDb: vi.fn().mockResolvedValue(null),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
}

export function installElectronAPI(): void {
  Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true })
}

// ─── helpers ──────────────────────────────────────────────────────────────────
export function makeDeps(overrides: Partial<TaskRefreshDeps> = {}): TaskRefreshDeps {
  return {
    dbPath: ref('/test/project.db'),
    tasks: ref([]),
    agents: ref([]),
    perimetresData: ref([]),
    stats: ref({ todo: 0, in_progress: 0, done: 0, archived: 0, rejected: 0 }),
    lastRefresh: ref(null),
    loading: ref(false),
    error: ref(null),
    doneTasksLimited: ref(false),
    boardAssignees: ref(new Map()),
    query: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

/** Query mock that simulates a task transitioning to newStatus on next refresh. */
export function makeTransitionQuery(taskId: number, newStatus: 'in_progress' | 'done') {
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("status IN ('todo', 'in_progress')")) {
      return Promise.resolve(
        newStatus === 'in_progress'
          ? [{ id: taskId, title: 'T', status: 'in_progress', agent_name: 'a' }]
          : []
      )
    }
    if (sql.includes("status = 'done'")) {
      return Promise.resolve(
        newStatus === 'done'
          ? [{ id: taskId, title: 'T', status: 'done', agent_name: 'a' }]
          : []
      )
    }
    return Promise.resolve([])
  })
}

/** Load useTaskRefresh with notifications ENABLED (fresh module). */
export async function loadWithNotifications() {
  vi.resetModules()
  vi.doMock('@renderer/stores/agents', () => ({
    useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
    AGENT_CTE_SQL: 'SELECT * FROM agents',
  }))
  vi.doMock('@renderer/stores/settings', () => ({
    useSettingsStore: () => ({ notificationsEnabled: true }),
  }))
  vi.doMock('@renderer/composables/useToast', () => ({
    useToast: () => ({ push: vi.fn() }),
  }))
  return import('@renderer/stores/useTaskRefresh')
}

/** Load useTaskRefresh with notifications DISABLED (fresh module). */
export async function loadWithoutNotifications() {
  vi.resetModules()
  vi.doMock('@renderer/stores/agents', () => ({
    useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
    AGENT_CTE_SQL: 'SELECT * FROM agents',
  }))
  vi.doMock('@renderer/stores/settings', () => ({
    useSettingsStore: () => ({ notificationsEnabled: false }),
  }))
  vi.doMock('@renderer/composables/useToast', () => ({
    useToast: () => ({ push: vi.fn() }),
  }))
  return import('@renderer/stores/useTaskRefresh')
}

/** Load useTaskRefresh with notifications disabled via inline mocks (no helper). */
export async function loadWithDisabledNotifications() {
  return loadWithoutNotifications()
}
