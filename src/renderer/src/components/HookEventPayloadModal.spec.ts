import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createTestingPinia } from '@pinia/testing'
import en from '@renderer/locales/en.json'
import HookEventPayloadModal from '@renderer/components/HookEventPayloadModal.vue'
import type { HookEvent } from '@renderer/stores/hookEvents'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
const pinia = createTestingPinia({ initialState: { settings: { theme: 'dark' } } })

describe('HookEventPayloadModal (T756)', () => {
  const makeEvent = (overrides: Partial<HookEvent> = {}): HookEvent => ({
    id: 1,
    event: 'PreToolUse',
    payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
    ts: 1700000000000,
    sessionId: 'sess-1',
    ...overrides,
  })

  it('renders event type in header', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent() },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('PreToolUse')
    wrapper.unmount()
  })

  it('shows tool name in header for PreToolUse event', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent() },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('Bash')
    wrapper.unmount()
  })

  it('shows structured tool view (not raw JSON) for tool events', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent() },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    // Structured view: no JSON key wrapping with quotes
    expect(wrapper.text()).not.toContain('"tool_name"')
    // The command is shown inside the structured Bash view
    expect(wrapper.text()).toContain('ls')
    wrapper.unmount()
  })

  it('displays raw JSON for non-tool events', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent({ event: 'SessionStart', payload: { session_id: 'abc-123' } }) },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('"session_id"')
    expect(wrapper.text()).toContain('"abc-123"')
    wrapper.unmount()
  })

  it('shows output section for PostToolUse', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: {
        event: makeEvent({
          event: 'PostToolUse',
          payload: { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_output: 'file.txt\ndir/' },
        }),
      },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('output')
    expect(wrapper.text()).toContain('file.txt')
    wrapper.unmount()
  })

  it('shows error section for PostToolUseFailure', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: {
        event: makeEvent({
          event: 'PostToolUseFailure',
          payload: { tool_name: 'Bash', tool_input: { command: 'bad' }, error: 'command not found' },
        }),
      },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('error')
    expect(wrapper.text()).toContain('command not found')
    wrapper.unmount()
  })

  it('shows "No payload data" when payload is null', () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent({ payload: null }) },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    expect(wrapper.text()).toContain('No payload data')
    wrapper.unmount()
  })

  it('emits close when × button clicked', async () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent() },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    await wrapper.find('v-btn').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('emits close when backdrop clicked', async () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent() },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    // v-dialog handles the overlay click; the inner wrapper has @click.self as a test-compat fallback
    await wrapper.find('[data-testid="payload-modal-backdrop"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('emits close on Escape keydown', async () => {
    const wrapper = mount(HookEventPayloadModal, {
      props: { event: makeEvent() },
      attachTo: document.body,
      global: { plugins: [i18n, pinia] },
    })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
