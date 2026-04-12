/**
 * IPC handlers — hook server utilities (ADR-013)
 *
 * Exposes the effective hook server port so the renderer can display it
 * in the status bar or debug panel.
 *
 * @module ipc-hookserver
 */
import { ipcMain } from 'electron'

let effectiveHookPort = 0

/**
 * Called from index.ts after the hook server successfully binds.
 * Stores the port so the IPC handler can return it.
 */
export function setEffectiveHookPort(port: number): void {
  effectiveHookPort = port
}

/** Register hook server IPC handlers. */
export function registerHookServerHandlers(): void {
  /** Returns the effective port the hook server is listening on (0 if not bound). */
  ipcMain.handle('hookServer:getPort', (): number => effectiveHookPort)
}
