/**
 * T1312: Mutation coverage gaps for useLaunchSession.ts — review distro matching + error handling
 * Targets surviving mutants and NoCoverage lines:
 * - L245-246: inner distro matching in launchReviewSession
 * - L268-273: error handling block in launchReviewSession
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-t1312.helpers'

describe('useLaunchSession T1312: launchReviewSession inner distro matching (L242-250)', () => {
  beforeEach(() => {
    setupBeforeEach(3)
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'Review prompt', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('review built prompt')
  })

  afterEach(() => { vi.useRealTimers() })

  // L242-250: review session uses storedDistro to pick correct instance
  it('review: storedDistro picks matching distro instance', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('claude', 'Debian')

    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0', isDefault: false, type: 'wsl' },
    ])

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(true)
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master')
    expect(terminal?.wslDistro).toBe('Debian')
  })

  // L244-246: parsedDefault.cli === null in review — legacy distro-only format
  it('review: distro-only stored key (no CLI prefix) matches instance by distro', async () => {
    // Simulate legacy format (no cli prefix) by patching the store directly
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ defaultCliInstance: 'Arch' })

    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Arch', version: '2.0', isDefault: false, type: 'wsl' },
    ])

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(true)
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master')
    expect(terminal?.wslDistro).toBe('Arch')
  })

  // L248: storedDistro absent → falls back to isDefault instance
  it('review: no storedDistro falls back to isDefault instance', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0', isDefault: false, type: 'wsl' },
    ])

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(true)
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master')
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  // L249: no storedDistro, no isDefault → first instance used
  it('review: no storedDistro and no isDefault falls back to first instance', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Debian', version: '2.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Arch', version: '2.0', isDefault: false, type: 'wsl' },
    ])

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(true)
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master')
    expect(terminal?.wslDistro).toBe('Debian')
  })
})

describe('useLaunchSession T1312: error handling NoCoverage (L268-273)', () => {
  beforeEach(() => {
    setupBeforeEach(4)
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'prompt', systemPromptSuffix: null, thinkingMode: 'auto'
    })
  })

  afterEach(() => { vi.useRealTimers() })

  // L268-273: buildAgentPrompt throws inside launchReviewSession → returns false
  it('review: buildAgentPrompt throwing returns false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.buildAgentPrompt.mockRejectedValueOnce(new Error('IPC failure'))

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(false)
    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
    vi.mocked(console.warn).mockRestore()
  })

  // L210-212: launchAgentTerminal logs warning on error
  it('launchAgentTerminal logs warning on error with agent name', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.getCliInstances.mockRejectedValueOnce(new Error('network error'))

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask())

    expect(result).toBe('error')
    expect(warnSpy).toHaveBeenCalledWith(
      '[launchSession] Failed to launch terminal for agent',
      'dev-front-vuejs',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })

  // L292-294: launchReviewSession logs warning on error
  it('launchReviewSession logs warning on error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.getCliInstances.mockRejectedValueOnce(new Error('network error'))

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      '[launchSession] Failed to launch review session',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})
