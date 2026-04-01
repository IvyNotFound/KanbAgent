import { describe, it, expect, beforeEach } from 'vitest'
import { mockElectronAPI } from '../../../test/setup'
import { CLI_CAPABILITIES, CLI_LABELS, CLI_BADGE, systemLabel } from './cliCapabilities'

// ── CLI_CAPABILITIES ──────────────────────────────────────────────────────────

describe('CLI_CAPABILITIES — exhaustive boolean assertions', () => {
  // Kills all BooleanLiteral mutants: each true/false is explicitly checked.

  it('claude: all capabilities enabled except modelSelection', () => {
    expect(CLI_CAPABILITIES.claude).toEqual({
      worktree: true,
      profileSelection: true,
      systemPrompt: true,
      thinkingMode: true,
      convResume: true,
      modelSelection: false,
    })
  })

  it('codex: profileSelection, thinkingMode, convResume, modelSelection disabled', () => {
    expect(CLI_CAPABILITIES.codex).toEqual({
      worktree: true,
      profileSelection: false,
      systemPrompt: true,
      thinkingMode: false,
      convResume: false,
      modelSelection: false,
    })
  })

  it('gemini: only worktree enabled', () => {
    expect(CLI_CAPABILITIES.gemini).toEqual({
      worktree: true,
      profileSelection: false,
      systemPrompt: false,
      thinkingMode: false,
      convResume: false,
      modelSelection: false,
    })
  })

  it('opencode: worktree and modelSelection enabled', () => {
    expect(CLI_CAPABILITIES.opencode).toEqual({
      worktree: true,
      profileSelection: false,
      systemPrompt: false,
      thinkingMode: false,
      convResume: false,
      modelSelection: true,
    })
  })

  it('aider: worktree and systemPrompt enabled, others disabled', () => {
    expect(CLI_CAPABILITIES.aider).toEqual({
      worktree: true,
      profileSelection: false,
      systemPrompt: true,
      thinkingMode: false,
      convResume: false,
      modelSelection: false,
    })
  })

  it('goose: worktree and systemPrompt enabled, others disabled', () => {
    expect(CLI_CAPABILITIES.goose).toEqual({
      worktree: true,
      profileSelection: false,
      systemPrompt: true,
      thinkingMode: false,
      convResume: false,
      modelSelection: false,
    })
  })

  // Per-flag checks to kill individual BooleanLiteral mutations
  it('only claude has profileSelection=true', () => {
    const withProfile = Object.entries(CLI_CAPABILITIES)
      .filter(([, v]) => v.profileSelection)
      .map(([k]) => k)
    expect(withProfile).toEqual(['claude'])
  })

  it('only claude has thinkingMode=true', () => {
    const withThinking = Object.entries(CLI_CAPABILITIES)
      .filter(([, v]) => v.thinkingMode)
      .map(([k]) => k)
    expect(withThinking).toEqual(['claude'])
  })

  it('only claude has convResume=true', () => {
    const withResume = Object.entries(CLI_CAPABILITIES)
      .filter(([, v]) => v.convResume)
      .map(([k]) => k)
    expect(withResume).toEqual(['claude'])
  })

  it('only opencode has modelSelection=true', () => {
    const withModel = Object.entries(CLI_CAPABILITIES)
      .filter(([, v]) => v.modelSelection)
      .map(([k]) => k)
    expect(withModel).toEqual(['opencode'])
  })

  it('claude, codex, aider, goose have systemPrompt=true', () => {
    const withSystemPrompt = Object.entries(CLI_CAPABILITIES)
      .filter(([, v]) => v.systemPrompt)
      .map(([k]) => k)
    expect(withSystemPrompt).toEqual(['claude', 'codex', 'aider', 'goose'])
  })

  it('all CLIs have worktree=true', () => {
    for (const [cli, caps] of Object.entries(CLI_CAPABILITIES)) {
      expect(caps.worktree, `${cli}.worktree should be true`).toBe(true)
    }
  })
})

// ── CLI_LABELS ────────────────────────────────────────────────────────────────

describe('CLI_LABELS — string value assertions', () => {
  it('has correct display label for each CLI', () => {
    expect(CLI_LABELS).toEqual({
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
      aider: 'Aider',
      goose: 'Goose',
    })
  })

  it('claude label is exactly "Claude" (not lowercase or truncated)', () => {
    expect(CLI_LABELS.claude).toBe('Claude')
  })

  it('opencode label is exactly "OpenCode" (case-sensitive)', () => {
    expect(CLI_LABELS.opencode).toBe('OpenCode')
  })

  it('all labels are non-empty strings', () => {
    for (const [cli, label] of Object.entries(CLI_LABELS)) {
      expect(typeof label, `${cli} label should be string`).toBe('string')
      expect(label.length, `${cli} label should be non-empty`).toBeGreaterThan(0)
    }
  })
})

// ── CLI_BADGE ─────────────────────────────────────────────────────────────────

describe('CLI_BADGE — string value assertions', () => {
  it('has correct badge character for each CLI', () => {
    expect(CLI_BADGE).toEqual({
      claude: 'C',
      codex: 'X',
      gemini: 'G',
      opencode: 'O',
      aider: 'A',
      goose: 'G',
    })
  })

  it('claude badge is "C"', () => {
    expect(CLI_BADGE.claude).toBe('C')
  })

  it('codex badge is "X" (not "C")', () => {
    expect(CLI_BADGE.codex).toBe('X')
  })

  it('opencode badge is "O"', () => {
    expect(CLI_BADGE.opencode).toBe('O')
  })

  it('aider badge is "A"', () => {
    expect(CLI_BADGE.aider).toBe('A')
  })

  it('all badges are single-character strings', () => {
    for (const [cli, badge] of Object.entries(CLI_BADGE)) {
      expect(badge.length, `${cli} badge should be 1 char`).toBe(1)
    }
  })
})

// ── systemLabel ───────────────────────────────────────────────────────────────

describe('systemLabel — ConditionalExpression / StringLiteral branches', () => {
  beforeEach(() => {
    mockElectronAPI.platform = 'linux'
  })

  it('returns "WSL <distro>" when distroType is "wsl"', () => {
    expect(systemLabel('wsl', 'Ubuntu')).toBe('WSL Ubuntu')
  })

  it('wsl branch includes distro name verbatim', () => {
    expect(systemLabel('wsl', 'Debian')).toBe('WSL Debian')
  })

  it('wsl branch: distro undefined returns "WSL undefined"', () => {
    // Kills StringLiteral mutation on the template literal
    expect(systemLabel('wsl', undefined)).toBe('WSL undefined')
  })

  it('returns "Windows" when platform is win32 (non-wsl)', () => {
    mockElectronAPI.platform = 'win32'
    expect(systemLabel('local', undefined)).toBe('Windows')
  })

  it('returns "macOS" when platform is darwin', () => {
    mockElectronAPI.platform = 'darwin'
    expect(systemLabel('local', undefined)).toBe('macOS')
  })

  it('returns "Linux" when platform is linux', () => {
    mockElectronAPI.platform = 'linux'
    expect(systemLabel('local', undefined)).toBe('Linux')
  })

  it('returns "Linux" for any other platform (fallback branch)', () => {
    mockElectronAPI.platform = 'freebsd' as 'linux'
    expect(systemLabel('local', undefined)).toBe('Linux')
  })

  it('wsl check is exclusive — "wsl2" distroType does NOT trigger WSL branch', () => {
    mockElectronAPI.platform = 'linux'
    // "wsl2" !== "wsl" → falls through to platform check
    const result = systemLabel('wsl2', 'Ubuntu')
    expect(result).toBe('Linux')
  })

  it('non-wsl with win32 ignores distro argument', () => {
    mockElectronAPI.platform = 'win32'
    expect(systemLabel('local', 'SomeDistro')).toBe('Windows')
  })

  it('kills StringLiteral mutation: "Windows" is not "windows" or "Win32"', () => {
    mockElectronAPI.platform = 'win32'
    const result = systemLabel('local', undefined)
    expect(result).toBe('Windows')
    expect(result).not.toBe('windows')
    expect(result).not.toBe('Win32')
  })

  it('kills StringLiteral mutation: "macOS" is not "MacOS" or "darwin"', () => {
    mockElectronAPI.platform = 'darwin'
    const result = systemLabel('local', undefined)
    expect(result).toBe('macOS')
    expect(result).not.toBe('MacOS')
    expect(result).not.toBe('darwin')
  })

  it('kills StringLiteral mutation: platform comparison is "win32" not "Win32"', () => {
    // Setting 'Win32' should NOT match win32 branch → falls to Linux
    mockElectronAPI.platform = 'Win32' as 'win32'
    const result = systemLabel('local', undefined)
    expect(result).toBe('Linux')
  })

  it('kills StringLiteral mutation: platform comparison is "darwin" not "Darwin"', () => {
    mockElectronAPI.platform = 'Darwin' as 'darwin'
    const result = systemLabel('local', undefined)
    expect(result).toBe('Linux')
  })
})
