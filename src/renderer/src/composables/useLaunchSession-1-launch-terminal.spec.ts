import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { api, makeTask, makeAgent, setupBeforeEach } from './__helpers__/useLaunchSession-1-launch.helpers'

describe('composables/useLaunchSession — launchAgentTerminal', () => {
  beforeEach(() => {
    setupBeforeEach()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('launchAgentTerminal', () => {
    it('should return ok and add terminal on success', async () => {
      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('ok')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === 'dev-front-vuejs')).toBe(true)
    })

    it('should call buildAgentPrompt with only the task ID (no duplicated prefix)', async () => {
      const task = makeTask({ id: 42, statut: 'todo' })
      const agent = makeAgent({ name: 'dev-front-vuejs' })

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(agent, task)

      expect(api.buildAgentPrompt).toHaveBeenCalledWith('dev-front-vuejs', 'T42', '/test/db', 10)
    })

    it('should return error when dbPath is null', async () => {
      const tasksStore = useTasksStore()
      ;(tasksStore as unknown as { dbPath: string | null }).dbPath = null

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
    })

    it('should return error when getCliInstances rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.getCliInstances.mockRejectedValueOnce(new Error('IPC error'))

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
      vi.mocked(console.warn).mockRestore()
    })

    it('should launch with no distro when getCliInstances returns empty array', async () => {
      api.getCliInstances.mockResolvedValueOnce([])

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('ok')
      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.wslDistro).toBeNull()
    })

    it('should return error when getAgentSystemPrompt fails', async () => {
      api.getAgentSystemPrompt.mockResolvedValueOnce({ success: false })

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
    })

    it('should return session-limit when MAX_AGENT_SESSIONS reached', async () => {
      const tabsStore = useTabsStore()
      // Add 3 terminals for same agent (MAX_AGENT_SESSIONS = 3)
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('session-limit')
    })

    it('should use stored defaultCliInstance from settings (T879)', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
        { cli: 'claude', distro: 'Debian', version: '2.1.58', isDefault: false, type: 'wsl' },
      ])
      const settingsStore = useSettingsStore()
      settingsStore.setDefaultCliInstance('claude', 'Debian')

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
      expect(terminal?.wslDistro).toBe('Debian')
    })

    it('should fallback to isDefault instance when stored distro not found (T879)', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
      ])
      const settingsStore = useSettingsStore()
      settingsStore.setDefaultCliInstance('NonExistent')

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
      expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
    })

    // T1240 — worktree cascade resolution
    describe('worktree cascade (T1240)', () => {
      function setProjectPath(path: string | null) {
        const tasksStore = useTasksStore()
        ;(tasksStore as unknown as { projectPath: string | null }).projectPath = path
      }

      it('creates worktree via cascade when worktreeDefault=true and no opts', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = true

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: null }), makeTask())

        expect(api.worktreeCreate).toHaveBeenCalledWith('/repo', expect.any(String), 'dev-front-vuejs')
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBe('/worktrees/s123/dev-front-vuejs')
      })

      it('skips worktree when worktreeDefault=false and agent.worktree_enabled=null', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = false

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: null }), makeTask())

        expect(api.worktreeCreate).not.toHaveBeenCalled()
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBeNull()
      })

      it('agent.worktree_enabled=1 forces worktree even when worktreeDefault=false', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = false

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: 1 }), makeTask())

        expect(api.worktreeCreate).toHaveBeenCalled()
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBe('/worktrees/s123/dev-front-vuejs')
      })

      it('agent.worktree_enabled=0 disables worktree even when worktreeDefault=true', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = true

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: 0 }), makeTask())

        expect(api.worktreeCreate).not.toHaveBeenCalled()
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBeNull()
      })

      it('falls back to project root (no workDir) when worktreeCreate fails', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = true
        api.worktreeCreate.mockResolvedValueOnce({ success: false, error: 'git error' })

        const { launchAgentTerminal } = useLaunchSession()
        const result = await launchAgentTerminal(makeAgent({ worktree_enabled: null }), makeTask())

        expect(result).toBe('ok')
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBeNull()
      })

      it('opts with explicit workDir bypasses cascade (modal override)', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = true

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: null }), makeTask(), {
          workDir: '/explicit/path'
        })

        expect(api.worktreeCreate).not.toHaveBeenCalled()
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBe('/explicit/path')
      })

      it('opts with workDir: undefined bypasses cascade (modal explicitly disabled)', async () => {
        setProjectPath('/repo')
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = true

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: null }), makeTask(), {
          workDir: undefined
        })

        expect(api.worktreeCreate).not.toHaveBeenCalled()
        const tabsStore = useTabsStore()
        const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
        expect(terminal?.workDir).toBeNull()
      })

      it('skips cascade when projectPath is null', async () => {
        setProjectPath(null)
        const settingsStore = useSettingsStore()
        settingsStore.worktreeDefault = true

        const { launchAgentTerminal } = useLaunchSession()
        await launchAgentTerminal(makeAgent({ worktree_enabled: null }), makeTask())

        expect(api.worktreeCreate).not.toHaveBeenCalled()
      })
    })

  })
})
