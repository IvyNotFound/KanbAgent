import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import StreamToolBlock from '@renderer/components/StreamToolBlock.vue'
import type { StreamContentBlock } from '@renderer/types/stream'
import i18n from '@renderer/plugins/i18n'

const pinia = createTestingPinia({ initialState: { settings: { theme: 'dark' } } })

describe('StreamToolBlock (T842)', () => {
  const defaultProps = {
    eventId: 1,
    blockIdx: 0,
    collapsed: {} as Record<string, boolean>,
    accentFg: '#00ff00',
    accentBg: '#003300',
    accentBorder: '#00aa00',
    accentOnColor: '#ffffff',
    accentText: '#66bb6a',
  }

  it('renders tool_use block with tool name', () => {
    const block: StreamContentBlock = { type: 'tool_use', name: 'Read', input: { path: '/a.ts' } }
    const wrapper = mount(StreamToolBlock, {
      props: { ...defaultProps, block },
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.find('[data-testid="block-tool-use"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Read')
    wrapper.unmount()
  })

  it('renders tool_result block', () => {
    const block: StreamContentBlock = { type: 'tool_result', content: 'result text', is_error: false }
    const wrapper = mount(StreamToolBlock, {
      props: { ...defaultProps, block },
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.find('[data-testid="block-tool-result"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows ✓ Résultat for non-error tool_result', () => {
    const block: StreamContentBlock = { type: 'tool_result', content: 'ok', is_error: false }
    const wrapper = mount(StreamToolBlock, { props: { ...defaultProps, block }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('✓ Résultat')
    wrapper.unmount()
  })

  it('shows ✗ Erreur for error tool_result', () => {
    const block: StreamContentBlock = { type: 'tool_result', content: 'err', is_error: true }
    const wrapper = mount(StreamToolBlock, { props: { ...defaultProps, block }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('✗ Erreur')
    wrapper.unmount()
  })

  it('emits toggleCollapsed when tool_use header clicked', async () => {
    const block: StreamContentBlock = { type: 'tool_use', name: 'Bash', input: {} }
    const wrapper = mount(StreamToolBlock, { props: { ...defaultProps, block }, global: { plugins: [i18n] } })
    await wrapper.find('[data-testid="block-tool-use"] v-btn').trigger('click')
    expect(wrapper.emitted('toggleCollapsed')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows tool input preview JSON for tool_use', () => {
    const block: StreamContentBlock = { type: 'tool_use', name: 'Write', input: { file_path: '/x.ts' } }
    const wrapper = mount(StreamToolBlock, {
      props: { ...defaultProps, block, collapsed: { '1-0': false } },
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('/x.ts')
    wrapper.unmount()
  })
})
