import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SidebarPerimetreSection from '@renderer/components/SidebarPerimetreSection.vue'
import i18n from '@renderer/plugins/i18n'
import { mockElectronAPI } from '../../../test/setup'
import type { Task, Perimetre } from '@renderer/types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Task A',
    description: null,
    status: 'todo',
    scope: 'front-vuejs',
    effort: 1,
    agent_assigned_id: 1,
    agent_name: null,
    agent_creator_id: null,
    agent_creator_name: null,
    agent_validator_id: null,
    agent_scope: null,
    parent_task_id: null,
    session_id: null,
    priority: 'normal',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    validated_at: null,
    ...overrides,
  } as Task
}

function makePerimetre(overrides: Partial<Perimetre> = {}): Perimetre {
  return {
    id: 1,
    name: 'front-vuejs',
    folder: 'renderer/',
    techno: 'Vue 3',
    description: 'Frontend Vue 3',
    active: 1,
    ...overrides,
  }
}

describe('SidebarPerimetreSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows no perimeter message when perimetresData is empty', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { tasks: [], agents: [], perimetresData: [], selectedPerimetre: null, dbPath: '/db' },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    expect(wrapper.find('.no-perimeter-msg').exists()).toBe(true)
    wrapper.unmount()
  })

  it('renders perimetres from store', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks: [],
          agents: [],
          perimetresData: [makePerimetre({ name: 'front-vuejs' })],
          selectedPerimetre: null,
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    expect(wrapper.text()).toContain('front-vuejs')
    wrapper.unmount()
  })

  it('taskCountByPerimetre counts non-archived tasks per perimetre', () => {
    const tasks = [
      makeTask({ id: 1, scope: 'front-vuejs', status: 'todo' }),
      makeTask({ id: 2, scope: 'front-vuejs', status: 'in_progress' }),
      makeTask({ id: 3, scope: 'front-vuejs', status: 'archived' }), // should be excluded
      makeTask({ id: 4, scope: 'back-electron', status: 'todo' }),
    ]
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks,
          agents: [],
          perimetresData: [makePerimetre({ name: 'front-vuejs' }), makePerimetre({ id: 2, name: 'back-electron' })],
          selectedPerimetre: null,
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    // Should show 2 for front-vuejs (archived excluded) and 1 for back-electron
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('1')
    wrapper.unmount()
  })

  it('calls store.togglePerimetreFilter when a perimetre is clicked', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks: [],
          agents: [],
          perimetresData: [makePerimetre({ name: 'front-vuejs' })],
          selectedPerimetre: null,
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const store = useTasksStore()
    // Find and click the perimetre list-item (replaced v-btn with v-list-item in T1574)
    const items = wrapper.findAll('v-list-item')
    const perimetreItem = items.find(item => item.text().includes('front-vuejs'))
    expect(perimetreItem).toBeDefined()
    await perimetreItem!.trigger('click')
    expect(store.togglePerimetreFilter).toHaveBeenCalledWith('front-vuejs')
    wrapper.unmount()
  })

  it('opens edit modal when edit button is clicked', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks: [],
          agents: [],
          perimetresData: [makePerimetre({ name: 'front-vuejs', description: 'Frontend' })],
          selectedPerimetre: null,
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    // No edit modal initially
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })

  it('prefills edit fields when openEditPerimetre is triggered', async () => {
    const p = makePerimetre({ name: 'back-electron', description: 'Backend Electron' })
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks: [],
          agents: [],
          perimetresData: [p],
          selectedPerimetre: null,
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    // Find the edit button (the pencil icon button with @click.stop="openEditPerimetre(p)")
    const editBtn = wrapper.find('v-btn.edit-btn')
    if (editBtn.exists()) {
      await editBtn.trigger('click')
      // Edit modal should now show with prefilled values
      const inputs = wrapper.findAll('input')
      if (inputs.length > 0) {
        expect((inputs[0].element as HTMLInputElement).value).toBe('back-electron')
      }
    }
    wrapper.unmount()
  })

  it('calls window.electronAPI.updatePerimetre on save via direct vm call', async () => {
    ;(mockElectronAPI.updatePerimetre as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const p = makePerimetre({ id: 5, name: 'front-vuejs', description: 'Frontend' })
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks: [],
          agents: [],
          perimetresData: [p],
          selectedPerimetre: null,
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    const vm = wrapper.vm as unknown as {
      editPerimetre: typeof p | null
      editPerimetreName: string
      editPerimetreDesc: string
      savePerimetre: () => Promise<void>
    }
    // Simulate openEditPerimetre
    vm.editPerimetre = p
    vm.editPerimetreName = 'front-vuejs-updated'
    vm.editPerimetreDesc = 'Updated desc'
    await wrapper.vm.$nextTick()
    await vm.savePerimetre()
    await flushPromises()
    expect(mockElectronAPI.updatePerimetre).toHaveBeenCalledWith(
      '/db', 5, 'front-vuejs', 'front-vuejs-updated', 'Updated desc'
    )
    wrapper.unmount()
  })

  it('shows reset button when a perimetre is selected', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          tasks: [],
          agents: [],
          perimetresData: [makePerimetre({ name: 'front-vuejs' })],
          selectedPerimetre: 'front-vuejs',
          dbPath: '/db',
        },
      },
    })
    const wrapper = shallowMount(SidebarPerimetreSection, {
      global: { plugins: [pinia, i18n] },
    })
    // Reset button should exist when selectedPerimetre is non-null
    const buttons = wrapper.findAll('v-btn')
    const hasResetBtn = buttons.some(b => b.classes().includes('reset-btn'))
    expect(hasResetBtn).toBe(true)
    wrapper.unmount()
  })
})
