import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import StreamInputBar from '@renderer/components/StreamInputBar.vue'
import type { StreamEvent } from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../test/setup'
import { mountStream } from './__helpers__/StreamView.helpers'

describe('StreamView input and send', () => {
  it('shows streaming indicator while last event is assistant (no result yet)', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'En cours…' }] },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    expect(wrapper.find('[data-testid="streaming-indicator"]').exists()).toBe(true)
  })

  it('hides streaming indicator after result event', async () => {
    const assistant: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Réponse' }] },
    }
    const result: StreamEvent = { type: 'result', cost_usd: 0.001, num_turns: 1 }
    const { wrapper } = await mountStream([assistant, result])
    await nextTick()
    expect(wrapper.find('[data-testid="streaming-indicator"]').exists()).toBe(false)
  })

  it('send button is disabled when input is empty', async () => {
    // v-btn is a custom element -- Vue sets :disabled as DOM attribute (not .disabled property)
    const { wrapper } = await mountStream()
    const btn = wrapper.find('[data-testid="send-button"]')
    expect(btn.element.hasAttribute('disabled')).toBe(true)
  })

  it('calls agentSend with message on send (T648)', async () => {
    // T648: sendMessage uses agentSend via stdin JSONL -- no PTY respawn needed (ADR-009)
    // v-textarea is a custom element -- set text via StreamInputBar's exposed inputText ref
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)
    wrapper.findComponent(StreamInputBar).vm.inputText = 'Hello agent'
    await nextTick()
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await flushPromises()
    expect(mockElectronAPI.agentSend).toHaveBeenLastCalledWith('agent-stream-1', 'Hello agent')
  })

  it('clears input after send', async () => {
    // T648: send requires sessionId -- use convId shortcut to enable the button
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    const inputBar = wrapper.findComponent(StreamInputBar)
    inputBar.vm.inputText = 'Mon message'
    await nextTick()
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await flushPromises()
    expect(inputBar.vm.inputText).toBe('')
  })

  it('calls agentCreate on mount with tab config (T648)', async () => {
    // T648: agentCreate replaces terminalCreate -- no cols/rows/outputFormat needed (ADR-009)
    await mountStream([], { autoSend: 'Mon prompt' })
    expect(mockElectronAPI.agentCreate).toHaveBeenCalledWith({
      projectPath: undefined,
      wslDistro: undefined,
      systemPrompt: undefined,
      thinkingMode: undefined,
      claudeCommand: undefined,
      convId: undefined,
    })
  })

  it('sets sessionId from convId shortcut on resume, enables send button (T648)', async () => {
    // T648: resume with convId but no autoSend -> set sessionId from tab.convId immediately
    // so the Envoyer button is enabled right away (system:init may not fire until first send).
    // agentCreate IS still called (unlike old PTY shortcut which skipped spawn entirely).
    const { wrapper } = await mountStream([], { convId: 'abc123-session-id', autoSend: null })
    await nextTick()
    // agentCreate was called with the convId
    expect(mockElectronAPI.agentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ convId: 'abc123-session-id' })
    )
    // Send button should be enabled once sessionId is set from convId shortcut.
    // Verify the prop is correctly propagated to StreamInputBar.
    const inputBar = wrapper.findComponent(StreamInputBar)
    expect(inputBar.props('sessionId')).toBe('abc123-session-id')
  })

  it('displays sent message as user bubble immediately (T605)', async () => {
    // T648: send requires sessionId -- use convId shortcut to enable the button
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    wrapper.findComponent(StreamInputBar).vm.inputText = 'Bonjour Claude'
    await nextTick()
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await nextTick()
    const userBlock = wrapper.find('[data-testid="block-user"]')
    expect(userBlock.exists()).toBe(true)
    expect(userBlock.text()).toContain('Bonjour Claude')
    expect(userBlock.classes()).toContain('block-user')
  })

  it('shows streaming indicator while last event is type:text (T1197)', async () => {
    const event: StreamEvent = { type: 'text', text: 'Streaming output line…' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    expect(wrapper.find('[data-testid="streaming-indicator"]').exists()).toBe(true)
  })
})

describe('StreamView stop button', () => {
  it('stop-button is disabled when agent is not streaming (T683, T1536, T1569)', async () => {
    // T1569: button stays in DOM with :disabled=true when isStreaming=false
    const { wrapper } = await mountStream([])
    const btn = wrapper.find('[data-testid="stop-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('stop-button is visible when isStreaming=true and ptyId set (T683)', async () => {
    // Inject an assistant event without a trailing result event -> isStreaming stays true
    const event: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Réponse en cours…' }] },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    expect(wrapper.find('[data-testid="stop-button"]').exists()).toBe(true)
  })

  it('stop-button click calls agentKill with ptyId (T683)', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'En cours…' }] },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const stopBtn = wrapper.find('[data-testid="stop-button"]')
    expect(stopBtn.exists()).toBe(true)
    await stopBtn.trigger('click')
    expect(mockElectronAPI.agentKill).toHaveBeenCalledWith('agent-stream-1')
  })

  it('stop-button becomes disabled after click (agentStopped flag, T683, T1536, T1569)', async () => {
    // T1569: button stays in DOM with :disabled=true after click (agentStopped=true)
    const event: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'En cours…' }] },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    await wrapper.find('[data-testid="stop-button"]').trigger('click')
    await nextTick()
    const btn = wrapper.find('[data-testid="stop-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })
})

describe('StreamView error blocks', () => {
  it('renders error:spawn event as red error block (T694)', async () => {
    const event: StreamEvent = { type: 'error:spawn', error: 'spawn ENOENT' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-error"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('error:spawn')
    expect(block.text()).toContain('spawn ENOENT')
  })

  it('does not render error:stderr events -- type deprecated, never emitted (T697)', async () => {
    const event: StreamEvent = { type: 'error:stderr', error: 'bash: claude: command not found' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    // error:stderr is no longer rendered -- stderr is buffered and included in error:exit instead
    expect(wrapper.find('[data-testid="block-error"]').exists()).toBe(false)
  })

  it('renders error:exit event as red error block (T694)', async () => {
    const event: StreamEvent = { type: 'error:exit', error: 'Process exited with code 127' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-error"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('error:exit')
    expect(block.text()).toContain('Process exited with code 127')
  })

  it('renders error:exit with stderr buffer content (T697)', async () => {
    const event: StreamEvent = {
      type: 'error:exit',
      error: 'Process exited with code 1',
      stderr: 'bash: command not found: claude\nsome other error',
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-error"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('bash: command not found: claude')
  })
})
