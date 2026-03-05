import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('composables/useToast', () => {
  let useToast: typeof import('@renderer/composables/useToast').useToast

  beforeEach(async () => {
    vi.useFakeTimers()
    // Reset module to get a fresh singleton each test
    vi.resetModules()
    const mod = await import('@renderer/composables/useToast')
    useToast = mod.useToast
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push() adds a toast with incremental id and default type error', () => {
    const { toasts, push } = useToast()
    push('Something failed')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('Something failed')
    expect(toasts.value[0].type).toBe('error')
    expect(toasts.value[0].id).toBeGreaterThan(0)
  })

  it('push() with type warn sets toast.type to warn', () => {
    const { toasts, push } = useToast()
    push('Watch out', 'warn')
    expect(toasts.value[0].type).toBe('warn')
  })

  it('push() limits to 5 toasts — shifts oldest when full', () => {
    const { toasts, push } = useToast()
    for (let i = 0; i < 6; i++) push(`msg${i}`)
    expect(toasts.value).toHaveLength(5)
    // First message should have been shifted out
    expect(toasts.value[0].message).toBe('msg1')
    expect(toasts.value[4].message).toBe('msg5')
  })

  it('push() auto-dismisses after duration via setTimeout', () => {
    const { toasts, push } = useToast()
    push('temp', 'info', 3000)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(toasts.value).toHaveLength(0)
  })

  it('dismiss(id) removes the matching toast', () => {
    const { toasts, push, dismiss } = useToast()
    push('a')
    push('b')
    const idA = toasts.value[0].id
    dismiss(idA)
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('b')
  })

  it('dismiss(nonexistent id) is a no-op', () => {
    const { toasts, push, dismiss } = useToast()
    push('a')
    dismiss(99999)
    expect(toasts.value).toHaveLength(1)
  })

  it('singleton: two useToast() calls share the same toasts array', () => {
    const t1 = useToast()
    const t2 = useToast()
    t1.push('from t1')
    expect(t2.toasts.value).toHaveLength(1)
    expect(t2.toasts.value[0].message).toBe('from t1')
  })
})
