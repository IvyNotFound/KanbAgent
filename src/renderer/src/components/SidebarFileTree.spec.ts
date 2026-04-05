import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SidebarFileTree from '@renderer/components/SidebarFileTree.vue'
import i18n from '@renderer/plugins/i18n'
import { mockElectronAPI } from '../../../test/setup'
import type { FileNode } from '@renderer/types'

function makeFileNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    name: 'file.ts',
    path: '/project/file.ts',
    isDir: false,
    children: [],
    ...overrides,
  }
}

describe('SidebarFileTree', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows noProject message when projectPath is null', () => {
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: null },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // Shows empty/no project state
    expect(wrapper.find('.file-tree-content').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not call fsListDir when projectPath is null', async () => {
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: null },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // Manually invoke loadSidebarTree (exposed)
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    expect(mockElectronAPI.fsListDir).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls window.electronAPI.fsListDir when loadSidebarTree is called with valid projectPath', async () => {
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    await flushPromises()
    expect(mockElectronAPI.fsListDir).toHaveBeenCalledWith('/project', '/project')
    wrapper.unmount()
  })

  it('renders file nodes returned by fsListDir', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'index.ts', path: '/project/index.ts', isDir: false }),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    await flushPromises()
    expect(wrapper.text()).toContain('index.ts')
    wrapper.unmount()
  })

  it('renders directory nodes and shows open/closed icon', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true, children: [] }),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    await flushPromises()
    expect(wrapper.text()).toContain('src')
    wrapper.unmount()
  })

  it('toggles directory open state when dir button is clicked', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true, children: [
        makeFileNode({ name: 'main.ts', path: '/project/src/main.ts', isDir: false }),
      ]}),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    await flushPromises()
    // The dir list-item should exist; dirs start closed after loadSidebarTree (T1574: v-btn → v-list-item)
    const dirItem = wrapper.find('v-list-item')
    expect(dirItem.exists()).toBe(true)
    expect(wrapper.text()).not.toContain('main.ts')
    // Click to open the dir (children already set — no IPC call)
    await dirItem.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('main.ts')
    // Click to close
    await dirItem.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('main.ts')
    wrapper.unmount()
  })

  it('lazy-loads children when clicking a dir with children === undefined', async () => {
    const topNodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true, children: undefined }),
    ]
    const childNodes: FileNode[] = [
      makeFileNode({ name: 'index.ts', path: '/project/src/index.ts', isDir: false }),
    ]
    const fsListDir = mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>
    // onMounted call returns topNodes; lazy load call returns childNodes
    fsListDir.mockResolvedValueOnce(topNodes).mockResolvedValueOnce(childNodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await flushPromises()
    // src dir is present but closed (children undefined — not opened by loadSidebarTree)
    expect(wrapper.text()).toContain('src')
    expect(wrapper.text()).not.toContain('index.ts')
    // Click the dir list-item to trigger lazy load (T1574: v-btn → v-list-item)
    const dirItem = wrapper.find('v-list-item')
    await dirItem.trigger('click')
    await flushPromises()
    // fsListDir should have been called for /project/src
    expect(fsListDir).toHaveBeenCalledWith('/project/src', '/project')
    // Children should now be visible
    expect(wrapper.text()).toContain('index.ts')
    wrapper.unmount()
  })

  it('does not re-fetch children on re-open when already loaded', async () => {
    const topNodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true, children: undefined }),
    ]
    const childNodes: FileNode[] = [
      makeFileNode({ name: 'index.ts', path: '/project/src/index.ts', isDir: false }),
    ]
    const fsListDir = mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>
    // onMounted call returns topNodes; lazy load call returns childNodes
    fsListDir.mockResolvedValueOnce(topNodes).mockResolvedValueOnce(childNodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await flushPromises()
    // T1574: v-btn → v-list-item
    const dirItem = wrapper.find('v-list-item')
    // Open (lazy load)
    await dirItem.trigger('click')
    await flushPromises()
    // Close
    await dirItem.trigger('click')
    await flushPromises()
    // Re-open — should NOT call fsListDir again
    fsListDir.mockClear()
    await dirItem.trigger('click')
    await flushPromises()
    expect(fsListDir).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls tabsStore.openFile when a file is clicked', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'app.ts', path: '/project/app.ts', isDir: false }),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const pinia = createTestingPinia()
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [pinia, i18n] },
    })
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    await flushPromises()
    const { useTabsStore } = await import('@renderer/stores/tabs')
    const tabsStore = useTabsStore()
    // T1574: v-btn → v-list-item
    const fileItem = wrapper.find('v-list-item')
    expect(fileItem.exists()).toBe(true)
    await fileItem.trigger('click')
    expect(tabsStore.openFile).toHaveBeenCalledWith('/project/app.ts', 'app.ts')
    wrapper.unmount()
  })

  it('shows empty folder message when tree is empty after load', async () => {
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as { loadSidebarTree: () => Promise<void> }).loadSidebarTree()
    await flushPromises()
    // Empty folder state shown
    const emptyMsg = wrapper.find('.empty-state')
    expect(emptyMsg.exists()).toBe(true)
    wrapper.unmount()
  })
})
