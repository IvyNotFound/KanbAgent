import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import GitCommitList from '@renderer/components/GitCommitList.vue'
import i18n from '@renderer/plugins/i18n'

describe('GitCommitList', () => {
  const commits = [
    { hash: 'abc1234def5678', date: '2026-01-15T10:00:00Z', subject: 'feat: add login', author: 'dev-front', taskIds: [42, 100] },
    { hash: 'bcd2345ef01234', date: '2026-01-14T09:00:00Z', subject: 'fix: typo', author: 'dev-back', taskIds: [] },
  ]

  it('renders all commits when no filterTaskId', () => {
    const wrapper = mount(GitCommitList, { props: { commits }, global: { plugins: [i18n] } })
    expect(wrapper.findAll('.commit-row').length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })

  it('shows task badges for commits with taskIds', () => {
    const wrapper = mount(GitCommitList, { props: { commits }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('T42')
    expect(wrapper.text()).toContain('T100')
    wrapper.unmount()
  })

  it('filters by filterTaskId', () => {
    const wrapper = mount(GitCommitList, { props: { commits, filterTaskId: 42 }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('feat: add login')
    expect(wrapper.text()).not.toContain('fix: typo')
    wrapper.unmount()
  })

  it('emits openTask when badge is clicked', async () => {
    const wrapper = mount(GitCommitList, { props: { commits }, global: { plugins: [i18n] } })
    const badge = wrapper.findAll('v-chip').find(b => b.text().trim() === 'T42')
    expect(badge).toBeDefined()
    await badge!.trigger('click')
    expect(wrapper.emitted('openTask')).toBeTruthy()
    expect(wrapper.emitted('openTask')![0]).toEqual([42])
    wrapper.unmount()
  })

  it('shows hash truncated to 7 chars', () => {
    const wrapper = mount(GitCommitList, { props: { commits }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('abc1234')
    expect(wrapper.text()).not.toContain('abc1234def5678')
    wrapper.unmount()
  })
})
