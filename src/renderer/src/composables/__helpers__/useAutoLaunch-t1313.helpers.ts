/**
 * Shared helpers for useAutoLaunch T1313 split test files.
 */
import { vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'

export const api = {
  getCliInstances: vi.fn().mockResolvedValue([
    { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
  ]),
  getAgentSystemPrompt: vi.fn().mockResolvedValue({
    success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
  }),
  buildAgentPrompt: vi.fn().mockResolvedValue('final prompt'),
  agentKill: vi.fn().mockResolvedValue(undefined),
  queryDb: vi.fn().mockResolvedValue([{ id: 1 }]),
}

Object.defineProperty(window, 'electronAPI', { value: api, writable: true })

export function makeTask(overrides: Partial<Task> = {}): Task {
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

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 10, name: 'dev-front-vuejs', type: 'dev', scope: 'front-vuejs',
    system_prompt: null, system_prompt_suffix: null, thinking_mode: 'auto',
    allowed_tools: null, auto_launch: 1, permission_mode: null, max_sessions: 3, created_at: '',
    ...overrides
  } as Agent
}

export let testIndex = 0

export function incrementTestIndex(): number {
  testIndex++
  return testIndex
}

export interface TestRefs {
  tasks: ReturnType<typeof ref<Task[]>>
  agents: ReturnType<typeof ref<Agent[]>>
  dbPath: ReturnType<typeof ref<string | null>>
}

export function setupTestEnv(opts: {
  date: [number, number, number]
  queryDbResult?: unknown[]
  agents?: Agent[]
}): TestRefs {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  vi.useFakeTimers()
  const idx = incrementTestIndex()
  vi.setSystemTime(new Date(opts.date[0], opts.date[1], opts.date[2], 0, idx * 10, 0))
  api.queryDb.mockResolvedValue(opts.queryDbResult ?? [])
  const tasks = ref<Task[]>([])
  const agents = ref<Agent[]>(opts.agents ?? [makeAgent()])
  const dbPath = ref<string | null>('/test/db')
  const tasksStore = useTasksStore()
  ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  return { tasks, agents, dbPath }
}
