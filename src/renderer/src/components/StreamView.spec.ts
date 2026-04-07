import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import StreamView from '@renderer/components/StreamView.vue'
import StreamInputBar from '@renderer/components/StreamInputBar.vue'
import type { StreamEvent } from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../test/setup'
import i18n from '@renderer/plugins/i18n'
import { useTabsStore } from '@renderer/stores/tabs'

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
    // v-btn is a custom element — Vue sets :disabled as DOM attribute (not .disabled property)
    const { wrapper } = await mountStream()
    const btn = wrapper.find('[data-testid="send-button"]')
    expect(btn.element.hasAttribute('disabled')).toBe(true)
  })

  it('calls agentSend with message on send (T648)', async () => {
    // T648: sendMessage uses agentSend via stdin JSONL — no PTY respawn needed (ADR-009)
    // v-textarea is a custom element — set text via StreamInputBar's exposed inputText ref
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
    // T648: send requires sessionId — use convId shortcut to enable the button
    const { wrapper } = await mountStream([], { convId: 'test-session-id' })
    const inputBar = wrapper.findComponent(StreamInputBar)
    inputBar.vm.inputText = 'Mon message'
    await nextTick()
    const btn = wrapper.find('[data-testid="send-button"]')
    await btn.trigger('click')
    await flushPromises()
    expect(inputBar.vm.inputText).toBe('')
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
    expect(block.classes()).toContain('block-user')
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
    expect(userBlocks[0].classes()).toContain('block-user')
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
    // Send button should be enabled once sessionId is set from convId shortcut.
    // Verify the prop is correctly propagated to StreamInputBar.
    const inputBar = wrapper.findComponent(StreamInputBar)
    expect(inputBar.props('sessionId')).toBe('abc123-session-id')
  })

  it('displays sent message as user bubble immediately (T605)', async () => {
    // T648: send requires sessionId — use convId shortcut to enable the button
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

  it('stop-button is disabled when agent is not streaming (T683, T1536, T1569)', async () => {
    // T1569: button stays in DOM with :disabled=true when isStreaming=false
    const { wrapper } = await mountStream([])
    const btn = wrapper.find('[data-testid="stop-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
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

  it('renders type:text event as text block (T1197)', async () => {
    const event: StreamEvent = { type: 'text', text: 'Hello from Gemini!' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-text-raw"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('Hello from Gemini!')
  })

  it('renders type:error event as red error block (T1197)', async () => {
    const event: StreamEvent = { type: 'error', text: 'OpenCode error occurred' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-error-raw"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('OpenCode error occurred')
  })

  it('shows streaming indicator while last event is type:text (T1197)', async () => {
    const event: StreamEvent = { type: 'text', text: 'Streaming output line…' }
    const { wrapper } = await mountStream([event])
    await nextTick()
    expect(wrapper.find('[data-testid="streaming-indicator"]').exists()).toBe(true)
  })

  it('renders image_ref block as thumbnail in user bubble (T1718)', async () => {
    const event: StreamEvent = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'image_ref', path: '/tmp/img.png', objectUrl: 'blob:test-url' }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    const block = wrapper.find('[data-testid="block-user"]')
    expect(block.exists()).toBe(true)
    const img = wrapper.find('[data-testid="user-thumbnail"]')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:test-url')
  })

  it('shows user bubble for image-only message (no text) (T1718)', async () => {
    const event: StreamEvent = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'image_ref', path: '/tmp/img.png', objectUrl: 'blob:only-image' }],
      },
    }
    const { wrapper } = await mountStream([event])
    await nextTick()
    expect(wrapper.find('[data-testid="block-user"]').exists()).toBe(true)
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
})

describe('StreamView auto-close on process exit (T1373)', () => {
  async function mountWithCli(cli: string | null, options: { agentName?: string; agentType?: string } = {}) {
    const agentName = options.agentName ?? 'test-agent'

    vi.mocked(mockElectronAPI.agentCreate).mockResolvedValue('agent-stream-1')
    vi.mocked(mockElectronAPI.onAgentStream).mockReset().mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentConvId).mockReset().mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.onAgentExit).mockReset().mockReturnValue(() => {})
    vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)

    const agents = options.agentType
      ? [{ id: 1, name: agentName, type: options.agentType, scope: null, system_prompt: null, system_prompt_suffix: null, thinking_mode: null, allowed_tools: null, auto_launch: 1, permission_mode: null, max_sessions: 3, worktree_enabled: null, created_at: '' }]
      : []

    const pinia = createTestingPinia({
      stubActions: false,
      initialState: {
        tabs: {
          tabs: [{
            id: 'test-terminal-1',
            type: 'terminal',
            title: 'test',
            ptyId: null,
            agentName,
            wslDistro: null,
            autoSend: null,
            systemPrompt: null,
            thinkingMode: null,
            cli,
          }],
        },
        agents: { agents },
      },
    })

    mount(StreamView, {
      props: { terminalId: 'test-terminal-1' },
      global: { plugins: [pinia, i18n] },
    })

    await flushPromises()

    const tabsStore = useTabsStore(pinia)
    return { pinia, tabsStore }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes tab after 3s on exit for cli=codex (T1373)', async () => {
    const { tabsStore } = await mountWithCli('codex')
    const closeTabSpy = vi.spyOn(tabsStore, 'closeTab')
    vi.useFakeTimers()

    const [, exitCallback] = vi.mocked(mockElectronAPI.onAgentExit).mock.calls[0] ?? []
    ;(exitCallback as (code: number | null) => void)(0)

    expect(closeTabSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(closeTabSpy).toHaveBeenCalledWith('test-terminal-1')
  })

  it('does NOT close tab on exit for cli=claude (T1373)', async () => {
    const { tabsStore } = await mountWithCli('claude')
    const closeTabSpy = vi.spyOn(tabsStore, 'closeTab')
    vi.useFakeTimers()

    const [, exitCallback] = vi.mocked(mockElectronAPI.onAgentExit).mock.calls[0] ?? []
    ;(exitCallback as (code: number | null) => void)(0)

    vi.advanceTimersByTime(5000)
    expect(closeTabSpy).not.toHaveBeenCalled()
  })

  it('does NOT close tab on exit when agentName=task-creator (T1373)', async () => {
    const { tabsStore } = await mountWithCli('aider', { agentName: 'task-creator' })
    const closeTabSpy = vi.spyOn(tabsStore, 'closeTab')
    vi.useFakeTimers()

    const [, exitCallback] = vi.mocked(mockElectronAPI.onAgentExit).mock.calls[0] ?? []
    ;(exitCallback as (code: number | null) => void)(0)

    vi.advanceTimersByTime(5000)
    expect(closeTabSpy).not.toHaveBeenCalled()
  })

  it('does NOT close tab on exit when agent.type=task-creator (T1373)', async () => {
    const { tabsStore } = await mountWithCli('aider', { agentType: 'task-creator' })
    const closeTabSpy = vi.spyOn(tabsStore, 'closeTab')
    vi.useFakeTimers()

    const [, exitCallback] = vi.mocked(mockElectronAPI.onAgentExit).mock.calls[0] ?? []
    ;(exitCallback as (code: number | null) => void)(0)

    vi.advanceTimersByTime(5000)
    expect(closeTabSpy).not.toHaveBeenCalled()
  })
})

// T1764 — pendingQuestion Source 1 / Source 2
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
