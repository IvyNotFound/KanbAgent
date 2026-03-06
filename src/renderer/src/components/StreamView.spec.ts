import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import StreamView from '@renderer/components/StreamView.vue'
import type { StreamEvent } from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../test/setup'
import i18n from '@renderer/plugins/i18n'

describe('StreamView', () => {
  // Helper to mount StreamView with a fake tab and inject stream events via the IPC callback.
  // T648: StreamView now uses agentCreate + onAgentStream (ADR-009 child_process.spawn).
  async function mountStream(events: StreamEvent[] = [], options: { autoSend?: string | null; convId?: string | null } = {}) {
    vi.mocked(mockElectronAPI.agentCreate).mockResolvedValue('agent-stream-1')
    vi.mocked(mockElectronAPI.onAgentStream).mockReset()
    vi.mocked(mockElectronAPI.onAgentStream).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentConvId).mockReset()
    vi.mocked(mockElectronAPI.onAgentConvId).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentExit).mockReset()
    vi.mocked(mockElectronAPI.onAgentExit).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)

    // Provide pinia with a tab matching terminalId so StreamView can find it
    const pinia = createTestingPinia({
      stubActions: false,
      initialState: {
        tabs: {
          tabs: [{
            id: 'test-terminal-1',
            type: 'terminal',
            title: 'test',
            ptyId: null,
            agentName: 'test-agent',
            wslDistro: null,
            autoSend: options.autoSend ?? null,
            systemPrompt: null,
            thinkingMode: null,
            convId: options.convId ?? null,
            viewMode: 'stream' as const,
          }],
        },
      },
    })

    const wrapper = mount(StreamView, {
      props: { terminalId: 'test-terminal-1' },
      global: { plugins: [pinia, i18n] },
    })

    // Wait for async agentCreate + onAgentStream subscription
    await flushPromises()

    // Inject events via the IPC callback (called with agentId='agent-stream-1')
    const [, callback] = vi.mocked(mockElectronAPI.onAgentStream).mock.calls[0] ?? []
    if (callback) {
      events.forEach((e) => (callback as (e: StreamEvent) => void)(e))
    }
    // T676: micro-batching — drain pendingEvents buffer (nextTick) + Vue DOM update
    if (events.length > 0) await flushPromises()

    return { wrapper }
  }

  it('shows empty state when no events', async () => {
    const { wrapper } = await mountStream()
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
  })

  it('renders text block (assistant message)', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Bonjour depuis Claude !' }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-text"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('Bonjour depuis Claude !')
  })

  it('does not render thinking block in message list (T903)', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', text: 'Je réfléchis…' }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-thinking"]')
    expect(block.exists()).toBe(false)
  })

  it('renders tool_use block with tool name', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-tool-use"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('Bash')
  })

  it('renders tool_result block with output text', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: 'drwxr-xr-x 5 user user 4096 Feb 27 00:00 .' }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-tool-result"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('drwxr-xr-x')
  })

  it('renders result block with cost and turns', async () => {
    const event: StreamEvent = {
      type: 'result',
      cost_usd: 0.0042,
      num_turns: 3,
      duration_ms: 5200,
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-result"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('3')
    expect(block.text()).toContain('$0.0042')
  })

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
    const { wrapper } = await mountStream()
    const btn = wrapper.find('[data-testid="send-button"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls agentSend with message on send (T648)', async () => {
    // T648: sendMessage uses agentSend via stdin JSONL — no PTY respawn needed (ADR-009)
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Hello agent')
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await flushPromises()
    expect(mockElectronAPI.agentSend).toHaveBeenLastCalledWith('agent-stream-1', 'Hello agent')
  })

  it('clears input after send', async () => {
    // T648: send requires sessionId — use convId shortcut to enable the button
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Mon message')
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await flushPromises()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
  })

  it('registers system:init session_id', async () => {
    const initEvent: StreamEvent = {
      type: 'system',
      subtype: 'init',
      session_id: 'abc123-session-id',
    }
    const { wrapper } = await mountStream([initEvent])
    await nextTick()
    const systemBlock = wrapper.find('[data-testid="block-system-init"]')
    expect(systemBlock.exists()).toBe(true)
    expect(systemBlock.text()).toContain('Session démarrée')
  })

  it('renders user message as right-aligned bubble (T603)', async () => {
    const event: StreamEvent = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'coucou' }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-user"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('coucou')
    expect(block.classes()).toContain('justify-end')
  })

  it('suppresses empty user bubbles from autonomous Claude reasoning (T679)', async () => {
    // T679: user events with empty/whitespace-only text must not render a bubble
    const emptyEvent: StreamEvent = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '' }] },
    }
    const whitespaceEvent: StreamEvent = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '   ' }] },
    }
    const realEvent: StreamEvent = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'message réel' }] },
    }
    const { wrapper } = await mountStream([emptyEvent, whitespaceEvent, realEvent])
    await nextTick()
    const blocks = wrapper.findAll('[data-testid="block-user"]')
    expect(blocks.length).toBe(1)
    expect(blocks[0].text()).toContain('message réel')
  })

  it('displays autoSend as user bubble immediately after agentCreate (T607)', async () => {
    // T648: bubble is pushed right after agentCreate + agentSend — no system:init needed
    const { wrapper } = await mountStream([], { autoSend: 'Mon prompt initial' })
    await nextTick()
    const userBlocks = wrapper.findAll('[data-testid="block-user"]')
    expect(userBlocks.length).toBe(1)
    expect(userBlocks[0].text()).toContain('Mon prompt initial')
    expect(userBlocks[0].classes()).toContain('justify-end')
  })

  it('does not display user bubble when autoSend is null (T607)', async () => {
    // T607: no bubble pushed when autoSend is null
    const { wrapper } = await mountStream([])
    await nextTick()
    expect(wrapper.find('[data-testid="block-user"]').exists()).toBe(false)
  })

  it('calls agentCreate on mount with tab config (T648)', async () => {
    // T648: agentCreate replaces terminalCreate — no cols/rows/outputFormat needed (ADR-009)
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
    // T648: resume with convId but no autoSend → set sessionId from tab.convId immediately
    // so the Envoyer button is enabled right away (system:init may not fire until first send).
    // agentCreate IS still called (unlike old PTY shortcut which skipped spawn entirely).
    const { wrapper } = await mountStream([], { convId: 'abc123-session-id', autoSend: null })
    await nextTick()
    // agentCreate was called with the convId
    expect(mockElectronAPI.agentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ convId: 'abc123-session-id' })
    )
    // Send button should be enabled (sessionId set from convId shortcut)
    const btn = wrapper.find('[data-testid="send-button"]')
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Premier message')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('displays sent message as user bubble immediately (T605)', async () => {
    // T648: send requires sessionId — use convId shortcut to enable the button
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Bonjour Claude')
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await nextTick()
    const userBlock = wrapper.find('[data-testid="block-user"]')
    expect(userBlock.exists()).toBe(true)
    expect(userBlock.text()).toContain('Bonjour Claude')
    expect(userBlock.classes()).toContain('justify-end')
  })

  it('stop-button is absent when agent is not streaming (T683)', async () => {
    const { wrapper } = await mountStream([])
    expect(wrapper.find('[data-testid="stop-button"]').exists()).toBe(false)
  })

  it('stop-button is visible when isStreaming=true and ptyId set (T683)', async () => {
    // Inject an assistant event without a trailing result event → isStreaming stays true
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

  it('stop-button disappears after click (agentStopped flag, T683)', async () => {
    const event: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'En cours…' }] },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    await wrapper.find('[data-testid="stop-button"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="stop-button"]').exists()).toBe(false)
  })

  it('renders error:spawn event as red error block (T694)', async () => {
    const event: StreamEvent = { type: 'error:spawn', error: 'spawn ENOENT' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-error"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('error:spawn')
    expect(block.text()).toContain('spawn ENOENT')
  })

  it('does not render error:stderr events — type deprecated, never emitted (T697)', async () => {
    const event: StreamEvent = { type: 'error:stderr', error: 'bash: claude: command not found' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    // error:stderr is no longer rendered — stderr is buffered and included in error:exit instead
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

  it('normal assistant/user/result blocks unaffected by error types (T694)', async () => {
    const assistant: StreamEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Réponse normale' }] },
    }
    const result: StreamEvent = { type: 'result', cost_usd: 0.001, num_turns: 1 }
    const { wrapper } = await mountStream([assistant, result])
    await nextTick()
    expect(wrapper.find('[data-testid="block-text"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="block-result"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="block-error"]').exists()).toBe(false)
  })

  it('evicts events to MAX_EVENTS_HIDDEN (50) when tab becomes inactive (T962)', async () => {
    let streamCallback: ((e: Record<string, unknown>) => void) | null = null
    vi.mocked(mockElectronAPI.agentCreate).mockResolvedValue('agent-stream-1')
    vi.mocked(mockElectronAPI.onAgentStream).mockReset()
    vi.mocked(mockElectronAPI.onAgentStream).mockImplementation((_id, cb) => {
      streamCallback = cb as (e: Record<string, unknown>) => void
      return () => {}
    })
    vi.mocked(mockElectronAPI.onAgentConvId).mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentExit).mockReturnValue(() => {})

    const pinia = createTestingPinia({
      stubActions: false,
      initialState: {
        tabs: {
          tabs: [{
            id: 'test-terminal-1',
            type: 'terminal',
            title: 'test',
            ptyId: null,
            agentName: 'test-agent',
            wslDistro: null,
            autoSend: null,
            systemPrompt: null,
            thinkingMode: null,
            convId: null,
            viewMode: 'stream' as const,
          }],
        },
      },
    })

    const wrapper = mount(StreamView, {
      props: { terminalId: 'test-terminal-1' },
      global: { plugins: [pinia, i18n] },
    })
    await flushPromises()

    // Inject 100 result events
    for (let i = 0; i < 100; i++) {
      streamCallback?.({ type: 'result', num_turns: i })
    }
    await flushPromises()
    expect(wrapper.findAll('[data-testid="block-result"]').length).toBe(100)

    // Activate then deactivate the tab via real store action (updates ref.value, triggers watcher)
    const store = pinia._s.get('tabs') as { setActive: (id: string) => void; activeTabId: string }
    store.setActive('test-terminal-1')
    await flushPromises()
    expect(store.activeTabId).toBe('test-terminal-1')
    store.setActive('other-tab')
    await flushPromises()
    expect(store.activeTabId).toBe('other-tab')

    expect(wrapper.findAll('[data-testid="block-result"]').length).toBeLessThanOrEqual(50)
    wrapper.unmount()
  })
})
