import { vi } from 'vitest'
import { createTestingPinia } from '@pinia/testing'

// Mock window.electronAPI for tests
const mockElectronAPI = {
  selectProjectDir: vi.fn(),
  createProjectDb: vi.fn(),
  queryDb: vi.fn(),
  watchDb: vi.fn(),
  unwatchDb: vi.fn(),
  onDbChanged: vi.fn(() => () => {}),
  showConfirmDialog: vi.fn(),
  selectNewProjectDir: vi.fn(),
  initNewProject: vi.fn(),
  findProjectDb: vi.fn(),
  migrateDb: vi.fn(),
  getLocks: vi.fn(),
  fsListDir: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  windowMinimize: vi.fn(),
  windowMaximize: vi.fn(),
  windowClose: vi.fn(),
  windowIsMaximized: vi.fn(),
  onWindowStateChange: vi.fn(() => () => {}),
  getWslUsers: vi.fn(),
  getClaudeProfiles: vi.fn(),
  getClaudeInstances: vi.fn(),
  terminalCreate: vi.fn(),
  terminalWrite: vi.fn(),
  terminalResize: vi.fn(),
  terminalKill: vi.fn(),
  onTerminalData: vi.fn(() => () => {}),
  onTerminalExit: vi.fn(() => () => {}),
  closeAgentSessions: vi.fn(),
  renameAgent: vi.fn(),
  updatePerimetre: vi.fn(),
  updateAgentSystemPrompt: vi.fn(),
  buildAgentPrompt: vi.fn(),
  getAgentSystemPrompt: vi.fn(),
  updateAgentThinkingMode: vi.fn(),
  updateAgent: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  checkMasterClaudeMd: vi.fn(),
  applyMasterClaudeMd: vi.fn(),
  createAgent: vi.fn(),
  testGithubConnection: vi.fn(),
  checkForUpdates: vi.fn(),
  searchTasks: vi.fn(),
  onTerminalConvId: vi.fn(() => () => {}),
  setSessionConvId: vi.fn().mockResolvedValue(undefined),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  setTaskAssignees: vi.fn().mockResolvedValue({ success: true }),
}

// Make it available globally (jsdom only — node environment has no window)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
  })
}

// Export for use in tests
export { mockElectronAPI }

// Re-export createTestingPinia for store tests
export { createTestingPinia }
