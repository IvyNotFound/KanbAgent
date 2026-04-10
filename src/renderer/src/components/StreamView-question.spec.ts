import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import StreamView from '@renderer/components/StreamView.vue'
import type { StreamEvent } from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../test/setup'
import i18n from '@renderer/plugins/i18n'

// T1764 -- pendingQuestion Source 1 / Source 2
describe('StreamView pendingQuestion (T1764)', () => {
  async function mountStreamQ(events: StreamEvent[] = []) {
    vi.mocked(mockElectronAPI.agentCreate).mockResolvedValue('agent-q-1')
    vi.mocked(mockElectronAPI.onAgentStream).mockReset()
    vi.mocked(mockElectronAPI.onAgentStream).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentConvId).mockReset()
    vi.mocked(mockElectronAPI.onAgentConvId).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentExit).mockReset()
    vi.mocked(mockElectronAPI.onAgentExit).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)
    const pinia = createTestingPinia({
      stubActions: false,
      initialState: {
        tabs: { tabs: [{ id: 'tq-1', type: 'terminal', title: 'Q', ptyId: null, agentName: 'qa', wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, convId: null, viewMode: 'stream' as const }] },
      },
    })
    const wrapper = mount(StreamView, { props: { terminalId: 'tq-1' }, global: { plugins: [pinia, i18n] } })
    await flushPromises()
    const [, callback] = vi.mocked(mockElectronAPI.onAgentStream).mock.calls[0] ?? []
    if (callback) events.forEach((e) => (callback as (e: StreamEvent) => void)(e))
    if (events.length > 0) await flushPromises()
    return { wrapper }
  }

  it('Source 1: shows banner when input.question is present as a string', async () => {
    const assistantEvent: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { question: 'Direct question?' } }] },
    }
    const { wrapper } = await mountStreamQ([assistantEvent])
    const banner = wrapper.find('[data-testid="pending-question-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Direct question?')
    wrapper.unmount()
  })

  it('Source 2: shows banner via synthetic ask_user event when input.question is missing', async () => {
    const assistantEvent: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] },
    }
    const askUserEvent: StreamEvent = { type: 'ask_user', text: 'Synthetic question text?' }
    const { wrapper } = await mountStreamQ([assistantEvent, askUserEvent])
    const banner = wrapper.find('[data-testid="pending-question-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Synthetic question text?')
    wrapper.unmount()
  })

  it('hides banner after a user reply follows the AskUserQuestion block', async () => {
    const assistantEvent: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { question: 'A question?' } }] },
    }
    const userReply: StreamEvent = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'My reply' }] },
    }
    const { wrapper } = await mountStreamQ([assistantEvent, userReply])
    expect(wrapper.find('[data-testid="pending-question-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
