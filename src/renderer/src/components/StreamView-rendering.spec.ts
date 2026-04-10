import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import type { StreamEvent } from '@renderer/components/StreamView.vue'
import { mountStream } from './__helpers__/StreamView.helpers'

describe('StreamView rendering', () => {
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
    // T648: bubble is pushed right after agentCreate + agentSend -- no system:init needed
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
