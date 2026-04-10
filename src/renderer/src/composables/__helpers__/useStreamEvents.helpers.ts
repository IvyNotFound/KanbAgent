/**
 * Shared helpers for useStreamEvents split test files.
 */
import { vi } from 'vitest'

// ─── Mock electronAPI ─────────────────────────────────────────────────────────
export const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  findProjectDb: vi.fn().mockResolvedValue(null),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  tasksUpdateStatus: vi.fn().mockResolvedValue({ success: true }),
  agentCreate: vi.fn().mockResolvedValue('agent-1'),
  agentSend: vi.fn().mockResolvedValue(undefined),
  agentKill: vi.fn().mockResolvedValue(undefined),
  onAgentStream: vi.fn(() => () => {}),
  onAgentConvId: vi.fn(() => () => {}),
  onAgentExit: vi.fn(() => () => {}),
  onHookEvent: vi.fn(() => () => {}),
}

export function installMockElectronAPI(): void {
  // Use try/catch to handle the case where electronAPI is already defined
  // without configurable: true from another test file in the same worker.
  try {
    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
      configurable: true,
    })
  } catch {
    (window as any).electronAPI = mockElectronAPI
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function makeTabsStore(activeTabId = 'tab-1') {
  const { useTabsStore } = await import('@renderer/stores/tabs')
  const store = useTabsStore()
  store.$patch({ tabs: [{ id: activeTabId, type: 'terminal', title: 'T', ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, convId: null, viewMode: 'stream' }] })
  store.setActive(activeTabId)
  return store
}
