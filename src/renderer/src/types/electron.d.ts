import type { FileNode, AgentGroup } from '@renderer/types'

export {}

declare global {
  interface Window {
    electronAPI: {
      selectProjectDir(): Promise<{ projectPath: string; dbPath: string | null; error: string | null; hasCLAUDEmd: boolean } | null>
      createProjectDb(projectPath: string, lang?: string): Promise<{ success: boolean; dbPath: string; error?: string }>
      queryDb(dbPath: string, query: string, params?: unknown[]): Promise<unknown[]>
      watchDb(dbPath: string): Promise<void>
      unwatchDb(): Promise<void>
      onDbChanged(callback: () => void): () => void
      showConfirmDialog(opts: { title: string; message: string; detail?: string }): Promise<boolean>
      selectNewProjectDir(): Promise<string | null>
      initNewProject(projectPath: string): Promise<{ success: boolean; error?: string }>
      findProjectDb(projectPath: string): Promise<string | null>
      migrateDb(dbPath: string): Promise<{ success: boolean; error?: string }>
      // File system
      fsListDir(dirPath: string): Promise<FileNode[]>
      fsReadFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>
      fsWriteFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>
      windowMinimize(): Promise<void>
      windowMaximize(): Promise<void>
      windowClose(): Promise<void>
      closeAgentSessions(dbPath: string, agentName: string): Promise<{ success: boolean; error?: string }>
      renameAgent(dbPath: string, agentId: number, newName: string): Promise<{ success: boolean; error?: string }>
      updatePerimetre(dbPath: string, id: number, oldName: string, newName: string, description: string): Promise<{ success: boolean; error?: string }>
      updateAgentSystemPrompt(dbPath: string, agentId: number, systemPrompt: string): Promise<{ success: boolean; error?: string }>
      buildAgentPrompt(agentName: string, userPrompt: string): Promise<string>
      searchTasks(
        dbPath: string,
        query: string,
        filters?: { status?: string; agent_id?: number; scope?: string }
      ): Promise<{ success: boolean; results: unknown[]; error?: string }>
      // Config DB
      getConfigValue(dbPath: string, key: string): Promise<{ success: boolean; value: string | null; error?: string }>
      setConfigValue(dbPath: string, key: string, value: string): Promise<{ success: boolean; error?: string }>
      // Agents
      updateAgent(dbPath: string, agentId: number, updates: { name?: string; type?: string; scope?: string | null; thinkingMode?: string | null; allowedTools?: string | null; systemPrompt?: string | null; systemPromptSuffix?: string | null; autoLaunch?: boolean; permissionMode?: 'default' | 'auto' | null; maxSessions?: number }): Promise<{ success: boolean; error?: string }>
      createAgent(dbPath: string, projectPath: string, data: { name: string; type: string; scope: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }): Promise<{ success: boolean; agentId?: number; claudeMdUpdated?: boolean; error?: string }>
      // Task assignees (multi-agent — ADR-008)
      getTaskAssignees(dbPath: string, taskId: number): Promise<{ success: boolean; assignees: Array<{ agent_id: number; agent_name: string; role: string | null; assigned_at: string }>; error?: string }>
      setTaskAssignees(dbPath: string, taskId: number, assignees: Array<{ agentId: number; role?: string | null }>): Promise<{ success: boolean; error?: string }>
      tasksGetArchived(dbPath: string, params: { page: number; pageSize: number; agentId?: number | null; scope?: string | null }): Promise<{ rows: unknown[]; total: number }>
      deleteAgent(dbPath: string, agentId: number): Promise<{ success: boolean; hasHistory?: boolean; error?: string }>
      addPerimetre(dbPath: string, name: string): Promise<{ success: boolean; id?: number; error?: string }>
      tasksUpdateStatus(dbPath: string, taskId: number, status: string): Promise<{ success: boolean; error?: string }>
      duplicateAgent(dbPath: string, agentId: number): Promise<{ success: boolean; agentId?: number; name?: string; error?: string }>
      getTaskLinks(dbPath: string, taskId: number): Promise<{ success: boolean; links: Array<{ id: number; type: string; from_task: number; to_task: number; from_title: string; from_status: string; to_title: string; to_status: string }>; error?: string }>
      // Agent groups (T556/T557/T945/T946)
      agentGroupsList(dbPath: string): Promise<{ success: boolean; groups: AgentGroup[]; error?: string }>
      agentGroupsCreate(dbPath: string, name: string, parentId?: number | null): Promise<{ success: boolean; group?: { id: number; name: string; sort_order: number; parent_id: number | null; created_at: string }; error?: string }>
      agentGroupsRename(dbPath: string, groupId: number, name: string): Promise<{ success: boolean; error?: string }>
      agentGroupsDelete(dbPath: string, groupId: number): Promise<{ success: boolean; error?: string }>
      agentGroupsSetMember(dbPath: string, agentId: number, groupId: number | null, sortOrder?: number): Promise<{ success: boolean; error?: string }>
      agentGroupsReorder(dbPath: string, groupIds: number[]): Promise<{ success: boolean; error?: string }>
      agentGroupsSetParent(dbPath: string, groupId: number, parentId: number | null): Promise<{ success: boolean; error?: string }>
      // Detect Claude Code instances (WSL distros and/or native installs) (T721/T775)
      getClaudeInstances(): Promise<Array<{ distro: string; version: string; isDefault: boolean; type?: 'wsl' | 'local' }>>
      // Detect all CLI instances across supported coding agents (T1011)
      getCliInstances(clis?: string[]): Promise<Array<{ cli: string; distro: string; version: string; isDefault: boolean; type: 'wsl' | 'local' }>>
      // Host platform identifier, e.g. 'win32', 'darwin', 'linux'
      platform: string
      // Agent stream (ADR-009: child_process.spawn + stdio:pipe — T647/T648)
      agentCreate(opts?: { projectPath?: string; workDir?: string; wslDistro?: string; systemPrompt?: string; thinkingMode?: string; claudeCommand?: string; convId?: string; permissionMode?: string; cli?: string }): Promise<string>
      agentSend(id: string, text: string): Promise<void>
      agentKill(id: string): Promise<void>
      onAgentStream(id: string, cb: (event: Record<string, unknown>) => void): () => void
      onAgentConvId(id: string, cb: (convId: string) => void): () => void
      onAgentExit(id: string, cb: (exitCode: number | null) => void): () => void
      openWslTerminal(): Promise<{ success: boolean; error?: string }>
      /** Open a URL in the system default browser. Only http/https URLs are allowed (security). */
      openExternal(url: string): Promise<void>
      /** Git log with task ID extraction (T760/T761). Returns [] when not a git repo. */
      gitLog(projectPath: string, options?: { limit?: number; since?: string }): Promise<Array<{ hash: string; date: string; subject: string; author: string; taskIds: number[] }>>
      /** Create a git worktree for multi-instance isolation (ADR-006). */
      worktreeCreate(projectPath: string, sessionId: string, agentName: string): Promise<{ success: boolean; workDir?: string; error?: string }>
      /** Subscribe to Claude Code hook events (SessionStart, SubagentStart/Stop, PreToolUse, PostToolUse). Returns unsubscribe fn. */
      onHookEvent(callback: (event: { event: string; payload: unknown; ts: number }) => void): () => void
      /** Quality stats per agent: total tasks, rejections, rejection rate (T770). Heuristic-based. */
      tasksQualityStats(dbPath: string, params?: { scope?: string | null }): Promise<{ success: boolean; rows: unknown[]; error?: string }>
      /** Export project.db as ZIP to ~/Downloads (T771/T833). */
      projectExportZip(dbPath: string): Promise<{ success: boolean; path?: string; error?: string }>
      /** Auto-updater (T862/T864): check, download, install, events. */
      updater?: {
        check(): Promise<unknown>
        download(): Promise<unknown>
        install(): Promise<void>
        on(event: 'available' | 'not-available' | 'progress' | 'downloaded' | 'error', cb: (data: unknown) => void): () => void
      }
    }
  }
}
