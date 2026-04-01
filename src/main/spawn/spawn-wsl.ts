/**
 * Spawn strategy for WSL (Windows Subsystem for Linux).
 *
 * Routing: process.platform === 'win32' && wslDistro !== 'local'
 *
 * Wraps the target CLI inside wsl.exe + bash -l for a proper login-shell environment.
 * - Claude:     bash script containing `exec claude ...`
 * - Other CLIs: bash script sourcing ~/.bashrc, then `exec <cli> ...`
 *
 * @module spawn/spawn-wsl
 */
import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { toWslPath } from '../utils/wsl'
import { buildClaudeCmd, buildEnv, logDebug } from '../agent-stream-helpers'
import type { SpawnInput, SpawnOutput } from './types'

export function spawnWsl({
  id,
  adapter,
  validConvId,
  opts,
  worktreeInfo,
  spTempFile,
}: SpawnInput): SpawnOutput {
  const wslArgs: string[] = []
  if (opts.wslDistro && opts.wslDistro !== 'local') wslArgs.push('-d', opts.wslDistro)
  const effectiveCwd = worktreeInfo?.path ?? opts.workDir ?? opts.projectPath
  if (effectiveCwd) wslArgs.push('--cd', toWslPath(effectiveCwd))

  // Resolve wsl.exe via absolute path to avoid ENOENT in packaged app (Fix T692).
  const wslExe = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'wsl.exe')
    : 'C:\\Windows\\System32\\wsl.exe'

  if (adapter.cli === 'claude') {
    const claudeCmd = buildClaudeCmd({
      claudeCommand: opts.claudeCommand,
      convId: validConvId,
      systemPromptFile: spTempFile ? toWslPath(spTempFile) : undefined,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
    })
    const scriptTempFile = join(tmpdir(), `claude-start-${id}.sh`)
    writeFileSync(scriptTempFile, `#!/bin/bash\nexec ${claudeCmd}\n`, 'utf-8')
    const scriptWslPath = toWslPath(scriptTempFile)
    logDebug(`spawn attempt: exe=${wslExe} script=${scriptWslPath} args=${JSON.stringify([...wslArgs, '--', 'bash', '-l', scriptWslPath])}`)
    console.log('[agent-stream] spawn', wslExe, wslArgs)
    const proc = spawn(wslExe, [...wslArgs, '--', 'bash', '-l', scriptWslPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(),
    })
    return { proc, scriptTempFile }
  } else {
    const spec = adapter.buildCommand({
      convId: validConvId,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
      systemPromptFile: spTempFile ? toWslPath(spTempFile) : undefined,
      binaryName: opts.claudeCommand,
      initialMessage: opts.initialMessage,
      modelId: opts.modelId,
    })
    const bashLine = [spec.command, ...spec.args].map(a =>
      /[\s'"\\$`!]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a
    ).join(' ')
    const scriptTempFile = join(tmpdir(), `${adapter.cli}-start-${id}.sh`)
    writeFileSync(scriptTempFile, `#!/bin/bash\n[ -f ~/.bashrc ] && source ~/.bashrc\nexec ${bashLine}\n`, 'utf-8')
    const scriptWslPath = toWslPath(scriptTempFile)
    logDebug(`spawn attempt (${adapter.cli}): exe=${wslExe} script=${scriptWslPath}`)
    const proc = spawn(wslExe, [...wslArgs, '--', 'bash', '-l', scriptWslPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...buildEnv(), ...spec.env },
    })
    return { proc, scriptTempFile }
  }
}
