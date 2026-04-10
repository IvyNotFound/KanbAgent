/**
 * Shared helpers for snapshot tests (split from snapshots.spec.ts)
 */
import type { Task } from '@renderer/types'

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Fix login bug',
    description: 'Description',
    status: 'todo',
    scope: 'front-vuejs',
    effort: 2,
    priority: 'normal',
    agent_assigned_id: 1,
    agent_name: 'dev-front',
    agent_creator_id: null,
    agent_creator_name: null,
    agent_scope: null,
    parent_task_id: null,
    session_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    validated_at: null,
    ...overrides,
  } as Task
}
