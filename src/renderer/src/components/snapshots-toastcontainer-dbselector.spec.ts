/**
 * Snapshot tests for ToastContainer & DbSelector (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount, mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'

// ── ToastContainer ────────────────────────────────────────────────────────────

import ToastContainer from '@renderer/components/ToastContainer.vue'
import { useToast } from '@renderer/composables/useToast'

describe('ToastContainer — snapshots', () => {
  beforeEach(() => {
    const { toasts } = useToast()
    toasts.value.splice(0, toasts.value.length)
  })

  afterEach(() => {
    const { toasts } = useToast()
    toasts.value.splice(0, toasts.value.length)
  })

  it('matches snapshot: empty (no toasts)', () => {
    const wrapper = mount(ToastContainer)
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: three toast types (error, warn, info)', async () => {
    const { toasts } = useToast()
    // Inject toasts directly to avoid auto-dismiss timers and dynamic IDs
    toasts.value.push(
      { id: 1001, message: 'Connection failed', type: 'error' },
      { id: 1002, message: 'Slow response detected', type: 'warn' },
      { id: 1003, message: 'Changes saved', type: 'info' },
    )
    const wrapper = mount(ToastContainer)
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── DbSelector ────────────────────────────────────────────────────────────────

import DbSelector from '@renderer/components/DbSelector.vue'

describe('DbSelector — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getWslUsers.mockResolvedValue([])
  })

  it('matches snapshot: home screen (no project selected)', async () => {
    const wrapper = shallowMount(DbSelector, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: null, error: null } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: home screen with error', async () => {
    const wrapper = shallowMount(DbSelector, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: null, error: 'DB not found' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})
