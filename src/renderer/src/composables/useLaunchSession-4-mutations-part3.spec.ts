/**
 * T1346: Mutation coverage for useLaunchSession.ts — Part 3
 * Covers: worktree_enabled guard, launchReviewSession (guard, distro,
 *         task list separator, systemPrompt assembly).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-4-mutations.helpers'

// ─── worktree_enabled null/undefined logic ─────────────────────────────────────

describe('T1346: worktree_enabled null/undefined guard', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  function setProjectPath(path: string | null) {
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { projectPath: string | null }).projectPath = path
  }

  it('worktree_enabled = undefined → treated as null, uses global default', async () => {
    setProjectPath('/repo')
    const settingsStore = useSettingsStore()
    settingsStore.worktreeDefault = true

    const { launchAgentTerminal } = useLaunchSession()
    // undefined should be treated same as null (both go to global default)
    await launchAgentTerminal(makeAgent({ worktree_enabled: undefined as unknown as number }), makeTask())

    expect(api.worktreeCreate).toHaveBeenCalled()
  })

  it('worktree_enabled = 0 (defined, falsy) → treated as explicit disable, NOT global default', async () => {
    setProjectPath('/repo')
    const settingsStore = useSettingsStore()
    settingsStore.worktreeDefault = true  // global default is true

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent({ worktree_enabled: 0 }), makeTask())

    // worktree_enabled=0 means explicit disable; should NOT create worktree
    expect(api.worktreeCreate).not.toHaveBeenCalled()
  })

  it('worktree_enabled = 1 → explicit enable, overrides global false', async () => {
    setProjectPath('/repo')
    const settingsStore = useSettingsStore()
    settingsStore.worktreeDefault = false

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent({ worktree_enabled: 1 }), makeTask())

    expect(api.worktreeCreate).toHaveBeenCalled()
  })
})

// ─── launchReviewSession: first guard line 220 ────────────────────────────────

describe('T1346: launchReviewSession hasAgentTerminal guard', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('first guard (line 220): terminal present before IPC → returns false immediately', async () => {
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(false)
    // IPC should NOT be called at all — early return
    expect(api.getCliInstances).not.toHaveBeenCalled()
  })

  it('first guard absent (false mutation): terminal present → still returns false (second guard)', async () => {
    // This test complements the concurrent-add test in t1105
    // Ensures the function doesn't add a second terminal
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    // Only 1 terminal total
    expect(tabsStore.tabs.filter(t => t.agentName === 'review-master')).toHaveLength(1)
  })
})

// ─── review session: distro matching (NoCoverage lines 244-249) ───────────────

describe('T1346: launchReviewSession distro matching', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('review: storedDistro matches → uses stored instance', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('claude', 'Debian')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Debian')
  })

  it('review: storedDistro absent → uses isDefault', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
    ])

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  it('review: parsedDefault.cli=null matches any cli on that distro', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Arch', version: '2.0.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    // setDefaultCliInstance('', 'Arch') → key = 'Arch' → parsedDefault = { cli: null, distro: 'Arch' }
    settingsStore.setDefaultCliInstance('', 'Arch')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Arch')
  })
})

// ─── review session: task list separator ', ' ─────────────────────────────────

describe('T1346: review session task list separator', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('task list joined with ", " separator (kills StringLiteral → "")', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const tasks = [
      makeTask({ id: 5, title: 'First', status: 'done' }),
      makeTask({ id: 6, title: 'Second', status: 'done' }),
      makeTask({ id: 7, title: 'Third', status: 'done' }),
    ]

    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, tasks)

    // buildAgentPrompt receives the joined task list
    const call = api.buildAgentPrompt.mock.calls[0]
    const prompt = call[1] as string
    // Should contain ", " as separator (not "T5T6T7" or "T5 T6 T7")
    expect(prompt).toContain('T5 First')
    expect(prompt).toContain(', ')
    expect(prompt).toContain('T6 Second')
  })
})

// ─── review session: maxFileLinesEnabled line and systemPromptSuffix ──────────

describe('T1346: review session systemPrompt assembly', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('review: systemPromptSuffix included when present (kills ConditionalExpression→false)', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(false)
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: 'Suffix', thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('Base\n\nSuffix')
  })

  it('review: maxFileLinesEnabled adds line (kills ConditionalExpression→false at line 268)', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(true)
    settingsStore.setMaxFileLinesCount(200)

    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.systemPrompt).toContain('maximum 200 lines')
  })

  it('review: thinkingMode defaults to auto when null (kills StringLiteral → "")', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: null, thinkingMode: null
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.thinkingMode).toBe('auto')
  })

  it('review: systemPromptSuffix false (absent) → not added (kills ConditionalExpression→true L267)', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(false)
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('Base')
  })

  it('review: \n\n separator used (kills StringLiteral → "")', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(false)
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Part1', systemPromptSuffix: 'Part2', thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    // Verify exact separator (kills StringLiteral '\n\n' → "")
    expect(terminal?.systemPrompt).toBe('Part1\n\nPart2')
  })

  it('review: viewMode defaults to "stream" (kills StringLiteral)', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.viewMode).toBe('stream')
  })
})
