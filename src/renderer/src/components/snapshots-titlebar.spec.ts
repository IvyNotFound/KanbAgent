/**
 * Snapshot tests for TitleBar (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import i18n from '@renderer/plugins/i18n'

import TitleBar from '@renderer/components/TitleBar.vue'

describe('TitleBar — snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.windowIsMaximized.mockResolvedValue(false)
    api.onWindowStateChange.mockReturnValue(vi.fn())
  })

  it('matches snapshot: not maximized', async () => {
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: maximized', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.windowIsMaximized.mockResolvedValue(true)
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})
