import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectProjectDir: (): Promise<{ projectPath: string; dbPath: string | null; error: string | null } | null> =>
    ipcRenderer.invoke('select-project-dir'),

  queryDb: (dbPath: string, query: string, params?: unknown[]): Promise<unknown[]> =>
    ipcRenderer.invoke('query-db', dbPath, query, params ?? []),

  watchDb: (dbPath: string): Promise<void> =>
    ipcRenderer.invoke('watch-db', dbPath),

  unwatchDb: (dbPath?: string): Promise<void> =>
    ipcRenderer.invoke('unwatch-db', dbPath),

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

  migrateDb: (dbPath: string): Promise<{ success: boolean; error?: string; migrated?: number }> =>
    ipcRenderer.invoke('migrate-db', dbPath),

  getLocks: (dbPath: string): Promise<unknown[]> =>
    ipcRenderer.invoke('get-locks', dbPath),

  getLocksCount: (dbPath: string): Promise<number> =>
    ipcRenderer.invoke('get-locks-count', dbPath),

  // File system (with allowedDir for security - restricts access to project directory)
  fsListDir: (dirPath: string, allowedDir?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('fs:listDir', dirPath, allowedDir),

  fsReadFile: (filePath: string, allowedDir?: string): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('fs:readFile', filePath, allowedDir),

  fsWriteFile: (filePath: string, content: string, allowedDir?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content, allowedDir),

  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  onWindowStateChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_: unknown, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window-state-changed', handler)
    return () => ipcRenderer.off('window-state-changed', handler)
  },

  // Terminal
  getWslUsers: (): Promise<string[]> =>
    ipcRenderer.invoke('terminal:getWslUsers'),

  getClaudeProfiles: (wslUser?: string): Promise<string[]> =>
    ipcRenderer.invoke('terminal:getClaudeProfiles', wslUser),

  /** Detect WSL distros that have Claude Code installed (replaces raw WSL user selection). */
  getClaudeInstances: (): Promise<unknown[]> =>
    ipcRenderer.invoke('terminal:getClaudeInstances'),

  terminalCreate: (cols: number, rows: number, projectPath?: string, wslDistro?: string, systemPrompt?: string, userPrompt?: string, thinkingMode?: string, claudeCommand?: string, convId?: string): Promise<string> =>
    ipcRenderer.invoke('terminal:create', cols, rows, projectPath, wslDistro, systemPrompt, userPrompt, thinkingMode, claudeCommand, convId),

  terminalWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:write', id, data),

  terminalResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', id, cols, rows),

  terminalKill: (id: string): Promise<void> =>
    ipcRenderer.invoke('terminal:kill', id),

  onTerminalData: (id: string, cb: (data: string) => void): (() => void) => {
    const channel = `terminal:data:${id}`
    const handler = (_: unknown, data: string) => cb(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  onTerminalExit: (id: string, cb: () => void): (() => void) => {
    const channel = `terminal:exit:${id}`
    const handler = () => cb()
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

  getAgentSystemPrompt: (dbPath: string, agentId: number): Promise<{ success: boolean; systemPrompt: string | null; systemPromptSuffix: string | null; thinkingMode: string | null; error?: string }> =>
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

  // Search tasks
  searchTasks: (
    dbPath: string,
    query: string,
    filters?: { statut?: string; agent_id?: number; perimetre?: string }
  ): Promise<{ success: boolean; results: unknown[]; error?: string }> =>
    ipcRenderer.invoke('search-tasks', dbPath, query, filters),
})
