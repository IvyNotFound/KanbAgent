/**
 * Spawn strategy for Windows-native (local) execution.
 *
 * Routing: process.platform === 'win32' && wslDistro === 'local'
 *
 * - Claude:     powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script.ps1>
 * - Other CLIs: spawn(binary, args, { shell: true }) — handles .cmd/.bat wrappers
 *
 * @module spawn/spawn-windows
 */
import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildWindowsPS1Script, buildWindowsEnv, logDebug } from '../agent-stream-helpers'
import type { SpawnInput, SpawnOutput } from './types'

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
      claudeCommand: opts.claudeCommand,
      convId: validConvId,
      spTempFile,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
      claudeBinaryPath: opts.claudeBinaryPath,
      settingsTempFile,
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
      binaryName: opts.claudeCommand,
      initialMessage: opts.initialMessage,
      modelId: opts.modelId,
    })
    logDebug(`spawn attempt (local Windows, ${adapter.cli}): ${spec.command} ${spec.args.join(' ')}`)
    const proc = spawn(spec.command, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...buildWindowsEnv(), ...spec.env },
      cwd,
    })
    return { proc, scriptTempFile: undefined }
  }
}
