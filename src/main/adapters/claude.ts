/**
 * Claude Code CLI adapter for KanbAgent.
 *
 * Implements CliAdapter for `claude` (Anthropic Claude Code).
 * Claude emits JSONL stream-json output — parseLine returns raw parsed JSON events.
 *
 * System prompt injection: temp file + $(cat ...) in bash script (ADR-009).
 * Windows native: PowerShell .ps1 script (T916).
 *
 * @module adapters/claude
 */
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type {
  CliAdapter,
  LaunchOpts,
  SpawnSpec,
  SystemPromptResult,
  StreamEvent,
} from '../../shared/cli-types'

// ── Validation regex ───────────────────────────────────────────────────────────

/** Validates custom claude binary names (e.g. claude-dev, claude-pro2). */
export const CLAUDE_CMD_REGEX = /^claude(-[a-z0-9-]+)?$/

// ── buildClaudeCmd ─────────────────────────────────────────────────────────────

/**
 * Build the bash command string for launching Claude in stream-json mode.
 *
 * System prompt is passed via `"$(cat 'WSL_PATH')"` — content is read from a temp
 * file inside bash, bypassing Node.js Windows command-line serialization (T705).
 *
 * @param opts.claudeCommand   - Claude binary name (validated; defaults to `'claude'`).
 * @param opts.convId          - Existing conversation UUID to resume via `--resume`.
 * @param opts.systemPromptFile - WSL path to temp file with raw system prompt.
 * @param opts.thinkingMode    - `'disabled'` to inject alwaysThinkingEnabled:false.
 * @param opts.permissionMode  - `'auto'` to add `--dangerously-skip-permissions`.
 * @returns Full bash command string for embedding in a launch script (T706).
 */
export function buildClaudeCmd(opts: {
  claudeCommand?: string
  convId?: string
  systemPromptFile?: string
  thinkingMode?: string
  permissionMode?: string
}): string {
  const cmd = (opts.claudeCommand && CLAUDE_CMD_REGEX.test(opts.claudeCommand))
    ? opts.claudeCommand
    : 'claude'

  const parts: string[] = [
    cmd,
    '-p',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
  ]

  if (opts.convId) {
    parts.push('--resume', opts.convId)
  }

  if (opts.systemPromptFile) {
    parts.push(`--append-system-prompt "$(cat '${opts.systemPromptFile}')"`)
  }

  if (opts.thinkingMode === 'disabled') {
    parts.push(`--settings '{"alwaysThinkingEnabled":false}'`)
  }

  if (opts.permissionMode === 'auto') {
    parts.push('--dangerously-skip-permissions')
  }

  return parts.join(' ')
}

// ── buildWindowsPS1Script ──────────────────────────────────────────────────────

/**
 * Build a PowerShell script for spawning Claude directly on Windows native (T916).
 *
 * Uses a `List[string]` args array so PowerShell handles quoting/escaping properly,
 * completely bypassing cmd.exe. The system prompt is read from a Windows temp file
 * via `[System.IO.File]::ReadAllText()` and added as a separate list element —
 * PowerShell passes it verbatim to Claude regardless of special characters.
 *
 * @param opts.claudeCommand    - Claude binary name (validated against CLAUDE_CMD_REGEX)
 * @param opts.convId           - Existing conversation UUID for `--resume`
 * @param opts.spTempFile       - Windows path to system prompt temp file (no WSL conversion)
 * @param opts.thinkingMode     - `'disabled'` to inject alwaysThinkingEnabled:false
 * @param opts.permissionMode   - `'auto'` to add `--dangerously-skip-permissions`
 * @param opts.claudeBinaryPath - Absolute Windows path to claude.exe (bypasses Get-Command)
 * @param opts.settingsTempFile - Windows path to temp file containing JSON for `--settings` (T1107)
 * @returns PowerShell script content (.ps1)
 */
export function buildWindowsPS1Script(opts: {
  claudeCommand?: string
  convId?: string
  spTempFile?: string
  thinkingMode?: string
  permissionMode?: string
  claudeBinaryPath?: string
  settingsTempFile?: string
}): string {
  const cmd = (opts.claudeCommand && CLAUDE_CMD_REGEX.test(opts.claudeCommand))
    ? opts.claudeCommand
    : 'claude'

  const lines: string[] = [
    '$ErrorActionPreference = \'Continue\'',
    // Read user PATH from registry (not inherited when Electron launches from Start Menu) (T996):
    `$regPath = (Get-ItemProperty -Path 'HKCU:\\Environment' -Name 'Path' -ErrorAction SilentlyContinue).Path`,
    `if ($regPath) { $env:PATH = [System.Environment]::ExpandEnvironmentVariables($regPath) + ';' + $env:PATH }`,
    // Read system PATH — covers admin installs (winget, choco, Claude Code Desktop) (T1029):
    `$sysPath = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' -Name 'Path' -ErrorAction SilentlyContinue).Path`,
    `if ($sysPath) { $env:PATH = [System.Environment]::ExpandEnvironmentVariables($sysPath) + ';' + $env:PATH }`,
    // Enrich PATH with all known Claude install locations (T933/T939):
    '$env:PATH = "$env:USERPROFILE\\.local\\bin;$env:APPDATA\\npm;$env:LOCALAPPDATA\\Programs\\claude;$env:LOCALAPPDATA\\AnthropicClaude\\bin;$env:LOCALAPPDATA\\npm;$env:LOCALAPPDATA\\Programs;" + $env:PATH',
  ]

  // Resolve claude binary — custom path takes priority over Get-Command discovery (T1029):
  if (opts.claudeBinaryPath) {
    const safeBinaryPath = opts.claudeBinaryPath.replace(/'/g, "''")
    lines.push(`$claudeExe = $null`)
    lines.push(`if (Test-Path '${safeBinaryPath}') { $claudeExe = '${safeBinaryPath}' }`)
  } else {
    // Resolve exe path via Get-Command — works with .cmd wrappers (npm) and direct .exe:
    lines.push(`$claudeExe = Get-Command ${cmd} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source`)
  }
  lines.push(`if (-not $claudeExe) {`)
  lines.push(`  Write-Output "ERROR: '${cmd}' not found. Install Claude CLI or use Settings > Claude Binary Path to specify the location."`)
  lines.push(`  exit 1`)
  lines.push(`}`)

  // T1151: Resolve .cmd wrapper → run node.exe directly to bypass cmd.exe argument corruption.
  // When $claudeExe is a .cmd file (npm global install), PowerShell invokes cmd.exe to run it,
  // and cmd.exe re-interprets { } in JSON arguments (--settings, --append-system-prompt).
  // Resolving the .js entry point and running node.exe directly bypasses cmd.exe entirely.
  lines.push('$resolvedJsEntry = $null')
  lines.push('if ($claudeExe -and $claudeExe.ToLower().EndsWith(\'.cmd\')) {')
  lines.push('  $cmdDir = Split-Path $claudeExe -Parent')
  lines.push('  $cmdContent = Get-Content $claudeExe -Raw -ErrorAction SilentlyContinue')
  lines.push('  if ($cmdContent -match \'(?:%~dp0\\\\|%dp0%\\\\)([^\\s"]+\\.js)\') {')
  lines.push('    $candidate = Join-Path $cmdDir $Matches[1]')
  lines.push('    if (Test-Path $candidate) {')
  lines.push('      $resolvedJsEntry = $candidate')
  lines.push('      $nodeCandidate = Join-Path $cmdDir \'node.exe\'')
  lines.push('      if (Test-Path $nodeCandidate) { $claudeExe = $nodeCandidate } else { $claudeExe = \'node\' }')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')

  // Build args list — List[string] lets PowerShell pass each arg verbatim without cmd.exe re-escaping:
  lines.push('$a = [System.Collections.Generic.List[string]]::new()')
  // Prepend resolved .js entry point when claude was a .cmd wrapper (node.exe $resolvedJsEntry ...):
  lines.push('if ($resolvedJsEntry) { $a.Add($resolvedJsEntry) }')
  lines.push('$a.Add(\'-p\')')
  lines.push('$a.Add(\'--verbose\')')
  lines.push('$a.Add(\'--input-format\')')
  lines.push('$a.Add(\'stream-json\')')
  lines.push('$a.Add(\'--output-format\')')
  lines.push('$a.Add(\'stream-json\')')

  // Optional: resume an existing conversation (appended before prompt flags to keep order stable):
  if (opts.convId) {
    lines.push('$a.Add(\'--resume\')')
    lines.push(`$a.Add('${opts.convId}')`)
  }

  // Read system prompt from Windows temp file — avoids command-line length limits and escaping issues:
  if (opts.spTempFile) {
    const safePath = opts.spTempFile.replace(/'/g, "''")
    lines.push(`$sp = [System.IO.File]::ReadAllText('${safePath}', [System.Text.Encoding]::UTF8)`)
    lines.push('$a.Add(\'--append-system-prompt\')')
    lines.push('$a.Add($sp)')
  }

  if (opts.thinkingMode === 'disabled') {
    if (opts.settingsTempFile) {
      // T1195: Pass the file path directly to --settings instead of reading JSON content.
      // Claude CLI accepts <file-or-json> for --settings — passing the path bypasses
      // any cmd.exe argument corruption of { } chars entirely (no ReadAllText needed).
      const safePath = opts.settingsTempFile.replace(/'/g, "''")
      lines.push('$a.Add(\'--settings\')')
      lines.push(`$a.Add('${safePath}')`)
    } else {
      // Fallback for non-Windows callers or tests without a temp file
      lines.push('$a.Add(\'--settings\')')
      lines.push('$a.Add(\'{"alwaysThinkingEnabled":false}\')')
    }
  }

  // Optional: skip permission prompts for fully-automated agent sessions:
  if (opts.permissionMode === 'auto') {
    lines.push('$a.Add(\'--dangerously-skip-permissions\')')
  }

  // Splat the args array — PowerShell @a passes each element as a separate argument:
  lines.push(`& $claudeExe @a`)

  return lines.join('\n')
}

// ── CliAdapter implementation ──────────────────────────────────────────────────

export const claudeAdapter: CliAdapter = {
  cli: 'claude',
  binaries: ['claude'],

  buildCommand(opts: LaunchOpts): SpawnSpec {
    // Claude requires platform-specific script approaches (bash .sh for WSL, .ps1 for Windows).
    // agent-stream.ts handles the script writing + wsl.exe wrapping directly for Claude.
    // This method returns the inner bash command spec (used for testing only).
    const cmd = buildClaudeCmd({
      claudeCommand: opts.binaryName,
      convId: opts.convId,
      systemPromptFile: opts.systemPromptFile,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
    })
    return { command: 'bash', args: ['-l', '-c', cmd] }
  },

  async prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult> {
    const filePath = join(tempDir, `claude-sp-${Date.now()}.txt`)
    writeFileSync(filePath, prompt, 'utf-8')
    return {
      filePath,
      cleanup: async () => { try { unlinkSync(filePath) } catch { /* best-effort */ } },
    }
  },

  parseLine(line: string): StreamEvent | null {
    try {
      return JSON.parse(line) as StreamEvent
    } catch {
      return null
    }
  },

  extractConvId(event: StreamEvent): string | null {
    if (
      event.type === 'system' &&
      event.subtype === 'init' &&
      typeof event.session_id === 'string'
    ) {
      return event.session_id
    }
    return null
  },
}
