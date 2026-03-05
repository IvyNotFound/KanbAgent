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
      updater.on('error', () => {
        status.value = 'error'
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

  return { status, progress, info, check, download, install, dismiss }
}
