/**
 * Snapshot tests for TabBar (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'

import TabBar from '@renderer/components/TabBar.vue'

describe('TabBar — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(function MockResizeObserver(this: ResizeObserver) {
      (this as unknown as Record<string, unknown>).observe = vi.fn();
      (this as unknown as Record<string, unknown>).unobserve = vi.fn();
      (this as unknown as Record<string, unknown>).disconnect = vi.fn()
    }))
  })

  it('matches snapshot: empty tab bar (no tabs)', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: { tabs: [], activeTabId: null } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: tab bar with one terminal tab', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tabs: {
              tabs: [{
                id: 'tab-1',
                type: 'terminal',
                label: 'dev-front #1',
                agentName: 'dev-front',
                taskId: 1,
                permanent: false,
              }],
              activeTabId: 'tab-1',
            },
          },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})
