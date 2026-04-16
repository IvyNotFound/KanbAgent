/**
 * T1982: review tabs with active streamId must still auto-close when session completes.
 *
 * Context: T1937 added a guard `if (tab.streamId) continue` in Chemin 2 to prevent
 * premature kills of agents that are still running. Side effect: review tabs never
 * auto-closed because Claude Code review agents never exit on their own (they wait
 * for input), so streamId stays set forever.
 *
 * Fix: exempt `type === 'review'` agents from the T1937 guard so Chemin 2 schedules
 * the DB polling close for them. `doClose` already handles killing the process via
 * `agentKill` before closing the tab.
 *
 * Tests:
 * 1. Review tab with active streamId → scheduleClose IS called (Chemin 2 not skipped)
 * 2. Review tab with streamId closes when session completes (poll detects completed)
 * 3. Review tab with streamId closes via 120s fallback when session never completes
 * 4. Non-review tab with streamId is still guarded by T1937 (no regression)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'

const api = {
  getCliInstances: vi.fn().mockResolvedValue([
    { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
  ]),
  getAgentSystemPrompt: vi.fn().mockResolvedValue({
    success: true, systemPrompt: 'You are review', systemPromptSuffix: null, thinkingMode: 'auto'
  }),
  buildAgentPrompt: vi.fn().mockResolvedValue('final prompt'),
  agentKill: vi.fn().mockResolvedValue(undefined),
  queryDb: vi.fn().mockResolvedValue([]),
}

Object.defineProperty(window, 'electronAPI', { value: api, writable: true })

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, title: 'Test task', description: null, status: 'todo',
    agent_assigned_id: 10, agent_creator_id: null, agent_validator_id: null,
    agent_name: 'dev-front-vuejs', agent_creator_name: null, agent_scope: null,
    parent_task_id: null, session_id: null, scope: 'front-vuejs',
    effort: 2, priority: 'normal', created_at: '', updated_at: '',
    started_at: null, completed_at: null, validated_at: null,
    ...overrides
  } as Task
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 10, name: 'review-master', type: 'review', scope: null,
    system_prompt: null, system_prompt_suffix: null, thinking_mode: 'auto',
    allowed_tools: null, auto_launch: 1, permission_mode: null, max_sessions: 3, created_at: '',
    ...overrides
  } as Agent
}

describe('useAutoLaunch T1982: review tabs with active streamId auto-close on session completion', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>
  let testIndex = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    testIndex++
    vi.setSystemTime(new Date(2026, 6, 1, 0, testIndex * 20, 0))

    api.queryDb.mockResolvedValue([])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('review tab with active streamId should trigger scheduleClose (not skipped by T1937 guard)', async () => {
    // Chemin 2 must NOT skip review agents even when streamId is set.
    // scheduleClose → immediate poll → fallback timer set.
    const agent = makeAgent({ id: 60, name: 'review-master', type: 'review' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const reviewTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    reviewTab.streamId = 'stream-review-active'

    // Trigger Chemin 2 — review tab with streamId should now be scheduled
    tasks.value = [makeTask({ id: 99, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // Advance past 120s fallback + 30s post-complete delay → tab must close
    await vi.advanceTimersByTimeAsync(120_000 + 100)

    // agentKill should have been called because streamId was set
    expect(api.agentKill).toHaveBeenCalledWith('stream-review-active')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })

  it('review tab with streamId closes when session completes via poll (before fallback)', async () => {
    // Session completes after 40s → next poll (every 5s) fires doClose.
    // doClose calls agentKill(streamId) then closes tab after 30s delay.
    const agent = makeAgent({ id: 61, name: 'review-master', type: 'review' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const reviewTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    reviewTab.streamId = 'stream-review-poll'

    tasks.value = [makeTask({ id: 99, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // Session completes — poll (every 5s) will detect it on next tick
    api.queryDb.mockResolvedValue([{ id: 88 }])
    // Advance just past first poll interval to let doClose fire
    await vi.advanceTimersByTimeAsync(5_000 + 200)

    // doClose fired → agentKill called immediately
    expect(api.agentKill).toHaveBeenCalledWith('stream-review-poll')

    // Tab still open — waiting for 30s post-complete delay
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })

  it('non-review tab with active streamId is still guarded by T1937 (no regression)', async () => {
    // T1937 guard must remain intact for non-review agents.
    // A 'dev' type agent tab with streamId must not be scheduled by Chemin 2.
    const agent = makeAgent({ id: 62, name: 'dev-front-vuejs', type: 'dev' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const devTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    devTab.streamId = 'stream-dev-active'

    tasks.value = [makeTask({ id: 99, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // Advance well past any fallback — tab must remain open (T1937 guard blocks)
    await vi.advanceTimersByTimeAsync(120_000 + 30_000 + 100)
    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })
})
