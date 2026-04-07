import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SidebarFileTree from '@renderer/components/SidebarFileTree.vue'
import i18n from '@renderer/plugins/i18n'
import { mockElectronAPI } from '../../../test/setup'
import type { FileNode } from '@renderer/types'

type VM = {
  loadSidebarTree: () => Promise<void>
  loadChildren: (node: FileNode) => Promise<void>
  sidebarTree: FileNode[]
}

function makeFileNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    name: 'file.ts',
    path: '/project/file.ts',
    isDir: false,
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
    expect(wrapper.find('.file-tree-content').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not call fsListDir when projectPath is null', async () => {
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: null },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as unknown as VM).loadSidebarTree()
    expect(mockElectronAPI.fsListDir).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls window.electronAPI.fsListDir when loadSidebarTree is called with valid projectPath', async () => {
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    await (wrapper.vm as unknown as VM).loadSidebarTree()
    await flushPromises()
    expect(mockElectronAPI.fsListDir).toHaveBeenCalledWith('/project', '/project')
    wrapper.unmount()
  })

  it('populates sidebarTree with file and dir nodes after load', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'index.ts', path: '/project/index.ts', isDir: false }),
      makeFileNode({ name: 'src', path: '/project/src', isDir: true }),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await vm.loadSidebarTree()
    await flushPromises()
    expect(vm.sidebarTree).toHaveLength(2)
    expect(vm.sidebarTree[0].name).toBe('index.ts')
    expect(vm.sidebarTree[1].name).toBe('src')
    wrapper.unmount()
  })

  it('prepares dir nodes with children: [] for v-treeview expandability', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true }),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await vm.loadSidebarTree()
    await flushPromises()
    // Dir nodes must have children: [] so v-treeview renders them as expandable groups
    expect(vm.sidebarTree[0].children).toEqual([])
    wrapper.unmount()
  })

  it('file nodes do not get children added', async () => {
    const nodes: FileNode[] = [
      makeFileNode({ name: 'app.ts', path: '/project/app.ts', isDir: false }),
    ]
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await vm.loadSidebarTree()
    await flushPromises()
    // File nodes must NOT have children — v-treeview treats them as leaves
    expect(vm.sidebarTree[0].children).toBeUndefined()
    wrapper.unmount()
  })

  it('lazy-loads dir children when loadChildren is called', async () => {
    const topNodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true }),
    ]
    const childNodes: FileNode[] = [
      makeFileNode({ name: 'index.ts', path: '/project/src/index.ts', isDir: false }),
    ]
    const fsListDir = mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>
    // onMounted consumes first Once; loadChildren consumes second Once
    fsListDir.mockResolvedValueOnce(topNodes).mockResolvedValueOnce(childNodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await flushPromises() // wait for onMounted loadSidebarTree

    const dirNode = vm.sidebarTree[0]
    await vm.loadChildren(dirNode)
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledWith('/project/src', '/project')
    expect(dirNode.children).toHaveLength(1)
    expect(dirNode.children![0].name).toBe('index.ts')
    wrapper.unmount()
  })

  it('child dir nodes get children: [] when lazy-loaded', async () => {
    const topNodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true }),
    ]
    const childNodes: FileNode[] = [
      makeFileNode({ name: 'components', path: '/project/src/components', isDir: true }),
    ]
    const fsListDir = mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>
    // onMounted consumes first Once; loadChildren consumes second Once
    fsListDir.mockResolvedValueOnce(topNodes).mockResolvedValueOnce(childNodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await flushPromises() // wait for onMounted loadSidebarTree

    const dirNode = vm.sidebarTree[0]
    await vm.loadChildren(dirNode)
    await flushPromises()

    // Nested dir must also get children: [] so it's expandable
    expect(dirNode.children![0].children).toEqual([])
    wrapper.unmount()
  })

  it('does not re-fetch children when loadChildren called again for same dir', async () => {
    const topNodes: FileNode[] = [
      makeFileNode({ name: 'src', path: '/project/src', isDir: true }),
    ]
    const childNodes: FileNode[] = [
      makeFileNode({ name: 'index.ts', path: '/project/src/index.ts', isDir: false }),
    ]
    const fsListDir = mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>
    // onMounted consumes first Once; loadChildren consumes second Once
    fsListDir.mockResolvedValueOnce(topNodes).mockResolvedValueOnce(childNodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await flushPromises() // wait for onMounted loadSidebarTree

    const dirNode = vm.sidebarTree[0]
    await vm.loadChildren(dirNode)
    await flushPromises()

    // Second call — should NOT call fsListDir again
    fsListDir.mockClear()
    await vm.loadChildren(dirNode)
    await flushPromises()
    expect(fsListDir).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loadChildren is a no-op when projectPath is null', async () => {
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: null },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    const node = makeFileNode({ name: 'src', path: '/project/src', isDir: true, children: [] })
    await vm.loadChildren(node)
    expect(mockElectronAPI.fsListDir).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows empty folder message when tree is empty after load', async () => {
    ;(mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await vm.loadSidebarTree()
    await flushPromises()
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    wrapper.unmount()
  })

  it('clears sidebarTree and loadedDirs on refresh', async () => {
    const nodes: FileNode[] = [makeFileNode({ name: 'src', path: '/project/src', isDir: true })]
    const fsListDir = mockElectronAPI.fsListDir as ReturnType<typeof vi.fn>
    fsListDir.mockResolvedValue(nodes)
    const wrapper = shallowMount(SidebarFileTree, {
      props: { projectPath: '/project' },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const vm = wrapper.vm as unknown as VM
    await vm.loadSidebarTree()
    await flushPromises()

    // Load children to populate loadedDirs
    const childNodes: FileNode[] = [makeFileNode({ name: 'index.ts', isDir: false })]
    fsListDir.mockResolvedValueOnce(nodes).mockResolvedValueOnce(childNodes)
    await vm.loadChildren(vm.sidebarTree[0])
    await flushPromises()

    // Refresh — loadedDirs cleared so loadChildren can fetch again
    fsListDir.mockResolvedValueOnce(nodes).mockResolvedValueOnce(childNodes)
    await vm.loadSidebarTree()
    await flushPromises()
    await vm.loadChildren(vm.sidebarTree[0])
    await flushPromises()
    // Should have fetched children again (not blocked by loadedDirs)
    expect(fsListDir).toHaveBeenCalledWith('/project/src', '/project')
    wrapper.unmount()
  })
})
