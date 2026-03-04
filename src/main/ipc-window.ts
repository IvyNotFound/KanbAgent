/**
 * IPC Handlers — Window controls and dialogs
 *
 * Covers: window-minimize, window-maximize, window-close, window-is-maximized,
 *         show-confirm-dialog, shell:openExternal
 *
 * @module ipc-window
 */

import { ipcMain, dialog, BrowserWindow, shell } from 'electron'

/** Register window control and dialog IPC handlers. */
export function registerWindowHandlers(): void {
  /** Minimize the focused window. */
  ipcMain.handle('window-minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })

  /** Toggle maximize/unmaximize on the focused window. */
  ipcMain.handle('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })

  /** Close the focused window. */
  ipcMain.handle('window-close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  /** @returns {boolean} Whether the focused window is maximized */
  ipcMain.handle('window-is-maximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  })

  /**
   * Show a native confirmation dialog.
   * @param opts - Dialog options (title, message, detail)
   * @returns {boolean} true if user clicked "Continuer"
   */
  ipcMain.handle('show-confirm-dialog', async (_event, opts: { title: string; message: string; detail?: string }) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Continuer', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
    })
    return result.response === 0
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })
}
