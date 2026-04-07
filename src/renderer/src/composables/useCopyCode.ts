import { watch, onUnmounted, type Ref } from 'vue'

/**
 * Attaches a delegated click listener on a container to handle
 * copy-to-clipboard for `.copy-code-btn` buttons injected inside
 * markdown code blocks via renderMarkdown.ts (T1516).
 */
export function useCopyCode(containerRef: Ref<HTMLElement | null>): void {
  function handleClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest('.copy-code-btn')
    if (!btn) return
    const wrapper = btn.closest('.code-block-wrapper')
    const code = wrapper?.querySelector('code')
    if (!code) return
    navigator.clipboard.writeText((code as HTMLElement).innerText).then(() => {
      btn.textContent = 'Copied!'
      btn.classList.add('copied')
      setTimeout(() => {
        btn.textContent = 'Copy'
        btn.classList.remove('copied')
      }, 2000)
    }).catch(() => {})
  }

  let currentEl: HTMLElement | null = null

  // watch handles refs that populate after mount (e.g. v-if-gated template refs)
  const stop = watch(containerRef, (newEl, oldEl) => {
    if (oldEl) oldEl.removeEventListener('click', handleClick)
    if (newEl) newEl.addEventListener('click', handleClick)
    currentEl = newEl ?? null
  }, { immediate: true })

  onUnmounted(() => {
    stop()
    if (currentEl) currentEl.removeEventListener('click', handleClick)
  })
}
