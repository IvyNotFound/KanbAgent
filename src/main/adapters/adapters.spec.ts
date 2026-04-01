/**
 * Tests for CLI adapters — buildCommand + parseLine per adapter (T1012).
 *
 * Verifies:
 * - buildCommand returns correct command + args for each CLI
 * - parseLine returns null for empty lines
 * - parseLine returns StreamEvent for JSON lines
 * - parseLine wraps plain text as { type: 'text', text } for non-Claude adapters
 * - claudeAdapter.extractConvId extracts session_id from system:init
 * - getAdapter() returns correct adapter and fallback for unknown CLIs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs for prepareSystemPrompt (file writes)
const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => {
  const fns = { writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync }
  return { default: fns, ...fns }
})

import { claudeAdapter, CLAUDE_CMD_REGEX, buildClaudeCmd, buildWindowsPS1Script } from './claude'
import { codexAdapter } from './codex'
import { geminiAdapter } from './gemini'
import { opencodeAdapter } from './opencode'
import { aiderAdapter } from './aider'
import { gooseAdapter } from './goose'
import { fallbackAdapter } from './fallback'
import { getAdapter } from './index'

// ── getAdapter registry ───────────────────────────────────────────────────────

describe('getAdapter', () => {
  it('returns claudeAdapter for "claude"', () => {
    expect(getAdapter('claude')).toBe(claudeAdapter)
  })

  it('returns codexAdapter for "codex"', () => {
    expect(getAdapter('codex')).toBe(codexAdapter)
  })

  it('returns geminiAdapter for "gemini"', () => {
    expect(getAdapter('gemini')).toBe(geminiAdapter)
  })

  it('returns opencodeAdapter for "opencode"', () => {
    expect(getAdapter('opencode')).toBe(opencodeAdapter)
  })

  it('returns aiderAdapter for "aider"', () => {
    expect(getAdapter('aider')).toBe(aiderAdapter)
  })

  it('returns gooseAdapter for "goose"', () => {
    expect(getAdapter('goose')).toBe(gooseAdapter)
  })

  it('returns fallbackAdapter for unknown CLI', () => {
    expect(getAdapter('unknown-cli-xyz')).toBe(fallbackAdapter)
  })

  it('returns fallbackAdapter for empty string', () => {
    expect(getAdapter('')).toBe(fallbackAdapter)
  })
})

// ── Claude adapter ────────────────────────────────────────────────────────────

describe('claudeAdapter', () => {
  it('has cli = "claude" and binaries = ["claude"]', () => {
    expect(claudeAdapter.cli).toBe('claude')
    expect(claudeAdapter.binaries).toEqual(['claude'])
  })

  it('buildCommand returns bash -l -c with stream-json flags', () => {
    const spec = claudeAdapter.buildCommand({})
    expect(spec.command).toBe('bash')
    expect(spec.args[0]).toBe('-l')
    expect(spec.args[2]).toContain('--output-format stream-json')
  })

  it('buildCommand includes --resume when convId provided', () => {
    const spec = claudeAdapter.buildCommand({ convId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    expect(spec.args[2]).toContain('--resume')
  })

  it('parseLine returns null for non-JSON lines', () => {
    expect(claudeAdapter.parseLine('bash: warning: startup')).toBeNull()
    expect(claudeAdapter.parseLine('')).toBeNull()
  })

  it('parseLine returns parsed object for valid JSON', () => {
    const event = { type: 'assistant', message: { role: 'assistant', content: [] } }
    const result = claudeAdapter.parseLine(JSON.stringify(event))
    expect(result).toEqual(event)
  })

  it('extractConvId returns session_id from system:init event', () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const event = { type: 'system' as const, subtype: 'init', session_id: uuid }
    expect(claudeAdapter.extractConvId!(event)).toBe(uuid)
  })

  it('extractConvId returns null for non-init events', () => {
    const event = { type: 'assistant' as const, message: { role: 'assistant', content: [] } }
    expect(claudeAdapter.extractConvId!(event)).toBeNull()
  })

  it('extractConvId returns null when session_id missing', () => {
    const event = { type: 'system' as const, subtype: 'init' }
    expect(claudeAdapter.extractConvId!(event)).toBeNull()
  })
})

// ── buildClaudeCmd (re-exported from claude adapter) ─────────────────────────

describe('buildClaudeCmd', () => {
  it('defaults to "claude" binary', () => {
    expect(buildClaudeCmd({}).startsWith('claude ')).toBe(true)
  })

  it('uses custom claudeCommand when valid', () => {
    expect(buildClaudeCmd({ claudeCommand: 'claude-dev' }).startsWith('claude-dev ')).toBe(true)
  })

  it('falls back to "claude" for invalid claudeCommand', () => {
    expect(buildClaudeCmd({ claudeCommand: 'rm -rf /' }).startsWith('claude ')).toBe(true)
  })

  it('includes --resume when convId provided', () => {
    expect(buildClaudeCmd({ convId: 'abc-123' })).toContain('--resume abc-123')
  })

  it('includes --append-system-prompt with $(cat ...) when systemPromptFile provided', () => {
    const cmd = buildClaudeCmd({ systemPromptFile: '/tmp/sp.txt' })
    expect(cmd).toContain("--append-system-prompt")
    expect(cmd).toContain("$(cat '/tmp/sp.txt')")
  })

  it('includes --dangerously-skip-permissions for permissionMode=auto', () => {
    expect(buildClaudeCmd({ permissionMode: 'auto' })).toContain('--dangerously-skip-permissions')
  })

  it('includes alwaysThinkingEnabled:false for thinkingMode=disabled', () => {
    const cmd = buildClaudeCmd({ thinkingMode: 'disabled' })
    expect(cmd).toContain('alwaysThinkingEnabled')
    expect(cmd).toContain('false')
  })
})

// ── CLAUDE_CMD_REGEX ──────────────────────────────────────────────────────────

describe('CLAUDE_CMD_REGEX', () => {
  it('matches "claude"', () => expect(CLAUDE_CMD_REGEX.test('claude')).toBe(true))
  it('matches "claude-dev"', () => expect(CLAUDE_CMD_REGEX.test('claude-dev')).toBe(true))
  it('rejects "rm -rf /"', () => expect(CLAUDE_CMD_REGEX.test('rm -rf /')).toBe(false))
  it('rejects "claude; rm -rf"', () => expect(CLAUDE_CMD_REGEX.test('claude; rm -rf')).toBe(false))
})

// ── buildWindowsPS1Script ─────────────────────────────────────────────────────

describe('buildWindowsPS1Script', () => {
  it('includes -p --output-format stream-json', () => {
    const ps1 = buildWindowsPS1Script({})
    expect(ps1).toContain("$a.Add('-p')")
    expect(ps1).toContain("$a.Add('stream-json')")
  })

  it('reads system prompt from file via ReadAllText', () => {
    const ps1 = buildWindowsPS1Script({ spTempFile: 'C:\\Temp\\sp.txt' })
    expect(ps1).toContain('ReadAllText')
    expect(ps1).toContain('C:\\Temp\\sp.txt')
  })

  it('includes --resume for convId', () => {
    const ps1 = buildWindowsPS1Script({ convId: 'aaaa-bbbb' })
    expect(ps1).toContain("$a.Add('--resume')")
  })
})

// ── Codex adapter ─────────────────────────────────────────────────────────────

describe('codexAdapter', () => {
  it('has cli = "codex" and binaries = ["codex"]', () => {
    expect(codexAdapter.cli).toBe('codex')
    expect(codexAdapter.binaries).toEqual(['codex'])
  })

  it('buildCommand includes --approval-mode full-auto', () => {
    const spec = codexAdapter.buildCommand({})
    expect(spec.command).toBe('codex')
    expect(spec.args).toContain('--approval-mode')
    expect(spec.args).toContain('full-auto')
  })

  it('buildCommand includes --instructions with systemPromptFile', () => {
    const spec = codexAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--instructions')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('/tmp/sp.txt')
  })

  it('parseLine returns null for empty string', () => {
    expect(codexAdapter.parseLine('')).toBeNull()
    expect(codexAdapter.parseLine('   ')).toBeNull()
  })

  it('parseLine wraps plain text as { type: "text" }', () => {
    const result = codexAdapter.parseLine('some output line')
    expect(result).toEqual({ type: 'text', text: 'some output line' })
  })

  it('parseLine returns typed event for JSON with type field', () => {
    const event = { type: 'assistant', text: 'hello' }
    expect(codexAdapter.parseLine(JSON.stringify(event))).toEqual(event)
  })

  it('does not implement extractConvId (no stable session ID)', () => {
    expect(codexAdapter.extractConvId).toBeUndefined()
  })

  it('extractTokenUsage returns null when no usage field', () => {
    expect(codexAdapter.extractTokenUsage?.({ type: 'text', text: 'hello' })).toBeNull()
  })

  it('extractTokenUsage extracts input_tokens + output_tokens', () => {
    const event = { type: 'assistant', usage: { input_tokens: 80, output_tokens: 40 } } as any
    expect(codexAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 80, tokensOut: 40 })
  })

  it('extractTokenUsage extracts prompt_tokens + completion_tokens (OpenAI legacy)', () => {
    const event = { type: 'assistant', usage: { prompt_tokens: 60, completion_tokens: 30 } } as any
    expect(codexAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 60, tokensOut: 30 })
  })
})

// ── Gemini adapter ────────────────────────────────────────────────────────────

describe('geminiAdapter', () => {
  it('has cli = "gemini"', () => expect(geminiAdapter.cli).toBe('gemini'))
  it('buildCommand has no -p by default (would crash with empty value)', () => {
    expect(geminiAdapter.buildCommand({}).args).not.toContain('-p')
  })
  it('parseLine wraps text lines as { type: "text" }', () => {
    expect(geminiAdapter.parseLine('output')).toEqual({ type: 'text', text: 'output' })
  })
})

// ── OpenCode adapter ──────────────────────────────────────────────────────────

describe('opencodeAdapter', () => {
  it('has cli = "opencode"', () => expect(opencodeAdapter.cli).toBe('opencode'))
  it('buildCommand uses "run" subcommand', () => {
    expect(opencodeAdapter.buildCommand({}).args).toContain('run')
  })
  it('parseLine wraps text lines as { type: "text" }', () => {
    expect(opencodeAdapter.parseLine('output')).toEqual({ type: 'text', text: 'output' })
  })
})

// ── Aider adapter ─────────────────────────────────────────────────────────────

describe('aiderAdapter', () => {
  it('has cli = "aider"', () => expect(aiderAdapter.cli).toBe('aider'))

  it('buildCommand includes --no-auto-commits and --yes-always', () => {
    const spec = aiderAdapter.buildCommand({})
    expect(spec.args).toContain('--no-auto-commits')
    expect(spec.args).toContain('--yes-always')
  })

  it('buildCommand includes --read with systemPromptFile', () => {
    const spec = aiderAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    const idx = spec.args.indexOf('--read')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('/tmp/sp.txt')
  })

  it('parseLine wraps all lines as { type: "text" }', () => {
    expect(aiderAdapter.parseLine('> doing something')).toEqual({ type: 'text', text: '> doing something' })
  })
})

// ── Goose adapter ─────────────────────────────────────────────────────────────

describe('gooseAdapter', () => {
  it('has cli = "goose"', () => expect(gooseAdapter.cli).toBe('goose'))

  it('buildCommand uses "run" and "--with-builtin developer"', () => {
    const spec = gooseAdapter.buildCommand({})
    expect(spec.args).toContain('run')
    expect(spec.args).toContain('--with-builtin')
    expect(spec.args).toContain('developer')
  })

  it('parseLine wraps text as { type: "text" }', () => {
    expect(gooseAdapter.parseLine('output')).toEqual({ type: 'text', text: 'output' })
  })

  it('extractTokenUsage returns null when no usage/token_usage field', () => {
    expect(gooseAdapter.extractTokenUsage?.({ type: 'text', text: 'hello' })).toBeNull()
  })

  it('extractTokenUsage extracts from usage field (input_tokens / output_tokens)', () => {
    const event = { type: 'assistant', usage: { input_tokens: 70, output_tokens: 35 } } as any
    expect(gooseAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 70, tokensOut: 35 })
  })

  it('extractTokenUsage falls back to token_usage field', () => {
    const event = { type: 'assistant', token_usage: { input_tokens: 50, output_tokens: 25 } } as any
    expect(gooseAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 50, tokensOut: 25 })
  })

  it('extractTokenUsage accepts camelCase inputTokens / outputTokens', () => {
    const event = { type: 'assistant', usage: { inputTokens: 100, outputTokens: 60 } } as any
    expect(gooseAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 100, tokensOut: 60 })
  })
})

// ── Fallback adapter ──────────────────────────────────────────────────────────

describe('fallbackAdapter', () => {
  it('parseLine returns null for empty lines', () => {
    expect(fallbackAdapter.parseLine('')).toBeNull()
  })

  it('parseLine wraps plain text as { type: "text" }', () => {
    expect(fallbackAdapter.parseLine('some output')).toEqual({ type: 'text', text: 'some output' })
  })

  it('parseLine returns typed event for JSON with type field', () => {
    const event = { type: 'text', text: 'hello' }
    expect(fallbackAdapter.parseLine(JSON.stringify(event))).toEqual(event)
  })

  it('buildCommand spawns binaryName as command', () => {
    const spec = fallbackAdapter.buildCommand({ binaryName: 'my-cli' })
    expect(spec.command).toBe('my-cli')
  })

  it('does not implement extractConvId', () => {
    expect(fallbackAdapter.extractConvId).toBeUndefined()
  })
})

// ── prepareSystemPrompt (all adapters) ────────────────────────────────────────

describe('prepareSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const [name, adapter] of [
    ['claude', claudeAdapter],
    ['codex', codexAdapter],
    ['gemini', geminiAdapter],
    ['opencode', opencodeAdapter],
    ['aider', aiderAdapter],
    ['goose', gooseAdapter],
  ] as const) {
    it(`${name}: writes temp file and returns filePath + cleanup`, async () => {
      const result = await adapter.prepareSystemPrompt('my prompt', '/tmp')
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining(`${name}-sp-`),
        'my prompt',
        'utf-8'
      )
      expect(result.filePath).toContain(`${name}-sp-`)
      expect(typeof result.cleanup).toBe('function')
    })
  }
})
