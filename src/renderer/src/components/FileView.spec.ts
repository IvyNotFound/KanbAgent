import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import FileView from '@renderer/components/FileView.vue'
import i18n from '@renderer/plugins/i18n'

describe('FileView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.fsReadFile.mockResolvedValue({ success: true, content: 'const x = 1' })
    api.fsWriteFile.mockResolvedValue({ success: true })
  })

  it('renders the file name from filePath prop', () => {
    const wrapper = shallowMount(FileView, {
      props: { filePath: '/p/src/main.ts', tabId: 'tab-1' },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { projectPath: '/p' },
            tabs: {},
            settings: { theme: 'dark' },
          },
        }), i18n],
      },
    })
    expect(wrapper.text()).toContain('main.ts')
  })

  it('calls fsReadFile on mount for text files', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    shallowMount(FileView, {
      props: { filePath: '/p/src/main.ts', tabId: 'tab-1' },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { projectPath: '/p' },
            tabs: {},
            settings: { theme: 'dark' },
          },
        }), i18n],
      },
    })
    await flushPromises()
    expect(api.fsReadFile).toHaveBeenCalledWith('/p/src/main.ts', '/p')
  })

  it('shows error for binary (non-text) files', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    const wrapper = shallowMount(FileView, {
      props: { filePath: '/p/image.png', tabId: 'tab-1' },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { projectPath: '/p' },
            tabs: {},
            settings: { theme: 'dark' },
          },
        }), i18n],
      },
    })
    await flushPromises()
    // Should NOT call fsReadFile for binary
    expect(api.fsReadFile).not.toHaveBeenCalled()
    // Should show binary file error (i18n fr: "Fichier binaire")
    expect(wrapper.text()).toContain('binaire')
  })

  it('shows error when fsReadFile fails', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.fsReadFile.mockResolvedValue({ success: false, error: 'File not found' })

    const wrapper = shallowMount(FileView, {
      props: { filePath: '/p/src/missing.ts', tabId: 'tab-1' },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { projectPath: '/p' },
            tabs: {},
            settings: { theme: 'dark' },
          },
        }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('File not found')
  })

  it('renders save button', async () => {
    const wrapper = shallowMount(FileView, {
      props: { filePath: '/p/src/main.ts', tabId: 'tab-1' },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { projectPath: '/p' },
            tabs: {},
            settings: { theme: 'dark' },
          },
        }), i18n],
      },
    })
    await flushPromises()
    const saveBtn = wrapper.findAll('v-btn').find(b => {
      const text = b.text().toLowerCase()
      return text.includes('save') || text.includes('enregistrer') || text.includes('sauvegarder')
    })
    expect(saveBtn).toBeDefined()
  })
})
