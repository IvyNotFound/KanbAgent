import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import ConfirmModal from '@renderer/components/ConfirmModal.vue'
import i18n from '@renderer/plugins/i18n'

describe('ConfirmModal (T675)', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders title and message when mounted', () => {
    const wrapper = mount(ConfirmModal, {
      props: { title: 'Supprimer', message: 'Voulez-vous vraiment supprimer ?' },
      global: { plugins: [i18n], stubs: teleportStub },
    })
    expect(wrapper.text()).toContain('Supprimer')
    expect(wrapper.text()).toContain('Voulez-vous vraiment supprimer ?')
  })

  it('emits confirm when OK button clicked', async () => {
    const wrapper = mount(ConfirmModal, {
      props: { title: 'Confirmation', message: 'Continuer ?' },
      global: { plugins: [i18n], stubs: teleportStub },
    })
    const buttons = wrapper.findAll('v-btn')
    const confirmBtn = buttons[buttons.length - 1]
    await confirmBtn.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('emits cancel when Annuler button clicked', async () => {
    const wrapper = mount(ConfirmModal, {
      props: { title: 'Confirmation', message: 'Continuer ?' },
      global: { plugins: [i18n], stubs: teleportStub },
    })
    const buttons = wrapper.findAll('v-btn')
    const cancelBtn = buttons[0]
    await cancelBtn.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('emits cancel when backdrop clicked', async () => {
    const wrapper = mount(ConfirmModal, {
      props: { title: 'Confirmation', message: 'Continuer ?' },
      global: { plugins: [i18n], stubs: teleportStub },
    })
    // v-dialog handles the overlay click; the inner wrapper has @click.self as a test-compat fallback
    const backdrop = wrapper.find('[data-testid="confirm-modal-wrapper"]')
    await backdrop.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
