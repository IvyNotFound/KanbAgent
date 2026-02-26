/**
 * Preload script for agent-viewer.
 *
 * Exposes a secure `electronAPI` object to the renderer process via contextBridge.
 * All Node.js / Electron APIs are accessed through IPC invoke/on — no direct
 * access to Node.js modules from the renderer.
 *
 * Channels are grouped by domain:
 * - **DB**: queryDb, watchDb, unwatchDb, onDbChanged, migrateDb, getLocks
 * - **Project**: selectProjectDir, createProjectDb, findProjectDb, initNewProject
 * - **File system**: fsListDir, fsReadFile, fsWriteFile
 * - **Window**: windowMinimize, windowMaximize, windowClose, windowIsMaximized
 * - **Terminal**: terminalCreate, terminalWrite, terminalResize, terminalKill, etc.
 * - **Agents**: createAgent, updateAgent, renameAgent, buildAgentPrompt, etc.
 * - **Config**: getConfigValue, setConfigValue
 * - **GitHub**: testGithubConnection, checkForUpdates, checkMasterClaudeMd
 * - **Search**: searchTasks
 *
 * @module preload
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Project ────────────────────────────────────────────────────────────────

  /** @returns Project path, DB path, and error info — or null if cancelled. */
  selectProjectDir: (): Promise<{ projectPath: string; dbPath: string | null; error: string | null } | null> =>
    ipcRenderer.invoke('select-project-dir'),

  // ── DB ─────────────────────────────────────────────────────────────────────

  /**
   * @param dbPath - Absolute path to the SQLite database.
   * @param query - SQL query string.
   * @param params - Bind parameters for the query.
   * @returns Array of result rows.
   */
  queryDb: (dbPath: string, query: string, params?: unknown[]): Promise<unknown[]> =>
    ipcRenderer.invoke('query-db', dbPath, query, params ?? []),

  /** @param dbPath - DB path to watch for changes (fs.watch). */
  watchDb: (dbPath: string): Promise<void> =>
    ipcRenderer.invoke('watch-db', dbPath),

  /** @param dbPath - Optional DB path to stop watching. Unwatches all if omitted. */
  unwatchDb: (dbPath?: string): Promise<void> =>
    ipcRenderer.invoke('unwatch-db', dbPath),

  /**
   * Subscribe to DB file change notifications.
   * @param callback - Called when the DB file changes on disk.
   * @returns Unsubscribe function.
   */
  onDbChanged: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('db-changed', handler)
    return () => ipcRenderer.off('db-changed', handler)
  },

  showConfirmDialog: (opts: { title: string; message: string; detail?: string }): Promise<boolean> =>
    ipcRenderer.invoke('show-confirm-dialog', opts),

  selectNewProjectDir: (): Promise<string | null> =>
    ipcRenderer.invoke('select-new-project-dir'),

  initNewProject: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('init-new-project', projectPath),

  createProjectDb: (projectPath: string): Promise<{ success: boolean; dbPath: string; error?: string }> =>
    ipcRenderer.invoke('create-project-db', projectPath),

  findProjectDb: (projectPath: string): Promise<string | null> =>
    ipcRenderer.invoke('find-project-db', projectPath),

  /** @param dbPath - Run all pending migrations on the DB. */
  migrateDb: (dbPath: string): Promise<{ success: boolean; error?: string; migrated?: number }> =>
    ipcRenderer.invoke('migrate-db', dbPath),

  getLocks: (dbPath: string): Promise<unknown[]> =>
    ipcRenderer.invoke('get-locks', dbPath),

  // ── File system (with allowedDir for security - restricts access to project directory) ──

  fsListDir: (dirPath: string, allowedDir: string): Promise<unknown[]> =>
    ipcRenderer.invoke('fs:listDir', dirPath, allowedDir),

  fsReadFile: (filePath: string, allowedDir: string): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('fs:readFile', filePath, allowedDir),

  fsWriteFile: (filePath: string, content: string, allowedDir: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content, allowedDir),

  // ── Window ─────────────────────────────────────────────────────────────────

  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  onWindowStateChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_: unknown, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window-state-changed', handler)
    return () => ipcRenderer.off('window-state-changed', handler)
  },

  // ── Terminal ───────────────────────────────────────────────────────────────

  /** @returns List of interactive WSL user names. */
  getWslUsers: (): Promise<string[]> =>
    ipcRenderer.invoke('terminal:getWslUsers'),

  /** @param wslUser - Optional WSL user to scan ~/bin/ for claude-* scripts. */
  getClaudeProfiles: (wslUser?: string): Promise<string[]> =>
    ipcRenderer.invoke('terminal:getClaudeProfiles', wslUser),

  /** @returns Array of ClaudeInstance objects — WSL distros with Claude Code installed. */
  getClaudeInstances: (): Promise<unknown[]> =>
    ipcRenderer.invoke('terminal:getClaudeInstances'),

  terminalCreate: (cols: number, rows: number, projectPath?: string, wslDistro?: string, systemPrompt?: string, userPrompt?: string, thinkingMode?: string, claudeCommand?: string, convId?: string, permissionMode?: string): Promise<string> =>
    ipcRenderer.invoke('terminal:create', cols, rows, projectPath, wslDistro, systemPrompt, userPrompt, thinkingMode, claudeCommand, convId, permissionMode),

  terminalWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:write', id, data),

  terminalResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', id, cols, rows),

  terminalKill: (id: string): Promise<void> =>
    ipcRenderer.invoke('terminal:kill', id),

  terminalIsAlive: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('terminal:isAlive', id),

  onTerminalData: (id: string, cb: (data: string) => void): (() => void) => {
    const channel = `terminal:data:${id}`
    const handler = (_: unknown, data: string) => cb(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  onTerminalExit: (id: string, cb: (info?: {
    exitCode: number | null; isCrash: boolean; isAgent: boolean;
    canResume: boolean; resumeConvId: string | null;
  }) => void): (() => void) => {
    const channel = `terminal:exit:${id}`
    const handler = (_: unknown, info?: {
      exitCode: number | null; isCrash: boolean; isAgent: boolean;
      canResume: boolean; resumeConvId: string | null;
    }) => cb(info)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  // Fires once per terminal session when Claude Code's conversation UUID is detected
  // in the startup banner. Used to store the conv_id for --resume on next launch (task #218).
  onTerminalConvId: (id: string, cb: (convId: string) => void): (() => void) => {
    const channel = `terminal:convId:${id}`
    const handler = (_: unknown, convId: string) => cb(convId)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  // T279: Relaunch a crashed PTY session — returns original launch params
  terminalRelaunch: (oldId: string, useResume?: boolean): Promise<{
    cols: number; rows: number; projectPath?: string; wslDistro?: string;
    systemPrompt?: string; userPrompt?: string; thinkingMode?: string;
    claudeCommand?: string; convId?: string; permissionMode?: string;
  }> => ipcRenderer.invoke('terminal:relaunch', oldId, useResume),

  // T279: Dismiss crash recovery (clean up stored launch params)
  terminalDismissCrash: (id: string): Promise<void> =>
    ipcRenderer.invoke('terminal:dismissCrash', id),

  // T279: Get active PTY session count
  terminalGetActiveCount: (): Promise<number> =>
    ipcRenderer.invoke('terminal:getActiveCount'),

  // T279+T328: Get WSL memory status on demand
  terminalGetMemoryStatus: (): Promise<{
    usedMB: number; totalMB: number; availableMB: number; usedRatio: number;
    warning: boolean; critical: boolean; activeSessions: number;
    dropCachesAvailable: boolean;
  } | null> => ipcRenderer.invoke('terminal:getMemoryStatus'),

  // T279+T328: Listen for periodic memory status broadcasts
  onMemoryStatus: (cb: (status: {
    usedMB: number; totalMB: number; availableMB: number; usedRatio: number;
    warning: boolean; critical: boolean; activeSessions: number;
    dropCachesAvailable: boolean;
  }) => void): (() => void) => {
    const handler = (_: unknown, status: {
      usedMB: number; totalMB: number; availableMB: number; usedRatio: number;
      warning: boolean; critical: boolean; activeSessions: number;
      dropCachesAvailable: boolean;
    }) => cb(status)
    ipcRenderer.on('terminal:memoryStatus', handler)
    return () => ipcRenderer.off('terminal:memoryStatus', handler)
  },

  // T328: Release WSL memory (sync + optional drop_caches)
  terminalReleaseMemory: (): Promise<{ synced: boolean; dropped: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:releaseMemory'),

  setSessionConvId: (dbPath: string, agentId: number, convId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:setConvId', dbPath, agentId, convId),

  closeAgentSessions: (dbPath: string, agentName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('close-agent-sessions', dbPath, agentName),

  renameAgent: (dbPath: string, agentId: number, newName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('rename-agent', dbPath, agentId, newName),

  updatePerimetre: (dbPath: string, id: number, oldName: string, newName: string, description: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update-perimetre', dbPath, id, oldName, newName, description),

  updateAgentSystemPrompt: (dbPath: string, agentId: number, systemPrompt: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update-agent-system-prompt', dbPath, agentId, systemPrompt),

  buildAgentPrompt: (agentName: string, userPrompt: string, dbPath?: string, agentId?: number): Promise<string> =>
    ipcRenderer.invoke('build-agent-prompt', agentName, userPrompt, dbPath, agentId),

  getAgentSystemPrompt: (dbPath: string, agentId: number): Promise<{ success: boolean; systemPrompt: string | null; systemPromptSuffix: string | null; thinkingMode: string | null; permissionMode: string | null; error?: string }> =>
    ipcRenderer.invoke('get-agent-system-prompt', dbPath, agentId),

  updateAgentThinkingMode: (dbPath: string, agentId: number, thinkingMode: string | null): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update-agent-thinking-mode', dbPath, agentId, thinkingMode),

  updateAgent: (dbPath: string, agentId: number, updates: {
    name?: string
    type?: string
    perimetre?: string | null
    thinkingMode?: string | null
    allowedTools?: string | null
    systemPrompt?: string | null
    systemPromptSuffix?: string | null
    autoLaunch?: boolean
    permissionMode?: 'default' | 'auto' | null
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update-agent', dbPath, agentId, updates),

  // Config DB
  getConfigValue: (dbPath: string, key: string): Promise<{ success: boolean; value: string | null; error?: string }> =>
    ipcRenderer.invoke('get-config-value', dbPath, key),

  setConfigValue: (dbPath: string, key: string, value: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-config-value', dbPath, key, value),

  // CLAUDE.md sync
  checkMasterClaudeMd: (dbPath: string): Promise<{ success: boolean; sha?: string; content?: string; upToDate?: boolean; localSha?: string; error?: string }> =>
    ipcRenderer.invoke('check-master-md', dbPath),

  applyMasterClaudeMd: (dbPath: string, projectPath: string, content: string, sha: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('apply-master-md', dbPath, projectPath, content, sha),

  // Agents
  deleteAgent: (dbPath: string, agentId: number): Promise<{ success: boolean; hasHistory?: boolean; error?: string }> =>
    ipcRenderer.invoke('delete-agent', dbPath, agentId),

  addPerimetre: (dbPath: string, name: string): Promise<{ success: boolean; id?: number; error?: string }> =>
    ipcRenderer.invoke('add-perimetre', dbPath, name),

  createAgent: (
    dbPath: string,
    projectPath: string,
    data: { name: string; type: string; perimetre: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }
  ): Promise<{ success: boolean; agentId?: number; claudeMdUpdated?: boolean; error?: string }> =>
    ipcRenderer.invoke('create-agent', dbPath, projectPath, data),

  // GitHub (secure — token stays in main process)
  testGithubConnection: (dbPath: string, repoUrl: string): Promise<{ connected: boolean; error?: string }> =>
    ipcRenderer.invoke('test-github-connection', dbPath, repoUrl),

  checkForUpdates: (dbPath: string, repoUrl: string, currentVersion: string): Promise<{ hasUpdate: boolean; latestVersion: string; error?: string }> =>
    ipcRenderer.invoke('check-for-updates', dbPath, repoUrl, currentVersion),

  // Task assignees (multi-agent — ADR-008)
  getTaskAssignees: (dbPath: string, taskId: number): Promise<{ success: boolean; assignees: Array<{ agent_id: number; agent_name: string; role: string | null; assigned_at: string }>; error?: string }> =>
    ipcRenderer.invoke('task:getAssignees', dbPath, taskId),

  setTaskAssignees: (dbPath: string, taskId: number, assignees: Array<{ agentId: number; role?: string | null }>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('task:setAssignees', dbPath, taskId, assignees),

  // Search tasks
  searchTasks: (
    dbPath: string,
    query: string,
    filters?: { statut?: string; agent_id?: number; perimetre?: string }
  ): Promise<{ success: boolean; results: unknown[]; error?: string }> =>
    ipcRenderer.invoke('search-tasks', dbPath, query, filters),

  // Archived tasks pagination (lazy, independent of main refresh)
  tasksGetArchived: (dbPath: string, params: {
    page: number
    pageSize: number
    agentId?: number | null
    perimetre?: string | null
  }): Promise<{ rows: unknown[]; total: number }> =>
    ipcRenderer.invoke('tasks:getArchived', dbPath, params),

  // Update task status (drag & drop, etc.)
  tasksUpdateStatus: (dbPath: string, taskId: number, statut: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('tasks:updateStatus', dbPath, taskId, statut),

  // Duplicate an agent (copies all fields, generates unique name <name>-copy)
  duplicateAgent: (dbPath: string, agentId: number): Promise<{ success: boolean; agentId?: number; name?: string; error?: string }> =>
    ipcRenderer.invoke('agent:duplicate', dbPath, agentId),
})
