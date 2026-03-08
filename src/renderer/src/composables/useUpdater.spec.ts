/**
 * Unit tests for useUpdater composable (T1106).
 * Tests IPC event handlers, state transitions, and action functions.
 *
 * useUpdater is a singleton (module-level refs). We use vi.resetModules() +
 * dynamic import inside each test to get a fresh module instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'

// Helper: build a mock updater with controllable event callbacks
type UpdaterEvent = 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'
type UpdaterMock = {
  check: ReturnType<typeof vi.fn>
  download: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emit: (event: UpdaterEvent, data?: unknown) => void
}
function buildUpdaterMock(): UpdaterMock {
  const listeners: Partial<Record<UpdaterEvent, (data: unknown) => void>> = {}
  return {
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
    on: vi.fn((event: UpdaterEvent, cb: (data: unknown) => void) => {
      listeners[event] = cb
      return () => { delete listeners[event] }
    }),
    emit(event: UpdaterEvent, data?: unknown) {
      listeners[event]?.(data)
    },
  }
}

function setUpdater(mock: UpdaterMock | null | undefined) {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    ...(window.electronAPI ?? {}),
    updater: mock,
  }
}

describe('useUpdater — initial state (T1106)', () => {
  beforeEach(() => {
    vi.resetModules()
    setUpdater(buildUpdaterMock())
  })

  it('status is "idle" on fresh module', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    expect(composable!.status.value).toBe('idle')
    wrapper.unmount()
  })

  it('progress is 0, info is null, errorMessage is null', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    expect(composable!.progress.value).toBe(0)
    expect(composable!.info.value).toBeNull()
    expect(composable!.errorMessage.value).toBeNull()
    wrapper.unmount()
  })
})

describe('useUpdater — IPC event handlers (T1106)', () => {
  let updaterMock: UpdaterMock

  beforeEach(() => {
    vi.resetModules()
    updaterMock = buildUpdaterMock()
    setUpdater(updaterMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('available event → status=available, info set', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('available', { version: '1.2.3', releaseName: 'v1.2.3' })
    await nextTick()
    expect(composable!.status.value).toBe('available')
    expect(composable!.info.value).toEqual({ version: '1.2.3', releaseName: 'v1.2.3' })
    wrapper.unmount()
  })

  it('not-available event → status=up-to-date', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('not-available')
    await nextTick()
    expect(composable!.status.value).toBe('up-to-date')
    wrapper.unmount()
  })

  it('progress event → status=downloading, progress.value set', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('progress', { percent: 55 })
    await nextTick()
    expect(composable!.status.value).toBe('downloading')
    expect(composable!.progress.value).toBe(55)
    wrapper.unmount()
  })

  it('progress event with no percent → progress defaults to 0', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('progress', {})
    await nextTick()
    expect(composable!.status.value).toBe('downloading')
    expect(composable!.progress.value).toBe(0)
    wrapper.unmount()
  })

  it('downloaded event → status=downloaded, info set', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('downloaded', { version: '2.0.0' })
    await nextTick()
    expect(composable!.status.value).toBe('downloaded')
    expect(composable!.info.value).toEqual({ version: '2.0.0' })
    wrapper.unmount()
  })

  it('error event → status=error, errorMessage set', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('error', 'network failure')
    await nextTick()
    expect(composable!.status.value).toBe('error')
    expect(composable!.errorMessage.value).toBe('network failure')
    wrapper.unmount()
  })

  it('error event with null message → defaults to "Unknown error"', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('error', null)
    await nextTick()
    expect(composable!.status.value).toBe('error')
    expect(composable!.errorMessage.value).toBe('Unknown error')
    wrapper.unmount()
  })

  it('subscribes to all 5 events via updater.on()', async () => {
    const { useUpdater } = await import('./useUpdater')
    const TestComp = defineComponent({
      setup() { useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    expect(updaterMock.on).toHaveBeenCalledTimes(5)
    const events = updaterMock.on.mock.calls.map((c: [string]) => c[0])
    expect(events).toContain('available')
    expect(events).toContain('not-available')
    expect(events).toContain('progress')
    expect(events).toContain('downloaded')
    expect(events).toContain('error')
    wrapper.unmount()
  })
})

describe('useUpdater — action functions (T1106)', () => {
  let updaterMock: UpdaterMock

  beforeEach(() => {
    vi.resetModules()
    updaterMock = buildUpdaterMock()
    setUpdater(updaterMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('check() → status=checking and calls updater.check()', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    composable!.check()
    await nextTick()
    expect(composable!.status.value).toBe('checking')
    expect(updaterMock.check).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('download() calls updater.download()', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    composable!.download()
    expect(updaterMock.download).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('install() calls updater.install()', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    composable!.install()
    expect(updaterMock.install).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('dismiss() resets status to "idle"', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    updaterMock.emit('available', { version: '1.0.0' })
    await nextTick()
    expect(composable!.status.value).toBe('available')
    composable!.dismiss()
    expect(composable!.status.value).toBe('idle')
    wrapper.unmount()
  })
})

describe('useUpdater — no updater guard (T1106)', () => {
  beforeEach(() => {
    vi.resetModules()
    setUpdater(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mount does not throw when updater is undefined', async () => {
    const { useUpdater } = await import('./useUpdater')
    const TestComp = defineComponent({
      setup() { useUpdater() },
      template: '<div/>',
    })
    expect(() => mount(TestComp, { attachTo: document.body })).not.toThrow()
  })

  it('check() sets status=checking even when updater is undefined (optional chain)', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    mount(TestComp, { attachTo: document.body })
    await nextTick()
    // updater?.check() with no updater — should not throw
    expect(() => composable!.check()).not.toThrow()
    expect(composable!.status.value).toBe('checking')
  })

  it('download() does not throw when updater is undefined', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    mount(TestComp, { attachTo: document.body })
    await nextTick()
    expect(() => composable!.download()).not.toThrow()
  })

  it('install() does not throw when updater is undefined', async () => {
    const { useUpdater } = await import('./useUpdater')
    let composable: ReturnType<typeof useUpdater> | undefined
    const TestComp = defineComponent({
      setup() { composable = useUpdater() },
      template: '<div/>',
    })
    mount(TestComp, { attachTo: document.body })
    await nextTick()
    expect(() => composable!.install()).not.toThrow()
  })
})

describe('useUpdater — unsubscribe on unmount (T1106)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls all 5 unsub functions when component unmounts', async () => {
    const unsubFns = Array.from({ length: 5 }, () => vi.fn())
    let callIndex = 0
    const updaterWithTrackedUnsubs = {
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
      on: vi.fn(() => unsubFns[callIndex++]),
    }
    setUpdater(updaterWithTrackedUnsubs as unknown as UpdaterMock)

    const { useUpdater } = await import('./useUpdater')
    const TestComp = defineComponent({
      setup() { useUpdater() },
      template: '<div/>',
    })
    const wrapper = mount(TestComp, { attachTo: document.body })
    await nextTick()
    wrapper.unmount()
    await nextTick()
    for (const fn of unsubFns) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })
})
