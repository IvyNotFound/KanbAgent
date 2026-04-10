/**
 * Snapshot tests for ContextMenu (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'

import ContextMenu from '@renderer/components/ContextMenu.vue'

describe('ContextMenu — snapshots', () => {
  const vuetifyStubs = {
    VMenu: { template: '<div class="v-menu-stub"><slot /></div>' },
    VList: { template: '<div class="v-list-stub"><slot /></div>' },
    VListItem: {
      template: '<button>{{ title }}</button>',
      props: ['title'],
    },
    VDivider: { template: '<hr class="v-divider-stub" />' },
  }

  it('matches snapshot: simple items (no separator)', () => {
    const wrapper = shallowMount(ContextMenu, {
      props: {
        x: 100,
        y: 200,
        items: [
          { label: 'Rename', action: () => {} },
          { label: 'Delete', action: () => {} },
        ],
      },
      global: { stubs: vuetifyStubs },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: items with separator', () => {
    const wrapper = shallowMount(ContextMenu, {
      props: {
        x: 50,
        y: 80,
        items: [
          { label: 'Edit', action: () => {} },
          { label: 'Add subgroup', action: () => {} },
          { separator: true, label: '', action: () => {} },
          { label: 'Delete', action: () => {} },
        ],
      },
      global: { stubs: vuetifyStubs },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})
