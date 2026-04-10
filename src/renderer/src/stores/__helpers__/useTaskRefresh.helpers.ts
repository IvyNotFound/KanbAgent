/**
 * Shared helpers for useTaskRefresh spec files.
 */
import { vi } from 'vitest'
import { ref } from 'vue'
import type { TaskRefreshDeps } from '@renderer/stores/useTaskRefresh'

// ─── Mock electronAPI ──────────────────────────────────────────────────────────
export const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  findProjectDb: vi.fn().mockResolvedValue(null),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
}

/**
 * Install mockElectronAPI on window. Call once at module level.
 */
export function installElectronAPIMock(): void {
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
  })
}

// ─── Mock stores registration ────────────────────────────────────────────────
// These must be called via vi.mock() at the top level of each spec file.
// They cannot be shared as function calls because vi.mock is hoisted.

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
