import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ContextMenu from '@renderer/components/ContextMenu.vue'

describe('ContextMenu', () => {
  // Stub Vuetify components: v-menu renders as overlay div, v-list-item as button
  const vuetifyStubs = {
    VMenu: {
      name: 'VMenu',
      template: `<div class="context-overlay" @click.self="$emit('update:modelValue', false)"><slot /></div>`,
      props: ['modelValue', 'target', 'closeOnContentClick'],
      emits: ['update:modelValue'],
    },
    VList: { template: '<div><slot /></div>' },
    VListItem: {
      name: 'VListItem',
      template: '<button @click="$emit(\'click\')">{{ title }}</button>',
      props: ['title'],
      emits: ['click'],
    },
    VDivider: { template: '<div class="separator" />' },
  }

  const makeItems = () => [
    { label: 'Copy', action: vi.fn() },
    { label: 'Paste', action: vi.fn() },
    { label: 'Delete', action: vi.fn() },
  ]

  it('renders all items passed via props', () => {
    const items = makeItems()
    const wrapper = mount(ContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: vuetifyStubs },
    })
    expect(wrapper.text()).toContain('Copy')
    expect(wrapper.text()).toContain('Paste')
    expect(wrapper.text()).toContain('Delete')
  })

  it('clicking an item calls item.action()', async () => {
    const items = makeItems()
    const wrapper = mount(ContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: vuetifyStubs },
    })
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    expect(items[0].action).toHaveBeenCalled()
  })

  it('clicking an item also emits close', async () => {
    const items = makeItems()
    const wrapper = mount(ContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: vuetifyStubs },
    })
    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('Escape key emits close', async () => {
    const items = makeItems()
    const wrapper = mount(ContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: vuetifyStubs },
    })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('clicking overlay emits close', async () => {
    const items = makeItems()
    const wrapper = mount(ContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: vuetifyStubs },
    })
    const overlay = wrapper.find('.context-overlay')
    await overlay.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders separator when item has separator: true', () => {
    const items = [
      { label: 'Copy', action: vi.fn() },
      { label: '', action: vi.fn(), separator: true },
      { label: 'Delete', action: vi.fn() },
    ]
    const wrapper = mount(ContextMenu, {
      props: { x: 100, y: 200, items },
      global: { stubs: vuetifyStubs },
    })
    const separators = wrapper.findAll('.separator')
    expect(separators.length).toBe(1)
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// T353 — Tests manquants : composants Vue critiques (P2)
// ══════════════════════════════════════════════════════════════════════════════


