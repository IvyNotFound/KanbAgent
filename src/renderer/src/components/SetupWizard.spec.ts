import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import SetupWizard from '@renderer/components/SetupWizard.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import i18n from '@renderer/plugins/i18n'

describe('SetupWizard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.createProjectDb.mockResolvedValue({ success: true, dbPath: '/p/.claude/project.db' })
    api.initNewProject.mockResolvedValue({ success: true, filesCreated: [] })
    api.setConfigValue.mockResolvedValue({ success: true })
  })

  it('renders wizard with project path', () => {
    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/my/project', hasCLAUDEmd: false },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('/my/project')
  })

  it('emits skip when skip button is clicked', async () => {
    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: false },
      global: { plugins: [i18n] },
    })

    const skipBtn = wrapper.find('[data-testid="btn-skip"]')
    expect(skipBtn.exists()).toBe(true)
    await skipBtn.trigger('click')
    expect(wrapper.emitted('skip')).toBeTruthy()
  })

  it('calls createProjectDb with language when init button is clicked', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    expect(actionBtn.exists()).toBe(true)
    await actionBtn.trigger('click')
    await flushPromises()
    // Should pass language (default 'en')
    expect(api.createProjectDb).toHaveBeenCalledWith('/p', 'en')
  })

  it('emits done with projectPath and dbPath on success', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.createProjectDb.mockResolvedValue({ success: true, dbPath: '/p/.claude/project.db' })

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    expect(actionBtn.exists()).toBe(true)
    await actionBtn.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('done')).toBeTruthy()
    expect(wrapper.emitted('done')![0]).toEqual([{ projectPath: '/p', dbPath: '/p/.claude/project.db' }])
  })

  it('shows error when createProjectDb fails', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.createProjectDb.mockResolvedValue({ success: false, error: 'Permission denied' })

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    expect(actionBtn.exists()).toBe(true)
    await actionBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Permission denied')
  })

  it('shows different header when hasCLAUDEmd is true vs false', () => {
    const wrapperWithClaude = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })
    const wrapperWithout = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: false },
      global: { plugins: [i18n] },
    })
    const textWith = wrapperWithClaude.text()
    const textWithout = wrapperWithout.text()
    expect(textWith).not.toBe(textWithout)
  })

  it('persists project_clis and primary_cli config on setup', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    await actionBtn.trigger('click')
    await flushPromises()

    // Should persist project_clis and primary_cli
    expect(api.setConfigValue).toHaveBeenCalledWith(
      '/p/.claude/project.db', 'project_clis', expect.any(String)
    )
    expect(api.setConfigValue).toHaveBeenCalledWith(
      '/p/.claude/project.db', 'primary_cli', expect.any(String)
    )
  })

  it('does not call initNewProject when hasCLAUDEmd and generateInstructions unchecked', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })

    // hasCLAUDEmd=true defaults generateInstructions to false
    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    await actionBtn.trigger('click')
    await flushPromises()
    expect(api.initNewProject).not.toHaveBeenCalled()
  })

  it('calls initNewProject when generateInstructions is enabled (Case A)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: false },
      global: { plugins: [i18n] },
    })

    // hasCLAUDEmd=false defaults generateInstructions to true
    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    await actionBtn.trigger('click')
    await flushPromises()
    expect(api.initNewProject).toHaveBeenCalledWith(
      '/p', 'en', expect.any(Array), expect.any(String)
    )
  })

  it('does not call setConfigValue for CLI/model when none selected', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    await actionBtn.trigger('click')
    await flushPromises()
    // Should NOT have called setConfigValue for defaultCliInstance or default_model_*
    expect(api.setConfigValue).not.toHaveBeenCalledWith(
      expect.anything(), 'defaultCliInstance', expect.anything()
    )
  })

  it('calls setConfigValue when CLI and model are selected', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>

    // Pre-populate settings store with CLI instances
    const settings = useSettingsStore()
    settings.allCliInstances = [{ cli: 'claude', name: 'claude', path: '/usr/bin/claude', distroType: 'native' }] as never
    settings.enabledClis = ['claude'] as never
    settings.cliModels = { claude: [{ modelId: 'opus-4', label: 'Opus 4' }] } as never

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: true },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    // Simulate user selecting CLI and model
    const vm = wrapper.vm as unknown as { primaryCli: string | null; primaryModel: string }
    vm.primaryCli = 'claude'
    vm.primaryModel = 'opus-4'

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    await actionBtn.trigger('click')
    await flushPromises()

    expect(api.setConfigValue).toHaveBeenCalledWith('/p/.claude/project.db', 'defaultCliInstance', 'claude')
    expect(api.setConfigValue).toHaveBeenCalledWith('/p/.claude/project.db', 'default_model_claude', 'opus-4')
  })

  it('does not call fsWriteFile (template removed)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>

    const wrapper = shallowMount(SetupWizard, {
      props: { projectPath: '/p', hasCLAUDEmd: false },
      global: { plugins: [i18n] },
    })

    const actionBtn = wrapper.find('[data-testid="btn-action"]')
    await actionBtn.trigger('click')
    await flushPromises()
    expect(api.fsWriteFile).not.toHaveBeenCalled()
  })
})
