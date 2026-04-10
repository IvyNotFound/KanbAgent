/**
 * Shared helpers and mocks for useTabBarGroups test splits.
 */
import { vi } from 'vitest'
import { ref } from 'vue'

// ── Mock electronAPI ─────────────────────────────────────────────────────────
export const mockElectronAPI = {
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
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'NewGroup', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentKill: vi.fn(),
}

/**
 * Install the mock electronAPI on the window object.
 * Must be called at module level (before any test runs).
 */
export function installElectronAPIMock(): void {
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
  })
}

// ── Helper ───────────────────────────────────────────────────────────────────
export function makeScrollContainer(scrollLeft = 0) {
  return ref<HTMLDivElement | null>({
    scrollLeft,
    scrollHeight: 100,
    scrollTop: 0,
    clientHeight: 100,
  } as unknown as HTMLDivElement)
}
