import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConfirmDialog from '@renderer/components/ConfirmDialog.vue'
import i18n from '@renderer/plugins/i18n'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'

describe('ConfirmDialog (T353)', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when no pending confirmation', () => {
    const wrapper = shallowMount(ConfirmDialog, {
      global: {
        plugins: [i18n],
        stubs: { ...teleportStub, Transition: false },
      },
    })
    const dialog = wrapper.find('[role="alertdialog"]')
    expect(dialog.exists()).toBe(false)
  })

  it('renders dialog with title and message when pending', async () => {
    const { confirm, pending } = useConfirmDialog()

    // Trigger a confirmation — don't await (it resolves on accept/cancel)
    const promise = confirm({
      title: 'Delete agent?',
      message: 'This action is irreversible.',
      type: 'danger',
    })

    const wrapper = shallowMount(ConfirmDialog, {
      global: {
        plugins: [i18n],
        stubs: { ...teleportStub, Transition: false },
      },
    })
    await nextTick()

    expect(wrapper.text()).toContain('Delete agent?')
    expect(wrapper.text()).toContain('This action is irreversible.')

    // Cleanup: cancel to resolve the promise
    const { cancel } = useConfirmDialog()
    cancel()
    await promise
  })

  it('accept resolves with true', async () => {
    const { confirm, accept } = useConfirmDialog()

    const promise = confirm({
      title: 'Confirm',
      message: 'Proceed?',
    })

    await nextTick()
    accept()
    const result = await promise
    expect(result).toBe(true)
  })

  it('cancel resolves with false', async () => {
    const { confirm, cancel } = useConfirmDialog()

    const promise = confirm({
      title: 'Confirm',
      message: 'Proceed?',
    })

    await nextTick()
    cancel()
    const result = await promise
    expect(result).toBe(false)
  })

  it('Escape key triggers cancel', async () => {
    const { confirm } = useConfirmDialog()

    const promise = confirm({
      title: 'Delete?',
      message: 'Are you sure?',
      type: 'danger',
    })

    mount(ConfirmDialog, {
      global: {
        plugins: [i18n],
        stubs: { ...teleportStub, Transition: false },
      },
    })
    await nextTick()

    // ConfirmDialog registers a document-level Escape listener — dispatch directly
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    const result = await promise
    expect(result).toBe(false)
  })

  it('shows danger icon for type=danger', async () => {
    const { confirm } = useConfirmDialog()

    confirm({
      title: 'Delete?',
      message: 'Danger!',
      type: 'danger',
    })

    const wrapper = shallowMount(ConfirmDialog, {
      global: {
        plugins: [i18n],
        stubs: { ...teleportStub, Transition: false },
      },
    })
    await nextTick()

    // Danger icon container has icon-danger scoped class
    const iconContainer = wrapper.find('.icon-danger')
    expect(iconContainer.exists()).toBe(true)

    // Cleanup
    const { cancel } = useConfirmDialog()
    cancel()
  })

  it('shows custom confirm and cancel labels', async () => {
    const { confirm } = useConfirmDialog()

    confirm({
      title: 'Remove?',
      message: 'Are you sure?',
      confirmLabel: 'Yes, remove',
      cancelLabel: 'No, keep',
    })

    const wrapper = shallowMount(ConfirmDialog, {
      global: {
        plugins: [i18n],
        stubs: { ...teleportStub, Transition: false },
      },
    })
    await nextTick()

    expect(wrapper.text()).toContain('Yes, remove')
    expect(wrapper.text()).toContain('No, keep')

    const { cancel } = useConfirmDialog()
    cancel()
  })
})
