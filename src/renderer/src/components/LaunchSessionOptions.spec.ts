import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '@renderer/locales/en.json'
import LaunchSessionOptions from '@renderer/components/LaunchSessionOptions.vue'
import type { CliCapabilities } from '@shared/cli-types'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

// Full caps — all features enabled
const FULL_CAPS: CliCapabilities = {
  worktree: true,
  profileSelection: true,
  systemPrompt: true,
  thinkingMode: true,
  convResume: true,
  modelSelection: true,
}

// Minimal caps — no optional features
const MINIMAL_CAPS: CliCapabilities = {
  worktree: true,
  profileSelection: false,
  systemPrompt: false,
  thinkingMode: false,
  convResume: false,
  modelSelection: false,
}

const MODELS = [
  { title: 'claude-opus-4-7', value: 'claude-opus-4-7' },
  { title: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
]

const BASE_PROPS = {
  caps: FULL_CAPS,
  availableModels: MODELS,
  defaultModelLabel: 'claude-sonnet-4-6',
  lastConvId: 'conv-abc123',
  worktreeSource: 'global' as const,
  worktreeError: null,
  accentColor: '#7c3aed',
  selectedModel: null,
  useResume: false,
  thinkingMode: 'auto' as const,
  customPrompt: '',
  multiInstance: false,
}

describe('LaunchSessionOptions (T1975)', () => {
  // ── Model selection section ─────────────────────────────────────────────────

  it('shows v-select when caps.modelSelection=true and models are available', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: BASE_PROPS,
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('v-select').exists()).toBe(true)
    wrapper.unmount()
  })

  it('hides v-select when caps.modelSelection=false', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, caps: { ...FULL_CAPS, modelSelection: false } },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('v-select').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides v-select when availableModels is empty (even with modelSelection=true)', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, availableModels: [] },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('v-select').exists()).toBe(false)
    wrapper.unmount()
  })

  it('v-select has the correct model-value attribute bound from selectedModel prop', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, selectedModel: 'claude-opus-4-7' },
      global: { plugins: [i18n] },
    })
    const vSelect = wrapper.find('v-select')
    // Vue binds :model-value as an attribute on custom elements
    expect(vSelect.attributes('model-value')).toBe('claude-opus-4-7')
    wrapper.unmount()
  })

  // ── Resume session section ──────────────────────────────────────────────────

  it('shows resume switch when caps.convResume=true and lastConvId is set', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: BASE_PROPS,
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('[data-testid="switch-resume"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('hides resume switch when caps.convResume=false', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, caps: { ...FULL_CAPS, convResume: false } },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('[data-testid="switch-resume"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides resume switch when lastConvId is null (even with convResume=true)', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, lastConvId: null },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('[data-testid="switch-resume"]').exists()).toBe(false)
    wrapper.unmount()
  })

  // ── Thinking mode section ───────────────────────────────────────────────────

  it('shows thinking mode v-btn-toggle when caps.thinkingMode=true', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: BASE_PROPS,
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('v-btn-toggle').exists()).toBe(true)
    wrapper.unmount()
  })

  it('hides thinking mode v-btn-toggle when caps.thinkingMode=false', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, caps: MINIMAL_CAPS },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('v-btn-toggle').exists()).toBe(false)
    wrapper.unmount()
  })

  it('thinking mode toggle shows auto and disabled buttons', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: BASE_PROPS,
      global: { plugins: [i18n] },
    })
    // The toggle contains two v-btn elements
    const btns = wrapper.findAll('v-btn-toggle v-btn')
    expect(btns).toHaveLength(2)
    wrapper.unmount()
  })

  // ── Custom prompt section ───────────────────────────────────────────────────

  it('always renders the custom prompt v-textarea', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, caps: MINIMAL_CAPS },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('v-textarea').exists()).toBe(true)
    wrapper.unmount()
  })

  it('v-textarea has the correct model-value attribute bound from customPrompt prop', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, customPrompt: 'My custom prompt' },
      global: { plugins: [i18n] },
    })
    const vTextarea = wrapper.find('v-textarea')
    expect(vTextarea.attributes('model-value')).toBe('My custom prompt')
    wrapper.unmount()
  })

  // ── Multi-instance / worktree section ───────────────────────────────────────

  it('always renders the multi-instance v-switch', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, caps: MINIMAL_CAPS },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('[data-testid="switch-worktree"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('displays worktreeError message when worktreeError is set', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: { ...BASE_PROPS, worktreeError: 'branch already exists' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('branch already exists')
    wrapper.unmount()
  })

  it('does not show worktree error paragraph when worktreeError is null', () => {
    const wrapper = mount(LaunchSessionOptions, {
      props: BASE_PROPS, // worktreeError: null
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('.field-hint--error').exists()).toBe(false)
    wrapper.unmount()
  })
})
