import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ProjectPopup from '@renderer/components/ProjectPopup.vue'
import i18n from '@renderer/plugins/i18n'
import { mockElectronAPI } from '../../../test/setup'

describe('ProjectPopup (T675)', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)
  })

  it('displays current project name derived from projectPath', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { projectPath: '/home/user/my-project', dbPath: '/home/user/my-project/project.db' },
      },
    })
    const wrapper = mount(ProjectPopup, {
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    expect(wrapper.text()).toContain('my-project')
  })

  it('calls store.selectProject when Changer de projet is clicked', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { projectPath: '/home/user/proj', dbPath: '/home/user/proj/project.db' },
      },
    })
    const wrapper = mount(ProjectPopup, {
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const store = useTasksStore()
    const changeBtn = wrapper.findAll('v-btn').find(b => b.text().includes('Changer de projet'))
    expect(changeBtn?.exists()).toBe(true)
    await changeBtn!.trigger('click')
    await flushPromises()
    expect(store.selectProject).toHaveBeenCalled()
  })

  it('emits close when close button (X) clicked', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { projectPath: '/home/user/proj', dbPath: '/home/user/proj/project.db' },
      },
    })
    const wrapper = mount(ProjectPopup, {
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    const closeBtn = wrapper.find('v-btn[title="Fermer"]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits close when backdrop clicked', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { projectPath: '/home/user/proj', dbPath: null },
      },
    })
    const wrapper = mount(ProjectPopup, {
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    const backdrop = wrapper.find('[data-testid="project-popup-backdrop"]')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
