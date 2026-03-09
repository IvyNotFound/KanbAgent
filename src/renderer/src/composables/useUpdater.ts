/**
 * Auto-update composable for KanbAgent.
 *
 * Wraps the `window.electronAPI.updater` IPC bridge and exposes a reactive
 * state machine that drives the `UpdateNotification` banner.
 *
 * State transitions:
 *   idle → checking → available → downloading → downloaded → (install triggers restart)
 *                              ↘ up-to-date
 *                              ↘ error
 *
 * State is kept at module level (singleton) so multiple component instances
 * share the same update status without duplicating IPC subscriptions.
 *
 * @module useUpdater
 */
import { ref, onMounted, onUnmounted } from 'vue'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'up-to-date'

export interface UpdateInfo {
  version?: string
  releaseName?: string | null
}

// Module-level singleton state shared across component instances
const status = ref<UpdateStatus>('idle')
const progress = ref(0)
const info = ref<UpdateInfo | null>(null)
const errorMessage = ref<string | null>(null)

/**
 * Composable for auto-update state management.
 *
 * Subscribe to Electron `update:*` events and expose controls to
 * trigger download and install. Safe to call in multiple components —
 * shares singleton state.
 *
 * @returns {{ status, progress, info, check, download, install, dismiss }}
 *   - `status` — current update state (`UpdateStatus`)
 *   - `progress` — download progress percentage (0–100)
 *   - `info` — update metadata from electron-updater (`UpdateInfo | null`)
 *   - `check()` — trigger an explicit update check
 *   - `download()` — start downloading the available update
 *   - `install()` — quit and install the downloaded update
 *   - `dismiss()` — reset status to `idle` without installing
 */
export function useUpdater() {
  const unsubs: Array<() => void> = []

  onMounted(() => {
    const updater = window.electronAPI.updater
    if (!updater) return

    unsubs.push(
      updater.on('available', (data) => {
        status.value = 'available'
        info.value = data as UpdateInfo
      }),
      updater.on('not-available', () => {
        status.value = 'up-to-date'
      }),
      updater.on('progress', (data) => {
        status.value = 'downloading'
        progress.value = (data as { percent: number }).percent ?? 0
      }),
      updater.on('downloaded', (data) => {
        status.value = 'downloaded'
        info.value = data as UpdateInfo
      }),
      updater.on('error', (msg) => {
        status.value = 'error'
        errorMessage.value = (msg as string) ?? 'Unknown error'
      }),
    )
  })

  onUnmounted(() => {
    unsubs.forEach((u) => u())
    unsubs.length = 0
  })

  function check() {
    status.value = 'checking'
    window.electronAPI.updater?.check()
  }

  function download() {
    window.electronAPI.updater?.download()
  }

  function install() {
    window.electronAPI.updater?.install()
  }

  function dismiss() {
    status.value = 'idle'
  }

  return { status, progress, info, errorMessage, check, download, install, dismiss }
}
