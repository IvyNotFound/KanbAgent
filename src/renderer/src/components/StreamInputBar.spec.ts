import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import StreamInputBar from '@renderer/components/StreamInputBar.vue'

// v-* tags are compiled as custom elements (isCustomElement in vitest.config.ts).
// Stubs cannot intercept custom elements — tests interact directly with the DOM:
//   - wrapper.find('v-textarea') finds the <v-textarea> custom element
//   - wrapper.vm.inputText (exposed via defineExpose) lets us set the bound text
//   - wrapper.find('[data-testid="..."]') finds <v-btn> elements by attribute

describe('StreamInputBar (T842)', () => {
  const defaultProps = {
    isStreaming: false,
    ptyId: null,
    agentStopped: false,
    sessionId: 'sess-1',
    accentFg: '#00ff00',
  }

  it('renders a v-textarea for text input', () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps })
    expect(wrapper.find('v-textarea').exists()).toBe(true)
    wrapper.unmount()
  })

  it('emits send with the text when Enter is pressed', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps })
    wrapper.vm.inputText = 'Hello world'
    await nextTick()
    await wrapper.find('v-textarea').trigger('keydown', { key: 'Enter', shiftKey: false })
    expect(wrapper.emitted('send')).toBeTruthy()
    expect(wrapper.emitted('send')![0]).toEqual(['Hello world'])
    wrapper.unmount()
  })

  it('emits send with text when send button is clicked', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps })
    wrapper.vm.inputText = 'Click send'
    await nextTick()
    await wrapper.find('[data-testid="send-button"]').trigger('click')
    expect(wrapper.emitted('send')).toBeTruthy()
    expect(wrapper.emitted('send')![0]).toEqual(['Click send'])
    wrapper.unmount()
  })

  it('resets the input after send', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps })
    wrapper.vm.inputText = 'Reset me'
    await nextTick()
    await wrapper.find('v-textarea').trigger('keydown', { key: 'Enter', shiftKey: false })
    expect(wrapper.vm.inputText).toBe('')
    wrapper.unmount()
  })

  it('does not emit send when sessionId is null', async () => {
    const wrapper = mount(StreamInputBar, {
      props: { ...defaultProps, sessionId: null },
    })
    wrapper.vm.inputText = 'No session'
    await nextTick()
    await wrapper.find('[data-testid="send-button"]').trigger('click')
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('does not emit send when text is empty', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps })
    await wrapper.find('[data-testid="send-button"]').trigger('click')
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('shows stop button when isStreaming && ptyId && !agentStopped', () => {
    const wrapper = mount(StreamInputBar, {
      props: { ...defaultProps, isStreaming: true, ptyId: 'pty-1', agentStopped: false },
    })
    expect(wrapper.find('[data-testid="stop-button"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('emits stop when stop button clicked', async () => {
    const wrapper = mount(StreamInputBar, {
      props: { ...defaultProps, isStreaming: true, ptyId: 'pty-1', agentStopped: false },
    })
    await wrapper.find('[data-testid="stop-button"]').trigger('click')
    expect(wrapper.emitted('stop')).toBeTruthy()
    wrapper.unmount()
  })
})
