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
  searchTasks: vi.fn(),
  onTerminalConvId: vi.fn(() => () => {}),
  setSessionConvId: vi.fn().mockResolvedValue(undefined),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  setTaskAssignees: vi.fn().mockResolvedValue({ success: true }),
  getTaskLinks: vi.fn().mockResolvedValue({ success: true, links: [] }),
  tasksGetArchived: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  tasksUpdateStatus: vi.fn().mockResolvedValue({ success: true }),
  deleteAgent: vi.fn().mockResolvedValue({ success: true, hasHistory: false }),
  addPerimetre: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  // stream-json IPC (ADR-009 — T578 POC — PTY legacy, kept for TerminalView tests)
  onTerminalStreamMessage: vi.fn(() => () => {}),
  // Agent stream IPC (ADR-009 — T647/T648: child_process.spawn + stdio:pipe)
  agentCreate: vi.fn().mockResolvedValue('agent-1'),
  agentSend: vi.fn().mockResolvedValue(undefined),
  agentKill: vi.fn().mockResolvedValue(undefined),
  onAgentStream: vi.fn(() => () => {}),
  onAgentConvId: vi.fn(() => () => {}),
  onAgentExit: vi.fn(() => () => {}),
  onHookEvent: vi.fn(() => () => {}),
  // Agent groups IPC (T556/T557)
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'New Group', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsReorder: vi.fn().mockResolvedValue({ success: true }),
  sessionsStatsCost: vi.fn().mockResolvedValue({ success: true, rows: [] }),
  projectExportZip: vi.fn().mockResolvedValue({ success: true, path: '/home/user/Downloads/project.zip' }),
  // Telemetry IPC (T810/T842)
  telemetryScan: vi.fn().mockResolvedValue({ languages: [], totalFiles: 0, totalLines: 0, scannedAt: new Date().toISOString() }),
  // Quality stats IPC (T842)
  tasksQualityStats: vi.fn().mockResolvedValue({ success: true, rows: [] }),
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
