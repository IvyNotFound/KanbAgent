import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SettingsModal from '@renderer/components/SettingsModal.vue'
import i18n from '@renderer/plugins/i18n'

// Stub for SettingsAppearanceSection — preserves data-testid attributes tested by specs
const settingsAppearanceSectionStub = {
  template: '<div><v-select data-testid="lang-select" /><div data-testid="theme-toggle" /></div>',
}

describe('SettingsModal', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getConfigValue.mockResolvedValue({ success: true, value: null })
  })

  it('renders settings title', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()
    const text = wrapper.text()
    // Should contain the settings title (i18n fr default: "Paramètres")
    expect(text).toContain('Param')
  })

  it('emits close when close button is clicked', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    // Click the v-btn close button by data-testid
    const closeBtn = wrapper.find('[data-testid="close-btn"]')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders theme toggle in appearance section', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: { ...teleportStub, SettingsAppearanceSection: settingsAppearanceSectionStub },
      },
    })
    await flushPromises()

    // v-btn-toggle with data-testid should be visible in default appearance section
    expect(wrapper.find('[data-testid="theme-toggle"]').exists()).toBe(true)
  })

  it('renders language select in appearance section', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: { ...teleportStub, SettingsAppearanceSection: settingsAppearanceSectionStub },
      },
    })
    await flushPromises()

    // v-select with data-testid should be visible in default appearance section
    expect(wrapper.find('[data-testid="lang-select"]').exists()).toBe(true)
  })

  it('hides maxFileLinesCount input when maxFileLinesEnabled is false', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: { maxFileLinesEnabled: false },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()
    // Navigate to editor section
    await wrapper.find('[data-testid="nav-editor"]').trigger('click')
    await nextTick()
    // No maxFileLinesCount field should be visible
    expect(wrapper.find('[data-testid="max-file-lines-count"]').exists()).toBe(false)
  })

  it('shows maxFileLinesCount input when maxFileLinesEnabled is true', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.clone/db' },
            settings: { maxFileLinesEnabled: true, maxFileLinesCount: 400 },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()
    // Navigate to editor section
    await wrapper.find('[data-testid="nav-editor"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="max-file-lines-count"]').exists()).toBe(true)
  })

  it('shows version info', async () => {
    const wrapper = shallowMount(SettingsModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: { appInfo: { name: 'KanbAgent', version: '0.4.0' } },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()
    // Navigate to application section
    await wrapper.find('[data-testid="nav-application"]').trigger('click')
    await nextTick()
    // Version info is rendered by SettingsApplicationSection (extracted sub-component)
    expect(wrapper.findComponent({ name: 'SettingsApplicationSection' }).exists()).toBe(true)
  })
})
