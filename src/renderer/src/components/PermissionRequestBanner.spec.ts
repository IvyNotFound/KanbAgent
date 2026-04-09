import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PermissionRequestBanner from './PermissionRequestBanner.vue'
import type { PendingPermission } from './PermissionRequestBanner.vue'
import i18n from '@renderer/plugins/i18n'

function mountBanner(permission?: Partial<PendingPermission>) {
  const perm: PendingPermission = {
    permission_id: 'perm_1',
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
    ...permission,
  }
  return mount(PermissionRequestBanner, {
    props: {
      permission: perm,
      accentFg: '#4CAF50',
      accentText: '#81C784',
    },
    global: { plugins: [i18n] },
  })
}

describe('PermissionRequestBanner (T1817)', () => {
  it('renders the banner with tool name', () => {
    const wrapper = mountBanner()
    expect(wrapper.find('[data-testid="permission-request-banner"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Bash')
  })

  it('shows Bash command directly in args', () => {
    const wrapper = mountBanner({ tool_input: { command: 'rm -rf /tmp/test' } })
    expect(wrapper.find('[data-testid="permission-args-content"]').text()).toBe('rm -rf /tmp/test')
  })

  it('shows JSON for non-command tool input', () => {
    const wrapper = mountBanner({
      tool_name: 'Write',
      tool_input: { file_path: '/src/index.ts', content: 'hello' },
    })
    const args = wrapper.find('[data-testid="permission-args-content"]')
    expect(args.exists()).toBe(true)
    expect(args.text()).toContain('file_path')
    expect(args.text()).toContain('/src/index.ts')
  })

  it('hides args toggle for short input', () => {
    const wrapper = mountBanner({ tool_input: { command: 'ls' } })
    expect(wrapper.find('[data-testid="permission-args-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="permission-args-content"]').exists()).toBe(true)
  })

  it('shows args toggle for long input and toggles visibility', async () => {
    // Build an input object with many keys to exceed the 5-line / 200-char threshold when JSON-stringified
    const bigInput: Record<string, unknown> = { file_path: '/src/big.ts' }
    for (let i = 0; i < 10; i++) bigInput[`field_${i}`] = `value_${i}_padding_text`
    const wrapper = mountBanner({
      tool_name: 'Write',
      tool_input: bigInput,
    })
    const toggle = wrapper.find('[data-testid="permission-args-toggle"]')
    expect(toggle.exists()).toBe(true)
    // Initially hidden
    expect(wrapper.find('[data-testid="permission-args-content"]').exists()).toBe(false)
    // Click to show
    await toggle.trigger('click')
    expect(wrapper.find('[data-testid="permission-args-content"]').exists()).toBe(true)
    // Click to hide
    await toggle.trigger('click')
    expect(wrapper.find('[data-testid="permission-args-content"]').exists()).toBe(false)
  })

  it('emits respond with allow on Allow click', async () => {
    const wrapper = mountBanner()
    await wrapper.find('[data-testid="permission-allow-btn"]').trigger('click')
    expect(wrapper.emitted('respond')).toEqual([['perm_1', 'allow']])
  })

  it('emits respond with deny on Deny click', async () => {
    const wrapper = mountBanner()
    await wrapper.find('[data-testid="permission-deny-btn"]').trigger('click')
    expect(wrapper.emitted('respond')).toEqual([['perm_1', 'deny']])
  })

  it('handles empty tool_input gracefully', () => {
    const wrapper = mountBanner({ tool_input: {} })
    expect(wrapper.find('[data-testid="permission-args-content"]').exists()).toBe(false)
  })
})
