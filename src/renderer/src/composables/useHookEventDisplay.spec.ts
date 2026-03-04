import { describe, it, expect } from 'vitest'
import {
  eventIcon,
  toolColor,
  isMcpTool,
  eventColor,
  toolName,
  EVENT_ICON,
  TOOL_COLOR,
} from './useHookEventDisplay'

describe('useHookEventDisplay — eventIcon() (T779)', () => {
  it('returns correct icon for PreToolUse', () => {
    expect(eventIcon('PreToolUse')).toBe('⚙')
  })

  it('returns correct icon for PostToolUse', () => {
    expect(eventIcon('PostToolUse')).toBe('✓')
  })

  it('returns correct icon for PostToolUseFailure', () => {
    expect(eventIcon('PostToolUseFailure')).toBe('✗')
  })

  it('returns correct icon for SessionStart', () => {
    expect(eventIcon('SessionStart')).toBe('▶')
  })

  it('returns correct icon for Stop', () => {
    expect(eventIcon('Stop')).toBe('■')
  })

  it('returns "·" fallback for unknown event type', () => {
    expect(eventIcon('UnknownEventType')).toBe('·')
    expect(eventIcon('')).toBe('·')
  })

  it('covers all defined EVENT_ICON keys', () => {
    for (const [key, icon] of Object.entries(EVENT_ICON)) {
      expect(eventIcon(key)).toBe(icon)
    }
  })
})

describe('useHookEventDisplay — toolColor() (T779)', () => {
  it('returns text-amber-400 for Bash', () => {
    expect(toolColor('Bash')).toBe('text-amber-400')
  })

  it('returns text-zinc-400 for unknown tool', () => {
    expect(toolColor('UnknownTool')).toBe('text-zinc-400')
    expect(toolColor('')).toBe('text-zinc-400')
  })

  it('returns text-teal-400 for MCP tool (contains ":")', () => {
    expect(toolColor('mcp:something')).toBe('text-teal-400')
    expect(toolColor('server:tool_name')).toBe('text-teal-400')
  })

  it('covers all built-in TOOL_COLOR keys', () => {
    for (const [key, color] of Object.entries(TOOL_COLOR)) {
      expect(toolColor(key)).toBe(color)
    }
  })
})

describe('useHookEventDisplay — isMcpTool() (T779)', () => {
  it('returns true for tool names containing ":"', () => {
    expect(isMcpTool('mcp:something')).toBe(true)
    expect(isMcpTool('server:read_file')).toBe(true)
  })

  it('returns false for built-in tool names without ":"', () => {
    expect(isMcpTool('Bash')).toBe(false)
    expect(isMcpTool('Read')).toBe(false)
    expect(isMcpTool('')).toBe(false)
  })
})

describe('useHookEventDisplay — eventColor() (T779)', () => {
  it('returns text-red-400 for PostToolUseFailure', () => {
    expect(eventColor('PostToolUseFailure')).toBe('text-red-400')
  })

  it('returns text-amber-400 for PermissionRequest', () => {
    expect(eventColor('PermissionRequest')).toBe('text-amber-400')
  })

  it('returns text-content-subtle fallback for unknown event', () => {
    expect(eventColor('SessionStart')).toBe('text-content-subtle')
    expect(eventColor('UnknownEvent')).toBe('text-content-subtle')
  })
})

describe('useHookEventDisplay — toolName() (T779)', () => {
  it('extracts tool_name from payload', () => {
    expect(toolName({ tool_name: 'Bash' })).toBe('Bash')
  })

  it('returns "?" when tool_name is absent', () => {
    expect(toolName({})).toBe('?')
    expect(toolName(null)).toBe('?')
  })
})
