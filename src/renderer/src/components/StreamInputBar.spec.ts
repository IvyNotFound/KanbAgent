import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import en from '@renderer/locales/en.json'
import StreamInputBar from '@renderer/components/StreamInputBar.vue'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

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
    accentOnFg: '#000000',
  }
  const mountOptions = { global: { plugins: [i18n] } }

  it('renders a v-textarea for text input', () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    expect(wrapper.find('v-textarea').exists()).toBe(true)
    wrapper.unmount()
  })

  it('emits send with the text when Enter is pressed', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    wrapper.vm.inputText = 'Hello world'
    await nextTick()
    await wrapper.find('v-textarea').trigger('keydown', { key: 'Enter', shiftKey: false })
    expect(wrapper.emitted('send')).toBeTruthy()
    expect(wrapper.emitted('send')![0]).toEqual(['Hello world', []])
    wrapper.unmount()
  })

  it('emits send with text when send button is clicked', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    wrapper.vm.inputText = 'Click send'
    await nextTick()
    await wrapper.find('[data-testid="send-button"]').trigger('click')
    expect(wrapper.emitted('send')).toBeTruthy()
    expect(wrapper.emitted('send')![0]).toEqual(['Click send', []])
    wrapper.unmount()
  })

  it('resets the input after send', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    wrapper.vm.inputText = 'Reset me'
    await nextTick()
    await wrapper.find('v-textarea').trigger('keydown', { key: 'Enter', shiftKey: false })
    expect(wrapper.vm.inputText).toBe('')
    wrapper.unmount()
  })

  it('does not emit send when sessionId is null', async () => {
    const wrapper = mount(StreamInputBar, {
      props: { ...defaultProps, sessionId: null },
      ...mountOptions,
    })
    wrapper.vm.inputText = 'No session'
    await nextTick()
    await wrapper.find('[data-testid="send-button"]').trigger('click')
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('does not emit send when text is empty', async () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    await wrapper.find('[data-testid="send-button"]').trigger('click')
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('shows stop button even when not streaming (always visible, T1569)', () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    expect(wrapper.find('[data-testid="stop-button"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('stop button has disabled attribute when not streaming (T1569)', () => {
    const wrapper = mount(StreamInputBar, { props: defaultProps, ...mountOptions })
    const btn = wrapper.find('[data-testid="stop-button"]')
    expect(btn.attributes('disabled')).not.toBeUndefined()
    wrapper.unmount()
  })

  it('stop button disabled attribute is false when streaming with ptyId (T1569)', () => {
    const wrapper = mount(StreamInputBar, {
      props: { ...defaultProps, isStreaming: true, ptyId: 'pty-1', agentStopped: false },
      ...mountOptions,
    })
    const btn = wrapper.find('[data-testid="stop-button"]')
    // custom element renders :disabled="false" as attribute "false" (not absent)
    expect(btn.attributes('disabled')).toBe('false')
    wrapper.unmount()
  })

  it('emits stop when stop button clicked', async () => {
    const wrapper = mount(StreamInputBar, {
      props: { ...defaultProps, isStreaming: true, ptyId: 'pty-1', agentStopped: false },
      ...mountOptions,
    })
    await wrapper.find('[data-testid="stop-button"]').trigger('click')
    expect(wrapper.emitted('stop')).toBeTruthy()
    wrapper.unmount()
  })
})
