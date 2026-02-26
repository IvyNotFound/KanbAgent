import { onMounted, onUnmounted } from 'vue'

/**
 * Standard composable for closing a modal on Escape key press.
 *
 * Usage in any modal component:
 * ```ts
 * useModalEscape(() => emit('close'))
 * ```
 *
 * The listener is registered on `document` when the component mounts and
 * automatically cleaned up on unmount. This guarantees consistent Escape
 * behaviour across all current and future modals without manual boilerplate.
 */
export function useModalEscape(onClose: () => void): void {
  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose()
  }

  onMounted(() => document.addEventListener('keydown', handleKeydown))
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
}
