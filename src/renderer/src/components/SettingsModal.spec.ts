import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SettingsModal from '@renderer/components/SettingsModal.vue'
import i18n from '@renderer/plugins/i18n'

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

    // Click the close (X) button in the header
    const closeBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('fermer') || title.includes('Fermer') || title.includes('close')
    })
    expect(closeBtn?.exists()).toBe(true)
    await closeBtn!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('calls setTheme when theme button is clicked', async () => {
    const pinia = createTestingPinia({
      initialState: { tasks: { dbPath: '/p/.claude/db' } },
    })
    const wrapper = shallowMount(SettingsModal, {
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    await flushPromises()

    const { useSettingsStore } = await import('@renderer/stores/settings')
    const settingsStore = useSettingsStore()

    // Find the theme buttons — look for Dark/Sombre or Light/Clair (appearance section is default)
    const themeButtons = wrapper.findAll('button')
    const darkBtn = themeButtons.find(b => b.text().includes('Dark') || b.text().includes('Sombre'))
    expect(darkBtn?.exists()).toBe(true)
    await darkBtn!.trigger('click')
    expect(settingsStore.setTheme).toHaveBeenCalledWith('dark')
  })

  it('calls setLanguage when language select changes', async () => {
    const pinia = createTestingPinia({
      initialState: { tasks: { dbPath: '/p/.claude/db' } },
    })
    const wrapper = shallowMount(SettingsModal, {
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    await flushPromises()

    const { useSettingsStore } = await import('@renderer/stores/settings')
    const settingsStore = useSettingsStore()

    // Find the language select (appearance section is default)
    const langSelect = wrapper.find('select')
    expect(langSelect.exists()).toBe(true)
    await langSelect.setValue('en')
    expect(settingsStore.setLanguage).toHaveBeenCalledWith('en')
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
    // No number input should be visible for maxFileLinesCount
    const inputs = wrapper.findAll('input[type="number"]')
    const maxInput = inputs.find(i => Number(i.attributes('min')) === 50)
    expect(maxInput).toBeUndefined()
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
    const inputs = wrapper.findAll('input[type="number"]')
    const maxInput = inputs.find(i => Number(i.attributes('min')) === 50)
    expect(maxInput).toBeDefined()
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
    expect(wrapper.text()).toContain('0.4.0')
  })
})
