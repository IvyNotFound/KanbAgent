import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import StreamView from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../test/setup'
import i18n from '@renderer/plugins/i18n'

// T1817 -- Permission request banner
describe('StreamView permission request (T1817)', () => {
  async function mountStreamPerm() {
    vi.mocked(mockElectronAPI.agentCreate).mockResolvedValue('agent-perm-1')
    vi.mocked(mockElectronAPI.onAgentStream).mockReset()
    vi.mocked(mockElectronAPI.onAgentStream).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentConvId).mockReset()
    vi.mocked(mockElectronAPI.onAgentConvId).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentExit).mockReset()
    vi.mocked(mockElectronAPI.onAgentExit).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)
    vi.mocked(mockElectronAPI.onPermissionRequest).mockReset()
    vi.mocked(mockElectronAPI.onPermissionRequest).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.permissionRespond).mockResolvedValue(true)

    const pinia = createTestingPinia({
      stubActions: false,
      initialState: {
        tabs: { tabs: [{ id: 'tp-1', type: 'terminal', title: 'P', ptyId: null, agentName: 'perm-agent', wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, convId: null, viewMode: 'stream' as const }] },
      },
    })
    const wrapper = mount(StreamView, { props: { terminalId: 'tp-1' }, global: { plugins: [pinia, i18n] } })
    await flushPromises()
    return { wrapper }
  }

  it('shows permission banner when onPermissionRequest fires', async () => {
    const { wrapper } = await mountStreamPerm()
    // Get the onPermissionRequest callback
    const [callback] = vi.mocked(mockElectronAPI.onPermissionRequest).mock.calls[0] ?? []
    expect(callback).toBeDefined()
    // Simulate a permission request
    ;(callback as (data: { permission_id: string; tool_name: string; tool_input: Record<string, unknown>; session_id: string }) => void)({
      permission_id: 'perm_test_1',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      session_id: '',
    })
    await flushPromises()
    const banner = wrapper.find('[data-testid="permission-request-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Bash')
    wrapper.unmount()
  })

  it('calls permissionRespond and removes banner on Allow', async () => {
    const { wrapper } = await mountStreamPerm()
    const [callback] = vi.mocked(mockElectronAPI.onPermissionRequest).mock.calls[0] ?? []
    ;(callback as (data: { permission_id: string; tool_name: string; tool_input: Record<string, unknown>; session_id: string }) => void)({
      permission_id: 'perm_test_2',
      tool_name: 'Write',
      tool_input: { file_path: '/test.ts' },
      session_id: '',
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="permission-request-banner"]').exists()).toBe(true)

    await wrapper.find('[data-testid="permission-allow-btn"]').trigger('click')
    await flushPromises()

    expect(mockElectronAPI.permissionRespond).toHaveBeenCalledWith('perm_test_2', 'allow')
    expect(wrapper.find('[data-testid="permission-request-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('calls permissionRespond and removes banner on Deny', async () => {
    const { wrapper } = await mountStreamPerm()
    const [callback] = vi.mocked(mockElectronAPI.onPermissionRequest).mock.calls[0] ?? []
    ;(callback as (data: { permission_id: string; tool_name: string; tool_input: Record<string, unknown>; session_id: string }) => void)({
      permission_id: 'perm_test_3',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      session_id: '',
    })
    await flushPromises()

    await wrapper.find('[data-testid="permission-deny-btn"]').trigger('click')
    await flushPromises()

    expect(mockElectronAPI.permissionRespond).toHaveBeenCalledWith('perm_test_3', 'deny')
    expect(wrapper.find('[data-testid="permission-request-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
