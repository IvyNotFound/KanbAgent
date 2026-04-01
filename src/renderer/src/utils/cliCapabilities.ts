/**
 * Static CLI capabilities and labels for LaunchSessionModal.
 * Extracted to keep the component under 400 lines.
 *
 * @module utils/cliCapabilities
 */

import type { CliType, CliCapabilities } from '@shared/cli-types'

// T1036 / R2 — T1012 will eventually expose this via IPC; until then, source-of-truth is here.
export const CLI_CAPABILITIES: Record<CliType, CliCapabilities> = {
  claude:   { worktree: true, profileSelection: true,  systemPrompt: true,  thinkingMode: true,  convResume: true,  modelSelection: false },
  codex:    { worktree: true, profileSelection: false, systemPrompt: true,  thinkingMode: false, convResume: false, modelSelection: false },
  gemini:   { worktree: true, profileSelection: false, systemPrompt: false, thinkingMode: false, convResume: false, modelSelection: false },
  opencode: { worktree: true, profileSelection: false, systemPrompt: false, thinkingMode: false, convResume: false, modelSelection: true  },
  aider:    { worktree: true, profileSelection: false, systemPrompt: true,  thinkingMode: false, convResume: false, modelSelection: false },
  goose:    { worktree: true, profileSelection: false, systemPrompt: true,  thinkingMode: false, convResume: false, modelSelection: false },
}

export const CLI_LABELS: Record<CliType, string> = {
  claude:   'Claude',
  codex:    'Codex',
  gemini:   'Gemini',
  opencode: 'OpenCode',
  aider:    'Aider',
  goose:    'Goose',
}

export const CLI_BADGE: Record<CliType, string> = {
  claude:   'C',
  codex:    'X',
  gemini:   'G',
  opencode: 'O',
  aider:    'A',
  goose:    'G',
}

export function systemLabel(distroType: string, distro: string | undefined): string {
  if (distroType === 'wsl') return `WSL ${distro}`
  const plat = window.electronAPI.platform
  if (plat === 'win32') return 'Windows'
  if (plat === 'darwin') return 'macOS'
  return 'Linux'
}
