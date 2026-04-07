import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  eventIcon,
  toolColor,
  isMcpTool,
  eventColor,
  toolName,
  mcpToolColor,
  EVENT_ICON,
  TOOL_COLOR,
  EVENT_COLOR,
} from './useHookEventDisplay'
import { setDarkMode } from '@renderer/utils/agentColor'

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

describe('useHookEventDisplay — EVENT_ICON hardcoded values (T1074)', () => {
  it.each([
    ['PreToolUse', '⚙'],
    ['PostToolUse', '✓'],
    ['PostToolUseFailure', '✗'],
    ['SessionStart', '▶'],
    ['SubagentStart', '→'],
    ['SubagentStop', '✕'],
    ['PermissionRequest', '[?]'],
    ['Notification', '[!]'],
    ['UserPromptSubmit', '>'],
    ['PreCompact', '[~]'],
    ['Stop', '■'],
  ] as [string, string][])('EVENT_ICON[%s] === "%s" (not empty)', (key, expected) => {
    expect(EVENT_ICON[key]).toBe(expected)
    expect(EVENT_ICON[key]).not.toBe('')
  })
})

describe('useHookEventDisplay — toolColor() (T779)', () => {
  beforeEach(() => { setDarkMode(true) })
  afterEach(() => { setDarkMode(false) })

  it('returns #fbbf24 for Bash', () => {
    expect(toolColor('Bash')).toBe('#fbbf24')
  })

  it('returns #a1a1aa for unknown tool', () => {
    expect(toolColor('UnknownTool')).toBe('#a1a1aa')
    expect(toolColor('')).toBe('#a1a1aa')
  })

  it('returns #2dd4bf for MCP tool (contains ":")', () => {
    expect(toolColor('mcp:something')).toBe('#2dd4bf')
    expect(toolColor('server:tool_name')).toBe('#2dd4bf')
  })

  it('covers all built-in TOOL_COLOR keys', () => {
    for (const [key, color] of Object.entries(TOOL_COLOR)) {
      expect(toolColor(key)).toBe(color)
    }
  })
})

describe('useHookEventDisplay — TOOL_COLOR hardcoded values (T1074)', () => {
  it.each([
    ['Bash',      '#fbbf24'],
    ['Read',      '#38bdf8'],
    ['Write',     '#34d399'],
    ['Edit',      '#34d399'],
    ['Glob',      '#a78bfa'],
    ['Grep',      '#a78bfa'],
    ['Agent',     '#f472b6'],
    ['WebFetch',  '#60a5fa'],
    ['WebSearch', '#60a5fa'],
    ['TodoWrite', '#fb923c'],
  ] as [string, string][])('TOOL_COLOR[%s] === "%s" (not empty)', (key, expected) => {
    expect(TOOL_COLOR[key]).toBe(expected)
    expect(TOOL_COLOR[key]).not.toBe('')
  })
})

describe('useHookEventDisplay — EVENT_COLOR hardcoded values (T1074)', () => {
  it.each([
    ['PostToolUseFailure', '#f87171'],
    ['PermissionRequest',  '#fbbf24'],
    ['PreCompact',         '#fcd34d'],
  ] as [string, string][])('EVENT_COLOR[%s] === "%s" (not empty)', (key, expected) => {
    expect(EVENT_COLOR[key]).toBe(expected)
    expect(EVENT_COLOR[key]).not.toBe('')
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

describe('useHookEventDisplay — mcpToolColor() (T1074)', () => {
  beforeEach(() => { setDarkMode(true) })
  afterEach(() => { setDarkMode(false) })

  it('returns #2dd4bf in dark mode (not empty string)', () => {
    expect(mcpToolColor()).toBe('#2dd4bf')
    expect(mcpToolColor()).not.toBe('')
  })
})

describe('useHookEventDisplay — eventColor() (T779)', () => {
  beforeEach(() => { setDarkMode(true) })
  afterEach(() => { setDarkMode(false) })

  it('returns #f87171 for PostToolUseFailure', () => {
    expect(eventColor('PostToolUseFailure')).toBe('#f87171')
  })

  it('returns #fbbf24 for PermissionRequest', () => {
    expect(eventColor('PermissionRequest')).toBe('#fbbf24')
  })

  it('returns #fcd34d for PreCompact', () => {
    expect(eventColor('PreCompact')).toBe('#fcd34d')
  })

  it('returns var(--content-subtle) fallback for unknown event', () => {
    expect(eventColor('SessionStart')).toBe('var(--content-subtle)')
    expect(eventColor('UnknownEvent')).toBe('var(--content-subtle)')
    expect(eventColor('')).toBe('var(--content-subtle)')
  })

  it('fallback is not empty string', () => {
    expect(eventColor('SomeUnknown')).not.toBe('')
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

  it('"?" fallback is not empty string', () => {
    expect(toolName(undefined)).toBe('?')
    expect(toolName({ other_key: 'x' })).toBe('?')
  })
})
