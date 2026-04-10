/**
 * Snapshot tests for AgentBadge (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'

import AgentBadge from '@renderer/components/AgentBadge.vue'

describe('AgentBadge — snapshots', () => {
  it('matches snapshot: inactive badge', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'dev-front-vuejs' },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: active badge with dot', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'review-master', active: true },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})
