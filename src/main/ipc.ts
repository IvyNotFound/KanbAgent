/**
 * IPC Handlers for agent-viewer
 *
 * Barrel module: registers all IPC handlers from domain-specific modules.
 *
 * @module ipc
 */

// Re-export for consumers (index.ts, tests)
export { registerDbPath, registerProjectPath } from './db'
export { AGENT_SCRIPTS } from './ipc-project'

import { registerProjectHandlers } from './ipc-project'
import { registerDbHandlers } from './ipc-db'
import { registerWindowHandlers } from './ipc-window'
import { registerSessionStatsHandlers } from './ipc-session-stats'
import { registerGitHandlers } from './ipc-git'
import { registerFsHandlers } from './ipc-fs'
import { registerAgentHandlers } from './ipc-agents'
import { registerSettingsHandlers } from './ipc-settings'
import { registerWslHandlers } from './ipc-wsl'
import { registerTelemetryHandlers } from './ipc-telemetry'

/** Register all IPC handlers by delegating to domain-specific modules. */
export function registerIpcHandlers(): void {
  registerProjectHandlers()
  registerDbHandlers()
  registerWindowHandlers()
  registerSessionStatsHandlers()
  registerGitHandlers()
  registerFsHandlers()
  registerAgentHandlers()
  registerSettingsHandlers()
  registerWslHandlers()
  registerTelemetryHandlers()
}
