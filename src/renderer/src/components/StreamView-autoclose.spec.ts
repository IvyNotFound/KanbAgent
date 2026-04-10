import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import StreamView from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../test/setup'
import i18n from '@renderer/plugins/i18n'
import { useTabsStore } from '@renderer/stores/tabs'

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

  it('closes tab after 3s on exit for cli=claude (T1820)', async () => {
    const { tabsStore } = await mountWithCli('claude')
    const closeTabSpy = vi.spyOn(tabsStore, 'closeTab')
    vi.useFakeTimers()

    const [, exitCallback] = vi.mocked(mockElectronAPI.onAgentExit).mock.calls[0] ?? []
    ;(exitCallback as (code: number | null) => void)(0)

    expect(closeTabSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(closeTabSpy).toHaveBeenCalledWith('test-terminal-1')
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

  it('does NOT close tab on exit when agent.type=planner (T1373)', async () => {
    const { tabsStore } = await mountWithCli('aider', { agentType: 'planner' })
    const closeTabSpy = vi.spyOn(tabsStore, 'closeTab')
    vi.useFakeTimers()

    const [, exitCallback] = vi.mocked(mockElectronAPI.onAgentExit).mock.calls[0] ?? []
    ;(exitCallback as (code: number | null) => void)(0)

    vi.advanceTimersByTime(5000)
    expect(closeTabSpy).not.toHaveBeenCalled()
  })
})
