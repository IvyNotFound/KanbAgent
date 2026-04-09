import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import UpdateNotification from '@renderer/components/UpdateNotification.vue'
import i18n from '@renderer/plugins/i18n'

// Shared reactive state for the mock (module-level like the real composable)
const mockStatus = ref('idle')
const mockProgress = ref(0)
const mockInfo = ref<{ version?: string } | null>(null)
const mockErrorMessage = ref<string | null>(null)
const mockDownload = vi.fn()
const mockInstall = vi.fn()
const mockDismiss = vi.fn()

vi.mock('@renderer/composables/useUpdater', () => ({
  useUpdater: () => ({
    status: mockStatus,
    progress: mockProgress,
    info: mockInfo,
    errorMessage: mockErrorMessage,
    download: mockDownload,
    install: mockInstall,
    dismiss: mockDismiss,
  }),
}))

// vitest.config.ts uses isCustomElement: (tag) => tag.startsWith('v-'),
// so all v-* tags are compiled as native custom elements in tests.
// We must use DOM selectors ('v-banner', 'v-btn') rather than component stubs.
function mountComponent() {
  return mount(UpdateNotification, {
    global: { plugins: [i18n] },
  })
}

describe('UpdateNotification', () => {
  beforeEach(() => {
    mockStatus.value = 'idle'
    mockProgress.value = 0
    mockInfo.value = null
    mockErrorMessage.value = null
    vi.clearAllMocks()
  })

  it('is not visible when status is idle', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.update-bar').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows content when status is available with version', async () => {
    mockStatus.value = 'available'
    mockInfo.value = { version: '1.2.3' }
    const wrapper = mountComponent()
    const text = wrapper.text()
    expect(text).toContain('1.2.3')
    wrapper.unmount()
  })

  it('shows progress when status is downloading', () => {
    mockStatus.value = 'downloading'
    mockProgress.value = 45
    const wrapper = mountComponent()
    const text = wrapper.text()
    expect(text).toContain('45')
    wrapper.unmount()
  })

  it('shows version when status is downloaded', () => {
    mockStatus.value = 'downloaded'
    mockInfo.value = { version: '2.0.0' }
    const wrapper = mountComponent()
    expect(wrapper.text()).toContain('2.0.0')
    wrapper.unmount()
  })

  it('shows error message when status is error', () => {
    mockStatus.value = 'error'
    mockErrorMessage.value = 'Network timeout'
    const wrapper = mountComponent()
    expect(wrapper.text()).toContain('Network timeout')
    wrapper.unmount()
  })

  it('is not visible when status is up-to-date', () => {
    mockStatus.value = 'up-to-date'
    const wrapper = mountComponent()
    expect(wrapper.find('.update-bar').exists()).toBe(false)
    wrapper.unmount()
  })

  it('calls download when download button clicked (available)', async () => {
    mockStatus.value = 'available'
    mockInfo.value = { version: '1.0.0' }
    const wrapper = mountComponent()
    await wrapper.find('v-btn').trigger('click')
    expect(mockDownload).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls dismiss when close button clicked (available)', async () => {
    mockStatus.value = 'available'
    mockInfo.value = { version: '1.0.0' }
    const wrapper = mountComponent()
    const buttons = wrapper.findAll('v-btn')
    // Second button is the dismiss icon
    await buttons[1].trigger('click')
    expect(mockDismiss).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls install when restart button clicked (downloaded)', async () => {
    mockStatus.value = 'downloaded'
    mockInfo.value = { version: '1.0.0' }
    const wrapper = mountComponent()
    const buttons = wrapper.findAll('v-btn')
    // First button is "restart"
    await buttons[0].trigger('click')
    expect(mockInstall).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls dismiss when later button clicked (downloaded)', async () => {
    mockStatus.value = 'downloaded'
    mockInfo.value = { version: '1.0.0' }
    const wrapper = mountComponent()
    const buttons = wrapper.findAll('v-btn')
    // Second button is "later"
    await buttons[1].trigger('click')
    expect(mockDismiss).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls dismiss when close button clicked (error)', async () => {
    mockStatus.value = 'error'
    mockErrorMessage.value = 'Some error'
    const wrapper = mountComponent()
    await wrapper.find('v-btn').trigger('click')
    expect(mockDismiss).toHaveBeenCalled()
    wrapper.unmount()
  })
})
