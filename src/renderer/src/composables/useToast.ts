import { ref } from 'vue'

export type ToastType = 'error' | 'warn' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

// Module-level singleton: shared across all composable calls
const toasts = ref<Toast[]>([])
const _timers = new Map<number, ReturnType<typeof setTimeout>>()
let _id = 0

export function useToast() {
  function push(message: string, type: ToastType = 'error', duration = 5000): void {
    if (toasts.value.length >= 5) toasts.value.shift()
    const id = ++_id
    toasts.value.push({ id, message, type })
    _timers.set(id, setTimeout(() => dismiss(id), duration))
  }

  function dismiss(id: number): void {
    const timer = _timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      _timers.delete(id)
    }
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  return { toasts, push, dismiss }
}
