/**
 * Tests for buildWindowsPS1Script — local Windows PowerShell script generation.
 *
 * Verifies:
 * - buildWindowsPS1Script generates correct PowerShell script
 * - System prompt is passed via temp file read in PS1 (no $(cat ...) bash syntax)
 * - Settings JSON is read from temp file via ReadAllText (T1107)
 * - Claude binary resolution via Get-Command or custom path (T1029)
 * - PATH enrichment from registry (T996/T1029)
 */

import { describe, it, expect } from 'vitest'
import { buildWindowsPS1Script } from './agent-stream-helpers'

// ── buildWindowsPS1Script unit tests ─────────────────────────────────────────

describe('buildWindowsPS1Script', () => {
  it('includes required claude args', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain("$a.Add('-p')")
    expect(script).toContain("$a.Add('--verbose')")
    expect(script).toContain("$a.Add('stream-json')")
    expect(script).toContain('--output-format')
    expect(script).toContain('--input-format')
  })

  it('ends with & $claudeExe @a invocation (T939)', () => {
    const script = buildWindowsPS1Script({})
    expect(script.trimEnd()).toMatch(/^\& \$claudeExe @a$/m)
  })

  it('uses custom claudeCommand in Get-Command when valid (T939)', () => {
    const script = buildWindowsPS1Script({ claudeCommand: 'claude-dev' })
    expect(script).toContain('Get-Command claude-dev')
    expect(script.trimEnd()).toMatch(/^\& \$claudeExe @a$/m)
  })

  it('falls back to claude in Get-Command for invalid claudeCommand (T939)', () => {
    const script = buildWindowsPS1Script({ claudeCommand: 'rm -rf /' })
    expect(script).toContain('Get-Command claude')
    expect(script.trimEnd()).toMatch(/^\& \$claudeExe @a$/m)
  })

  it('adds --resume with convId', () => {
    const script = buildWindowsPS1Script({ convId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    expect(script).toContain("$a.Add('--resume')")
    expect(script).toContain("$a.Add('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')")
  })

  it('reads system prompt from file via ReadAllText (no $(cat ...) bash syntax)', () => {
    const script = buildWindowsPS1Script({ spTempFile: 'C:\\Users\\foo\\AppData\\Local\\Temp\\claude-sp-1.txt' })
    expect(script).toContain('ReadAllText')
    expect(script).toContain('--append-system-prompt')
    expect(script).toContain('$a.Add($sp)')
    // Must NOT contain bash-style $(cat ...) — incompatible with PowerShell
    expect(script).not.toContain('$(cat')
  })

  it('escapes single quotes in system prompt file path', () => {
    const script = buildWindowsPS1Script({ spTempFile: "C:\\it's a path\\sp.txt" })
    expect(script).toContain("it''s a path")
  })

  it('adds --settings alwaysThinkingEnabled:false when thinkingMode=disabled (fallback, no temp file)', () => {
    const script = buildWindowsPS1Script({ thinkingMode: 'disabled' })
    expect(script).toContain("$a.Add('--settings')")
    expect(script).toContain('alwaysThinkingEnabled')
    expect(script).toContain('false')
  })

  it('reads settings JSON from temp file via ReadAllText when settingsTempFile provided (T1107)', () => {
    const script = buildWindowsPS1Script({
      thinkingMode: 'disabled',
      settingsTempFile: 'C:\\Users\\foo\\AppData\\Local\\Temp\\claude-settings-1.json',
    })
    expect(script).toContain('ReadAllText')
    expect(script).toContain('claude-settings-1.json')
    expect(script).toContain("$a.Add('--settings')")
    expect(script).toContain('$a.Add($settingsJson)')
    // Must NOT contain the literal JSON string — it goes through the temp file
    expect(script).not.toContain("$a.Add('{\"alwaysThinkingEnabled\":false}')")
  })

  it('escapes single quotes in settingsTempFile path (T1107)', () => {
    const script = buildWindowsPS1Script({
      thinkingMode: 'disabled',
      settingsTempFile: "C:\\it's a path\\settings.json",
    })
    expect(script).toContain("it''s a path")
  })

  it('adds --dangerously-skip-permissions when permissionMode=auto', () => {
    const script = buildWindowsPS1Script({ permissionMode: 'auto' })
    expect(script).toContain("$a.Add('--dangerously-skip-permissions')")
  })

  it('does not add --append-system-prompt when no spTempFile', () => {
    const script = buildWindowsPS1Script({})
    expect(script).not.toContain('--append-system-prompt')
  })

  it('includes expanded PATH enrichment (T933/T939)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('$env:PATH')
    expect(script).toContain('.local\\bin')
    expect(script).toContain('\\npm')
    // New T939 candidates
    expect(script).toContain('Programs\\claude')
    expect(script).toContain('AnthropicClaude\\bin')
    // PATH line must appear before the $claudeExe invocation
    const pathIdx = script.indexOf('$env:PATH')
    const invokeIdx = script.indexOf('& $claudeExe @a')
    expect(pathIdx).toBeLessThan(invokeIdx)
  })

  it('reads user PATH from registry before hardcoded fallback (T996)', () => {
    const script = buildWindowsPS1Script({})
    // Registry read must be present
    expect(script).toContain("HKCU:\\Environment")
    expect(script).toContain('Get-ItemProperty')
    expect(script).toContain('ExpandEnvironmentVariables')
    // Registry injection must appear before hardcoded PATH enrichment
    const regIdx = script.indexOf('HKCU:\\Environment')
    const hardcodedPathIdx = script.indexOf('.local\\bin')
    expect(regIdx).toBeLessThan(hardcodedPathIdx)
    // Registry injection must appear before Get-Command lookup
    const getCommandIdx = script.indexOf('Get-Command')
    expect(regIdx).toBeLessThan(getCommandIdx)
  })

  it('reads system PATH from HKLM after HKCU and before hardcoded paths (T1029)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
    // HKCU must appear before HKLM
    const hkcuIdx = script.indexOf('HKCU:\\Environment')
    const hklmIdx = script.indexOf('HKLM:\\SYSTEM')
    expect(hkcuIdx).toBeLessThan(hklmIdx)
    // HKLM must appear before hardcoded PATH enrichment
    const hardcodedPathIdx = script.indexOf('.local\\bin')
    expect(hklmIdx).toBeLessThan(hardcodedPathIdx)
    // HKLM must appear before Get-Command lookup
    const getCommandIdx = script.indexOf('Get-Command')
    expect(hklmIdx).toBeLessThan(getCommandIdx)
  })

  it('uses claudeBinaryPath directly via Test-Path, bypasses Get-Command (T1029)', () => {
    const script = buildWindowsPS1Script({ claudeBinaryPath: 'C:\\Users\\foo\\AppData\\Local\\AnthropicClaude\\bin\\claude.exe' })
    expect(script).toContain("Test-Path 'C:\\Users\\foo\\AppData\\Local\\AnthropicClaude\\bin\\claude.exe'")
    expect(script).toContain('$claudeExe = $null')
    // Must NOT use Get-Command when a custom path is provided
    expect(script).not.toContain('Get-Command')
  })

  it('escapes single quotes in claudeBinaryPath (T1029)', () => {
    const script = buildWindowsPS1Script({ claudeBinaryPath: "C:\\it's a path\\claude.exe" })
    expect(script).toContain("it''s a path")
    expect(script).not.toContain("it's a path")
  })

  it('uses Get-Command when claudeBinaryPath is not provided (T1029)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('Get-Command claude -ErrorAction SilentlyContinue')
    expect(script).not.toContain('Test-Path')
  })

  it('error message mentions Settings > Claude Binary Path (T1029)', () => {
    const script = buildWindowsPS1Script({})
    const errorLine = script.split('\n').find(l => l.includes('Write-Output') && l.includes('not found'))
    expect(typeof errorLine).toBe('string')
    expect(errorLine).toContain('Settings')
    expect(errorLine).toContain('Claude Binary Path')
  })

  it('uses Get-Command for dynamic claude discovery (T939)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('Get-Command claude -ErrorAction SilentlyContinue')
    expect(script).toContain('Select-Object -ExpandProperty Source')
    expect(script).toContain('$claudeExe')
  })

  it('emits readable error (not PATH dump) when claude not found (T939/T995)', () => {
    const script = buildWindowsPS1Script({})
    expect(script).toContain('if (-not $claudeExe)')
    expect(script).toContain('exit 1')
    // Error message must be short and readable — no raw $env:PATH dump (T995)
    const errorLine = script.split('\n').find(l => l.includes('Write-Output') && l.includes('not found'))
    expect(typeof errorLine).toBe('string')
    expect(errorLine).toContain('Install Claude CLI')
    expect(errorLine).not.toContain('$env:PATH')
  })
})
