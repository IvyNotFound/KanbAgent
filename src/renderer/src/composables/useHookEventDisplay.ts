/**
 * Shared display constants and helpers for Claude Code hook events.
 *
 * Used by HookEventBar.vue, HookEventsView.vue, and other hook-event consumers.
 */
import { isDark } from '@renderer/utils/agentColor'

/** Icon/symbol for each hook event type. ASCII only — no emoji. */
export const EVENT_ICON: Record<string, string> = {
  PreToolUse:         '⚙',
  PostToolUse:        '✓',
  PostToolUseFailure: '✗',
  SessionStart:       '▶',
  SubagentStart:      '→',
  SubagentStop:       '✕',
  PermissionRequest:  '[?]',
  Notification:       '[!]',
  UserPromptSubmit:   '>',
  PreCompact:         '[~]',
  Stop:               '■',
}

/** Hex color per built-in tool name (dark mode). */
export const TOOL_COLOR: Record<string, string> = {
  Bash:      '#fbbf24',
  Read:      '#38bdf8',
  Write:     '#34d399',
  Edit:      '#34d399',
  Glob:      '#a78bfa',
  Grep:      '#a78bfa',
  Agent:     '#f472b6',
  WebFetch:  '#60a5fa',
  WebSearch: '#60a5fa',
  TodoWrite: '#fb923c',
}

/** Hex color per built-in tool name (light mode). */
const TOOL_COLOR_LIGHT: Record<string, string> = {
  Bash:      '#d97706',
  Read:      '#0284c7',
  Write:     '#059669',
  Edit:      '#059669',
  Glob:      '#7c3aed',
  Grep:      '#7c3aed',
  Agent:     '#db2777',
  WebFetch:  '#2563eb',
  WebSearch: '#2563eb',
  TodoWrite: '#ea580c',
}

/** Hex color for specific event types — dark mode. */
export const EVENT_COLOR: Record<string, string> = {
  PostToolUseFailure: '#f87171',
  PermissionRequest:  '#fbbf24',
  PreCompact:         '#fcd34d',
}

/** Hex color for specific event types — light mode. */
const EVENT_COLOR_LIGHT: Record<string, string> = {
  PostToolUseFailure: '#dc2626',
  PermissionRequest:  '#d97706',
  PreCompact:         '#ca8a04',
}

/** Returns true when a tool name is from an MCP server (contains ':'). */
export function isMcpTool(name: string): boolean {
  return name.includes(':')
}

/** Hex color for MCP tools (theme-aware). */
export function mcpToolColor(): string {
  return isDark() ? '#2dd4bf' : '#0d9488'
}

/** Returns the icon for an event type. Falls back to '·'. */
export function eventIcon(event: string): string {
  return EVENT_ICON[event] ?? '·'
}

/** Returns the hex color for a tool name (theme-aware). */
export function toolColor(name: string): string {
  if (isMcpTool(name)) return mcpToolColor()
  const map = isDark() ? TOOL_COLOR : TOOL_COLOR_LIGHT
  return map[name] ?? (isDark() ? '#a1a1aa' : '#71717a')
}

/** Returns the hex color (or CSS variable) for an event type (theme-aware). */
export function eventColor(event: string): string {
  const map = isDark() ? EVENT_COLOR : EVENT_COLOR_LIGHT
  return map[event] ?? 'var(--content-subtle)'
}

/** Extracts tool_name from a hook event payload. Returns '?' if not present. */
export function toolName(payload: unknown): string {
  return (payload as Record<string, unknown>)?.tool_name as string ?? '?'
}
