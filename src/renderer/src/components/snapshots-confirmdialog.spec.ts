/**
 * Snapshot tests for ConfirmDialog (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import i18n from '@renderer/plugins/i18n'

import ConfirmDialog from '@renderer/components/ConfirmDialog.vue'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'

describe('ConfirmDialog — snapshots', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  afterEach(() => {
    const { cancel } = useConfirmDialog()
    cancel()
  })

  it('matches snapshot: danger dialog', async () => {
    const { confirm } = useConfirmDialog()
    confirm({ title: 'Delete agent?', message: 'This action is irreversible.', type: 'danger', confirmLabel: 'Delete', cancelLabel: 'Cancel' })
    const wrapper = shallowMount(ConfirmDialog, {
      global: { plugins: [i18n], stubs: { ...teleportStub, Transition: false } },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: info dialog', async () => {
    const { confirm } = useConfirmDialog()
    confirm({ title: 'Confirm action?', message: 'Do you want to proceed?', type: 'info', confirmLabel: 'OK', cancelLabel: 'Cancel' })
    const wrapper = shallowMount(ConfirmDialog, {
      global: { plugins: [i18n], stubs: { ...teleportStub, Transition: false } },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})
