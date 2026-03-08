import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import en from '@renderer/locales/en.json'
import TelemetryView from '@renderer/components/TelemetryView.vue'
import { mockElectronAPI } from '../../../test/setup'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

const BASE_DATA = {
  languages: [],
  totalFiles: 0,
  totalLines: 0,
  scannedAt: new Date().toISOString(),
}

const ADVANCED_DATA = {
  languages: [
    {
      name: 'TypeScript', color: '#3178c6', files: 50, lines: 10000, percent: 60,
      sourceFiles: 40, testFiles: 10, sourceLines: 8000, testLines: 2000,
      blankLines: 500, commentLines: 300, codeLines: 9200,
    },
    {
      name: 'Vue', color: '#42b883', files: 30, lines: 5000, percent: 30,
      sourceFiles: 30, testFiles: 0, sourceLines: 5000, testLines: 0,
      blankLines: 200, commentLines: 100, codeLines: 4700,
    },
  ],
  totalFiles: 80,
  totalLines: 15000,
  scannedAt: new Date().toISOString(),
  totalSourceLines: 13000,
  totalTestLines: 2000,
  testRatio: 13.3,
  totalBlankLines: 700,
  totalCommentLines: 400,
  totalCodeLines: 13900,
  totalSourceFiles: 70,
  totalTestFiles: 10,
}

describe('TelemetryView (T842)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DATA)
  })

  it('shows loading indicator (Scanning) while IPC is pending', async () => {
    let resolve!: (v: unknown) => void
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(r => { resolve = r }),
    )
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await nextTick()
    expect(wrapper.text()).toMatch(/Scanning/)
    resolve({ ...BASE_DATA })
    await flushPromises()
    wrapper.unmount()
  })

  it('calls telemetryScan with projectPath on mount', async () => {
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(mockElectronAPI.telemetryScan).toHaveBeenCalledWith('/my/project')
    wrapper.unmount()
  })

  it('displays languages sorted by lines (already sorted from IPC)', async () => {
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockResolvedValue({
      languages: [
        { name: 'TypeScript', color: '#3178c6', files: 50, lines: 10000, percent: 60 },
        { name: 'Vue', color: '#42b883', files: 30, lines: 5000, percent: 30 },
        { name: 'CSS', color: '#563d7c', files: 10, lines: 1000, percent: 10 },
      ],
      totalFiles: 90,
      totalLines: 16000,
      scannedAt: new Date().toISOString(),
    })
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    const text = wrapper.text()
    const tsIdx = text.indexOf('TypeScript')
    const vueIdx = text.indexOf('Vue')
    expect(tsIdx).toBeGreaterThanOrEqual(0)
    expect(vueIdx).toBeGreaterThan(tsIdx)
    wrapper.unmount()
  })

  it('displays formatted total LOC correctly', async () => {
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockResolvedValue({
      languages: [],
      totalFiles: 100,
      totalLines: 15000,
      scannedAt: new Date().toISOString(),
    })
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('15.0k')
    wrapper.unmount()
  })

  it('displays error message when IPC throws', async () => {
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Scan failed'))
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Scan failed')
    wrapper.unmount()
  })

  it('shows "Open a project" guard when no projectPath', () => {
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: null, dbPath: null } } }), i18n],
      },
    })
    expect(wrapper.text()).toContain('Open a project')
    wrapper.unmount()
  })
})

describe('TelemetryView advanced metrics (T897)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockResolvedValue(ADVANCED_DATA)
  })

  it('shows source/test bar when testRatio is present', async () => {
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Source vs Tests')
    expect(wrapper.text()).toContain('13.3% tests')
    wrapper.unmount()
  })

  it('shows code quality section when advanced metrics present', async () => {
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Code quality')
    expect(wrapper.text()).toContain('Real code')
    expect(wrapper.text()).toContain('Comments')
    expect(wrapper.text()).toContain('Blank lines')
    wrapper.unmount()
  })

  it('shows "Code réel" and "Fichiers test" stat cards with advanced data', async () => {
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Test files')
    // totalCodeLines=13900 → formatLines → '13.9k'
    expect(text).toContain('13.9k')
    wrapper.unmount()
  })

  it('shows Source/Tests columns in language table when lang advanced data present', async () => {
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Source')
    expect(text).toContain('Tests')
    // TypeScript sourceLines=8000 and testLines=2000
    expect(text).toMatch(/8.?000/)
    expect(text).toMatch(/2.?000/)
    wrapper.unmount()
  })

  it('hides advanced sections when testRatio is absent (backward-compat)', async () => {
    ;(mockElectronAPI.telemetryScan as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DATA)
    const wrapper = mount(TelemetryView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { projectPath: '/my/project', dbPath: '/my/project.db' } } }), i18n],
      },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('Source vs Tests')
    expect(text).not.toContain('Code quality')
    expect(text).not.toContain('Test files')
    wrapper.unmount()
  })
})
