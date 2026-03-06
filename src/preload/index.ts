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
 *- **Agents**: createAgent, updateAgent, renameAgent, buildAgentPrompt, etc.
 * - **Config**: getConfigValue, setConfigValue
 * - **GitHub**: checkForUpdates
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

  createProjectDb: (projectPath: string, lang?: string): Promise<{ success: boolean; dbPath: string; error?: string }> =>
    ipcRenderer.invoke('create-project-db', projectPath, lang),

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

  // GitHub (public repo — no auth required)
  checkForUpdates: (dbPath: string, repoUrl: string, currentVersion: string): Promise<{ hasUpdate: boolean; latestVersion: string; error?: string }> =>
    ipcRenderer.invoke('check-for-updates', dbPath, repoUrl, currentVersion),

  // Task assignees (multi-agent — ADR-008)
  getTaskAssignees: (dbPath: string, taskId: number): Promise<{ success: boolean; assignees: Array<{ agent_id: number; agent_name: string; role: string | null; assigned_at: string }>; error?: string }> =>
    ipcRenderer.invoke('task:getAssignees', dbPath, taskId),

  setTaskAssignees: (dbPath: string, taskId: number, assignees: Array<{ agentId: number; role?: string | null }>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('task:setAssignees', dbPath, taskId, assignees),

  // WSL — detect distros with Claude Code installed (T721: restored after terminal.ts removal)
  getClaudeInstances: (): Promise<unknown[]> =>
    ipcRenderer.invoke('wsl:getClaudeInstances'),

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

  // Task dependency links
  getTaskLinks: (dbPath: string, taskId: number): Promise<{ success: boolean; links: Array<{ id: number; type: string; from_task: number; to_task: number; from_titre: string; from_statut: string; to_titre: string; to_statut: string }>; error?: string }> =>
    ipcRenderer.invoke('task:getLinks', dbPath, taskId),

  // T518: Collect token stats from JSONL for the latest completed session
  collectSessionTokens: (dbPath: string, agentName: string): Promise<{ success: boolean; tokens?: { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number }; error?: string }> =>
    ipcRenderer.invoke('session:collectTokens', dbPath, agentName),

  // T556: Agent groups CRUD
  agentGroupsList: (dbPath: string): Promise<{ success: boolean; groups: Array<{ id: number; name: string; sort_order: number; parent_id: number | null; created_at: string; members: Array<{ agent_id: number; sort_order: number }> }>; error?: string }> =>
    ipcRenderer.invoke('agent-groups:list', dbPath),

  agentGroupsCreate: (dbPath: string, name: string, parentId?: number | null): Promise<{ success: boolean; group?: { id: number; name: string; sort_order: number; parent_id: number | null; created_at: string }; error?: string }> =>
    ipcRenderer.invoke('agent-groups:create', dbPath, name, parentId),

  agentGroupsRename: (dbPath: string, groupId: number, name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent-groups:rename', dbPath, groupId, name),

  agentGroupsDelete: (dbPath: string, groupId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent-groups:delete', dbPath, groupId),

  agentGroupsSetMember: (dbPath: string, agentId: number, groupId: number | null, sortOrder?: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent-groups:setMember', dbPath, agentId, groupId, sortOrder),

  agentGroupsReorder: (dbPath: string, groupIds: number[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent-groups:reorder', dbPath, groupIds),

  // T945: Set parent group for hierarchy
  agentGroupsSetParent: (dbPath: string, groupId: number, parentId: number | null): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent-groups:setParent', dbPath, groupId, parentId),

  // ── Agent stream (ADR-009: child_process.spawn + stdio:pipe) ──────────────

  /**
   * Spawn a Claude agent process using child_process.spawn + stdio:pipe.
   * Returns an id to use with agentSend/agentKill/onAgentStream.
   * First user message must be sent via agentSend after creation.
   */
  agentCreate: (opts?: {
    cols?: number
    rows?: number
    projectPath?: string
    workDir?: string
    wslDistro?: string
    systemPrompt?: string
    thinkingMode?: string
    claudeCommand?: string
    convId?: string
    permissionMode?: string
    dbPath?: string
    sessionId?: number
  }): Promise<string> =>
    ipcRenderer.invoke('agent:create', opts ?? {}),

  /** Send a multi-turn user message to the agent process via stdin JSONL. */
  agentSend: (id: string, text: string): Promise<void> =>
    ipcRenderer.invoke('agent:send', id, text),

  /** Kill the agent process. */
  agentKill: (id: string): Promise<void> =>
    ipcRenderer.invoke('agent:kill', id),

  /** Subscribe to JSONL stream events from the agent process. Returns unsubscribe fn. */
  onAgentStream: (id: string, cb: (event: Record<string, unknown>) => void): (() => void) => {
    const channel = `agent:stream:${id}`
    const handler = (_: unknown, event: Record<string, unknown>) => cb(event)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  /** Subscribe to the convId extracted from the system:init event. Returns unsubscribe fn. */
  onAgentConvId: (id: string, cb: (convId: string) => void): (() => void) => {
    const channel = `agent:convId:${id}`
    const handler = (_: unknown, convId: string) => cb(convId)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  /** Subscribe to the exit event when the agent process closes. Returns unsubscribe fn. */
  onAgentExit: (id: string, cb: (exitCode: number | null) => void): (() => void) => {
    const channel = `agent:exit:${id}`
    const handler = (_: unknown, exitCode: number | null) => cb(exitCode)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  /** Open an external WSL terminal window (wt.exe → wsl:// → wsl.exe fallback). */
  openWslTerminal: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('wsl:openTerminal'),

  /** Open a URL in the system default browser. Only http/https URLs are allowed. */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  // Hook events — pushed by hookServer when Claude Code lifecycle hooks fire (T741)
  onHookEvent: (callback: (event: { event: string; payload: unknown; ts: number }) => void): (() => void) => {
    const handler = (_: unknown, data: { event: string; payload: unknown; ts: number }) => callback(data)
    ipcRenderer.on('hook:event', handler)
    return () => ipcRenderer.off('hook:event', handler)
  },

  /** Get git log for the given project path. Returns parsed commits with task mentions. */
  gitLog: (projectPath: string, options?: { limit?: number; since?: string }): Promise<Array<{ hash: string; date: string; subject: string; author: string; taskIds: number[] }>> =>
    ipcRenderer.invoke('git:log', projectPath, options),

  /** Persist cost_usd, duration_ms, num_turns from the Claude result event into the session row. */
  sessionUpdateResult: (dbPath: string, sessionId: number, data: { cost_usd?: number | null; duration_ms?: number | null; num_turns?: number | null }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('session:updateResult', dbPath, sessionId, data),

  /** Aggregate cost/duration/token stats per agent and period. */
  sessionsStatsCost: (dbPath: string, params: { period: 'day' | 'week' | 'month'; agentId?: number; limit?: number }): Promise<{ success: boolean; rows: unknown[]; error?: string }> =>
    ipcRenderer.invoke('sessions:statsCost', dbPath, params),

  /** Export project.db as a ZIP archive to the Downloads folder. */
  projectExportZip: (dbPath: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:exportZip', dbPath),

  /** Quality stats per agent: total tasks, rejections, rejection rate. */
  tasksQualityStats: (dbPath: string, params?: { perimetre?: string | null }): Promise<{ success: boolean; rows: unknown[]; error?: string }> =>
    ipcRenderer.invoke('tasks:qualityStats', dbPath, params),

  /** Scan project source files and return LOC stats per language. */
  telemetryScan: (projectPath: string): Promise<{ languages: Array<{ name: string; color: string; files: number; lines: number; percent: number }>; totalFiles: number; totalLines: number; scannedAt: string }> =>
    ipcRenderer.invoke('telemetry:scan', projectPath),

  // Auto-updater (GitHub Releases — public repo)
  updater: {
    /** Trigger an update check (no-op in dev). */
    check: (): Promise<unknown> =>
      ipcRenderer.invoke('updater:check'),

    /** Start downloading the available update (no-op in dev). */
    download: (): Promise<unknown> =>
      ipcRenderer.invoke('updater:download'),

    /** Quit and install the downloaded update. */
    install: (): Promise<void> =>
      ipcRenderer.invoke('updater:install'),

    /** Subscribe to an update event. Returns an unsubscribe function. */
    on: (event: 'available' | 'not-available' | 'progress' | 'downloaded' | 'error', cb: (data: unknown) => void): (() => void) => {
      const channel = `update:${event}`
      const handler = (_: unknown, data: unknown) => cb(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.off(channel, handler)
    },
  },

})
