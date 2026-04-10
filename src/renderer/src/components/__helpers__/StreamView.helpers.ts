import { vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import StreamView from '@renderer/components/StreamView.vue'
import type { StreamEvent } from '@renderer/components/StreamView.vue'
import { mockElectronAPI } from '../../../../test/setup'
import i18n from '@renderer/plugins/i18n'

/**
 * Mount StreamView with a fake tab and inject stream events via the IPC callback.
 * T648: StreamView now uses agentCreate + onAgentStream (ADR-009 child_process.spawn).
 */
export async function mountStream(
  events: StreamEvent[] = [],
  options: { autoSend?: string | null; convId?: string | null } = {},
) {
  vi.mocked(mockElectronAPI.agentCreate).mockResolvedValue('agent-stream-1')
  vi.mocked(mockElectronAPI.onAgentStream).mockReset()
  vi.mocked(mockElectronAPI.onAgentStream).mockReturnValue(() => {})
  vi.mocked(mockElectronAPI.onAgentConvId).mockReset()
  vi.mocked(mockElectronAPI.onAgentConvId).mockReturnValue(() => {})
  vi.mocked(mockElectronAPI.onAgentExit).mockReset()
  vi.mocked(mockElectronAPI.onAgentExit).mockReturnValue(() => {})
  vi.mocked(mockElectronAPI.agentSend).mockResolvedValue(undefined)

  // Provide pinia with a tab matching terminalId so StreamView can find it.
  // T1855: activeTabId must match terminalId so flushEvents renders _html (deferred rendering).
  const pinia = createTestingPinia({
    stubActions: false,
    initialState: {
      tabs: {
        activeTabId: 'test-terminal-1',
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
  // T676: micro-batching -- drain pendingEvents buffer (nextTick) + Vue DOM update
  if (events.length > 0) await flushPromises()

  return { wrapper }
}
