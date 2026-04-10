/**
 * Shared helpers and mocks for useTokenStats test splits.
 */
import { vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
      locale: { value: 'en' },
    }),
  }
})

vi.mock('@renderer/composables/usePolledData', () => ({
  usePolledData: () => ({ loading: { value: false }, refresh: vi.fn() }),
}))

vi.mock('@renderer/utils/agentColor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/utils/agentColor')>()
  return {
    ...actual,
    agentFg: (name: string) => `fg-${name}`,
    agentBg: (name: string) => `bg-${name}`,
    agentBorder: (name: string) => `border-${name}`,
  }
})

// ─── setupComposable helper ──────────────────────────────────────────────────

export async function setupComposable(opts: {
  dbPath?: string
  activeTabId?: string
  localStoragePeriod?: string | null
} = {}) {
  vi.resetModules()
  setActivePinia(createPinia())
  localStorage.clear()

  if (opts.localStoragePeriod !== undefined) {
    if (opts.localStoragePeriod !== null) {
      localStorage.setItem('tokenStats.period', opts.localStoragePeriod)
    }
  }

  const { useTasksStore } = await import('@renderer/stores/tasks')
  const { useTabsStore } = await import('@renderer/stores/tabs')

  const tasksStore = useTasksStore()
  tasksStore.$patch({ dbPath: opts.dbPath ?? '/test/db' })

  const tabsStore = useTabsStore()
  tabsStore.$patch({ activeTabId: opts.activeTabId ?? 'dashboard' })

  const { useTokenStats } = await import('@renderer/composables/useTokenStats')
  return useTokenStats()
}
