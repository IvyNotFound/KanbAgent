import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { api, makeTask, makeAgent, setupBeforeEach } from './__helpers__/useLaunchSession-1-launch.helpers'

describe('composables/useLaunchSession — canLaunchSession & launchReviewSession', () => {
  beforeEach(() => {
    setupBeforeEach()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('canLaunchSession', () => {
    it('should return true when agent has no terminals', () => {
      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent())).toBe(true)
    })

    it('should return true when agent has fewer than max_sessions terminals', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent())).toBe(true)
    })

    it('should return false when agent has reached max_sessions terminals', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent())).toBe(false)
    })

    it('should return true when agent has max_sessions = -1 (unlimited)', () => {
      const tabsStore = useTabsStore()
      for (let i = 0; i < 10; i++) tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent({ max_sessions: -1 }))).toBe(true)
    })

    it('should respect custom max_sessions value', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent({ max_sessions: 2 }))).toBe(false)
    })

    it('should not affect other agents', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent({ name: 'other-agent' }))).toBe(true)
    })
  })

  describe('launchReviewSession', () => {
    it('should return true and add terminal on success', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const doneTasks = [makeTask({ id: 1, status: 'done' })]

      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, doneTasks)

      expect(result).toBe(true)
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })

    it('should return false when agent terminal already exists', async () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(false)
    })

    it('should return false when getCliInstances rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.getCliInstances.mockRejectedValueOnce(new Error('review IPC error'))

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(false)
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
      vi.mocked(console.warn).mockRestore()
    })

    it('should launch with no distro when getCliInstances returns empty array', async () => {
      api.getCliInstances.mockResolvedValueOnce([])

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(true)
    })

    it('should return false when dbPath is null', async () => {
      const tasksStore = useTasksStore()
      ;(tasksStore as unknown as { dbPath: string | null }).dbPath = null

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(false)
    })
  })
})
