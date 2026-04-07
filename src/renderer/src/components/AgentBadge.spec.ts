import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import AgentBadge from '@renderer/components/AgentBadge.vue'

describe('AgentBadge', () => {
  it('renders agent name text', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'review-master' },
    })
    expect(wrapper.text()).toContain('review-master')
  })

  it('applies agentFg as inline color style', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'review-master' },
    })
    const style = wrapper.attributes('style') || ''
    // Should have color, backgroundColor, borderColor in style
    expect(style).toContain('color')
    expect(style).toContain('background-color')
    expect(style).toContain('border-color')
  })

  it('shows activity dot when active prop is true', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'dev-front', active: true },
    })
    const dot = wrapper.find('.activity-dot')
    expect(dot.exists()).toBe(true)
  })

  it('does not show activity dot when active is false or absent', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'dev-front' },
    })
    const dot = wrapper.find('.activity-dot')
    expect(dot.exists()).toBe(false)
  })

  it('sets title attribute to agent name', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'arch' },
    })
    expect(wrapper.attributes('title')).toBe('arch')
  })
})
