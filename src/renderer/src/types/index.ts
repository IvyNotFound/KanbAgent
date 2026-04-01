/**
 * Shared TypeScript types for KanbAgent.
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
  scope: string | null
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
  /** Worktree isolation: null=inherit global, 0=disabled, 1=enabled. */
  worktree_enabled: number | null
  /** Preferred CLI model override (e.g. "anthropic/claude-opus-4-5"). Null = use global default. */
  preferred_model: string | null
  created_at: string
  /** Session status. */
  session_status?: 'started' | 'completed' | 'blocked' | null
  session_started_at?: string | null
  /** Total tokens (in + out) for the current active session; null if no active session. */
  session_tokens?: number | null
  last_log_at?: string | null
  /** 1 if the agent has associated sessions, tasks, comments, or logs; 0 otherwise. */
  has_history?: number
}

/** Task status values. */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'archived'

/** Task priority values. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'

/** Task record from the `tasks` table, enriched with agent names via JOINs. */
export interface Task {
  id: number
  title: string
  description: string | null
  status: TaskStatus
  agent_assigned_id: number
  agent_creator_id: number
  agent_validator_id: number | null
  agent_name: string | null
  agent_creator_name: string | null
  agent_scope: string | null
  parent_task_id: number | null
  session_id: number | null
  scope: string | null
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
  content: string
  created_at: string
}

/** Task dependency link from the `task_links` table. */
export interface TaskLink {
  id: number
  type: string
  from_task: number
  to_task: number
  from_title: string
  from_status: string
  to_title: string
  to_status: string
}

/** Task count statistics grouped by status. */
export interface Stats {
  todo: number
  in_progress: number
  done: number
  archived: number
}

/** Scope record from the `scopes` table. */
export interface Perimetre {
  id: number
  name: string
  folder: string | null
  techno: string | null
  description: string | null
  active: number
}

/** File tree node used by ExplorerView. */
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

/**
 * A Claude Code installation detected in a WSL distro or natively on the host.
 * Used by LaunchSessionModal to let the user pick which environment to launch Claude in.
 */
export interface ClaudeInstance {
  /** WSL distro name (e.g. "Ubuntu-24.04") or "local" for native installs */
  distro: string
  /** Claude Code version string (e.g. "2.1.58") */
  version: string
  /** Whether this is the default WSL distro */
  isDefault: boolean
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
  status: 'started' | 'completed' | 'blocked'
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
  parent_id: number | null
  created_at: string
  members: Array<{ agent_id: number; sort_order: number }>
  /** Built client-side by buildGroupTree — not from DB directly. */
  children?: AgentGroup[]
}

/** Quality stat row for one agent (from tasks:qualityStats IPC). */
export interface AgentQualityRow {
  agent_id: number
  agent_name: string
  agent_scope: string | null
  total_tasks: number
  rejected_tasks: number
  /** Rejection rate as a percentage (0–100). */
  rejection_rate: number
}

/** Agent log entry from the `agent_logs` table. */
export interface AgentLog {
  id: number
  session_id: number
  agent_id: number
  agent_name: string | null
  agent_type: string | null
  level: 'info' | 'warn' | 'error' | 'debug'
  action: string
  detail: string | null
  files: string | null
  created_at: string
}
