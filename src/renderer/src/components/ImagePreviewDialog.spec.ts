import { describe, it, expect, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImagePreviewDialog from '@renderer/components/ImagePreviewDialog.vue'

describe('ImagePreviewDialog (T1894)', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  function mountDialog(props: { modelValue: boolean; src: string | null }) {
    return shallowMount(ImagePreviewDialog, {
      props,
      global: { stubs: { ...teleportStub, Transition: false } },
    })
  }

  it('renders image when open with a valid src', () => {
    const wrapper = mountDialog({ modelValue: true, src: 'blob:http://localhost/abc' })
    const img = wrapper.find('[data-testid="image-preview-img"]')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:http://localhost/abc')
  })

  it('does not render image when closed', () => {
    const wrapper = mountDialog({ modelValue: false, src: 'blob:http://localhost/abc' })
    const img = wrapper.find('[data-testid="image-preview-img"]')
    expect(img.exists()).toBe(false)
  })

  it('does not render image when src is null', () => {
    const wrapper = mountDialog({ modelValue: true, src: null })
    const img = wrapper.find('[data-testid="image-preview-img"]')
    expect(img.exists()).toBe(false)
  })

  it('emits update:modelValue false on Escape keydown', async () => {
    const wrapper = mountDialog({ modelValue: true, src: 'blob:http://localhost/abc' })
    await nextTick()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('emits update:modelValue false when clicking the container backdrop', async () => {
    const wrapper = mountDialog({ modelValue: true, src: 'blob:http://localhost/abc' })
    await nextTick()

    const container = wrapper.find('[data-testid="image-preview-container"]')
    await container.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('cleans up Escape listener on unmount', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountDialog({ modelValue: true, src: 'blob:http://localhost/abc' })
    await nextTick()

    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})
