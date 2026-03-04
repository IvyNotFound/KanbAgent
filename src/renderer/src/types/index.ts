/**
 * Shared TypeScript types for agent-viewer.
 *
 * Defines all interfaces used across the renderer (stores, components, utils).
 * These types mirror the SQLite schema defined in `.claude/SETUP.md`.
 *
 * @module types
 */

/** Agent record from the `agents` table, enriched with latest session info. */
export interface Agent {
  id: number
  name: string
  type: string
  perimetre: string | null
  system_prompt: string | null
  system_prompt_suffix: string | null
  thinking_mode: 'auto' | 'disabled' | null
  allowed_tools: string | null
  /** Whether to auto-launch a session for this agent (1=yes, 0=no). DEFAULT 1. */
  auto_launch: number
  /** Permission mode for Claude Code launches: 'default' (approval prompts) or 'auto' (--dangerously-skip-permissions). */
  permission_mode: string | null
  /** Maximum number of parallel active sessions for this agent. DEFAULT 3. */
  max_sessions: number
  created_at: string
  /** Session statut (English, migrated from French in T329). */
  session_statut?: 'started' | 'completed' | 'blocked' | null
  session_started_at?: string | null
  last_log_at?: string | null
  /** 1 if the agent has associated sessions, tasks, comments, or logs; 0 otherwise. */
  has_history?: number
}

/** Task statut values (English, as stored in DB from v0.4.0+). */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'archived'

/** Task priority values. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'

/** Task record from the `tasks` table, enriched with agent names via JOINs. */
export interface Task {
  id: number
  titre: string
  description: string | null
  statut: TaskStatus
  agent_assigne_id: number
  agent_createur_id: number
  agent_valideur_id: number | null
  agent_name: string | null
  agent_createur_name: string | null
  agent_perimetre: string | null
  parent_task_id: number | null
  session_id: number | null
  perimetre: string | null
  effort: 1 | 2 | 3 | null
  priority: TaskPriority
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  validated_at: string | null
}

/** Task assignee from the `task_agents` table, enriched with agent name. */
export interface TaskAssignee {
  agent_id: number
  agent_name: string
  role: 'primary' | 'support' | 'reviewer' | null
  assigned_at: string
}

/** Comment on a task, from the `task_comments` table. */
export interface TaskComment {
  id: number
  task_id: number
  agent_id: number
  agent_name: string | null
  contenu: string
  created_at: string
}

/** Task dependency link from the `task_links` table. */
export interface TaskLink {
  id: number
  type: string
  from_task: number
  to_task: number
  from_titre: string
  from_statut: string
  to_titre: string
  to_statut: string
}

/** File lock record from the `locks` table. */
export interface Lock {
  id: number
  fichier: string
  agent_id: number
  agent_name: string
  session_id: number | null
  created_at: string
  released_at: string | null
}

/** Task count statistics grouped by status. */
export interface Stats {
  todo: number
  in_progress: number
  done: number
  archived: number
}

/** Perimeter (scope) record from the `perimetres` table. */
export interface Perimetre {
  id: number
  name: string
  dossier: string | null
  techno: string | null
  description: string | null
  actif: number
}

/** File tree node used by ExplorerView. */
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

/**
 * A Claude Code installation detected in a WSL distro.
 * Used by LaunchSessionModal to let the user pick which environment to launch Claude in.
 */
export interface ClaudeInstance {
  /** WSL distro name (e.g. "Ubuntu-24.04") or "local" for native installs */
  distro: string
  /** Claude Code version string (e.g. "2.1.58") */
  version: string
  /** Whether this is the default WSL distro */
  isDefault: boolean
  /** Wrapper scripts in ~/bin/ matching claude(-[a-z0-9-]+)? */
  profiles: string[]
  /** Instance type: "wsl" for WSL distros, "local" for native installs. Optional for backward compat. */
  type?: 'wsl' | 'local'
}

/** Agent session record from the `sessions` table. */
export interface Session {
  id: number
  agent_id: number
  started_at: string
  ended_at: string | null
  updated_at: string
  statut: 'started' | 'completed' | 'blocked'
  summary: string | null
  claude_conv_id: string | null
  tokens_in: number
  tokens_out: number
  tokens_cache_read: number
  tokens_cache_write: number
}

/** Agent group record from the `agent_groups` table, with members. */
export interface AgentGroup {
  id: number
  name: string
  sort_order: number
  created_at: string
  members: Array<{ agent_id: number; sort_order: number }>
}

/** Agent log entry from the `agent_logs` table. */
export interface AgentLog {
  id: number
  session_id: number
  agent_id: number
  agent_name: string | null
  agent_type: string | null
  niveau: 'info' | 'warn' | 'error' | 'debug'
  action: string
  detail: string | null
  fichiers: string | null
  created_at: string
}
