/**
 * Spawn strategy for Windows-native (local) execution.
 *
 * Routing: process.platform === 'win32' && wslDistro === 'local'
 *
 * - Claude:     powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script.ps1>
 * - Other CLIs: spawn(binary, args, { shell: true }) — handles .cmd/.bat wrappers
 *
 * Security: non-Claude args are escaped via escapeCmdArg() before being passed to
 * shell:true spawn. This prevents cmd.exe metacharacter injection (& | < > ^ etc.)
 * from user-controlled values such as modelId and initialMessage.
 *
 * @module spawn/spawn-windows
 */
import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildWindowsPS1Script, buildWindowsEnv, logDebug } from '../agent-stream-helpers'
import type { SpawnInput, SpawnOutput } from './types'

/**
 * Quotes and escapes a single argument for cmd.exe shell:true spawn.
 *
 * When Node.js spawns with shell:true on Windows, it constructs:
 *   cmd.exe /d /s /c "<command> <escaped-args>"
 * Without quoting, arguments containing spaces are split by cmd.exe into multiple
 * tokens, causing "La syntaxe de la commande n'est pas correcte." errors.
 *
 * Strategy: wrap the argument in double-quotes so cmd.exe treats it as one token.
 * Inside double-quoted cmd.exe strings, only two characters need special handling:
 *   - `"` → `\"` (CommandLineToArgvW convention for embedded quotes)
 *   - `%` → `%%` (prevents environment-variable expansion, e.g. %PATH%)
 * Other metacharacters (& | < > ^ ( )) are inert inside double-quoted strings.
 *
 * Exported for unit testing.
 *
 * @param arg - Raw argument string (may contain user-controlled data)
 * @returns Argument wrapped in double-quotes with internal `"` and `%` escaped
 */
export function escapeCmdArg(arg: string): string {
  const escaped = arg
    .replace(/"/g, '\\"')  // embed literal quote via CommandLineToArgvW convention
    .replace(/%/g, '%%')   // prevent %VAR% expansion inside cmd.exe double-quoted string
  return `"${escaped}"`
}

export function spawnWindows({
  id,
  adapter,
  validConvId,
  opts,
  worktreeInfo,
  spTempFile,
  settingsTempFile,
}: SpawnInput): SpawnOutput {
  const cwd = worktreeInfo?.path ?? opts.workDir ?? opts.projectPath ?? undefined

  if (adapter.cli === 'claude') {
    const ps1Content = buildWindowsPS1Script({
      customBinaryName: opts.customBinaryName,
      convId: validConvId,
      spTempFile,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
      claudeBinaryPath: opts.claudeBinaryPath,
      settingsTempFile,
      modelId: opts.modelId,
    })
    const scriptTempFile = join(tmpdir(), `claude-start-${id}.ps1`)
    writeFileSync(scriptTempFile, ps1Content, 'utf-8')
    logDebug(`spawn attempt (local Windows): powershell.exe -File ${scriptTempFile}`)
    console.log('[agent-stream] spawn local Windows', scriptTempFile)

    const proc = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptTempFile,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildWindowsEnv(),
      cwd,
    })
    return { proc, scriptTempFile }
  } else {
    const spec = adapter.buildCommand({
      convId: validConvId,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
      systemPromptFile: spTempFile,
      customBinaryName: opts.customBinaryName,
      initialMessage: opts.initialMessage,
      modelId: opts.modelId,
    })
    logDebug(`spawn attempt (local Windows, ${adapter.cli}): ${spec.command} ${spec.args.join(' ')}`)
    const escapedArgs = spec.args.map(escapeCmdArg)
    const proc = spawn(spec.command, escapedArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...buildWindowsEnv(), ...spec.env },
      cwd,
    })
    return { proc, scriptTempFile: undefined }
  }
}
