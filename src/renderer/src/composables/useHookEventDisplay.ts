/**
 * Shared display constants and helpers for Claude Code hook events.
 *
 * Used by HookEventBar.vue, HookEventsView.vue, and other hook-event consumers.
 */

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

/** Tailwind color class per built-in tool name. */
export const TOOL_COLOR: Record<string, string> = {
  Bash:      'text-amber-400',
  Read:      'text-sky-400',
  Write:     'text-emerald-400',
  Edit:      'text-emerald-400',
  Glob:      'text-violet-400',
  Grep:      'text-violet-400',
  Agent:     'text-pink-400',
  WebFetch:  'text-blue-400',
  WebSearch: 'text-blue-400',
  TodoWrite: 'text-orange-400',
}

/** Tailwind color class for specific event types (overrides default). */
export const EVENT_COLOR: Record<string, string> = {
  PostToolUseFailure: 'text-red-400',
  PermissionRequest:  'text-amber-400',
  PreCompact:         'text-amber-300',
}

/** Returns true when a tool name is from an MCP server (contains ':'). */
export function isMcpTool(name: string): boolean {
  return name.includes(':')
}

/** Tailwind color class for MCP tools. */
export function mcpToolColor(): string {
  return 'text-teal-400'
}

/** Returns the icon for an event type. Falls back to '·'. */
export function eventIcon(event: string): string {
  return EVENT_ICON[event] ?? '·'
}

/** Returns the Tailwind color class for a tool name. */
export function toolColor(name: string): string {
  if (isMcpTool(name)) return mcpToolColor()
  return TOOL_COLOR[name] ?? 'text-zinc-400'
}

/** Returns the Tailwind color class for an event type. */
export function eventColor(event: string): string {
  return EVENT_COLOR[event] ?? 'text-content-subtle'
}

/** Extracts tool_name from a hook event payload. Returns '?' if not present. */
export function toolName(payload: unknown): string {
  return (payload as Record<string, unknown>)?.tool_name as string ?? '?'
}
