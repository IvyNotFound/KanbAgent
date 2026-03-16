import { describe, it, expect } from 'vitest'
import { buildTree, MAX_TREE_DEPTH } from './taskTree'
import type { Task } from '@renderer/types'

/** Minimal Task factory — only fields relevant to tree building */
function makeTask(id: number, parent_task_id: number | null = null): Task {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    status: 'todo',
    agent_assigned_id: 1,
    agent_creator_id: 1,
    agent_validator_id: null,
    agent_name: null,
    agent_creator_name: null,
    agent_scope: null,
    parent_task_id,
    session_id: null,
    scope: null,
    effort: null,
    priority: 'normal',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    validated_at: null,
  }
}

describe('buildTree', () => {
  it('builds a simple parent → child tree', () => {
    const tasks = [makeTask(1), makeTask(2, 1)]
    const roots = buildTree(tasks)
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(1)
    expect(roots[0].children).toHaveLength(1)
    expect(roots[0].children[0].id).toBe(2)
  })

  it('treats a task with an unknown parent as root', () => {
    const tasks = [makeTask(1, 999)]
    const roots = buildTree(tasks)
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(1)
  })

  it('detects direct cycle (A → B → A) — both promoted to root', () => {
    const tasks = [makeTask(1, 2), makeTask(2, 1)]
    const roots = buildTree(tasks)
    const ids = roots.map((n) => n.id).sort()
    expect(ids).toEqual([1, 2])
    // Neither should be a child of the other
    expect(roots.every((n) => n.children.length === 0)).toBe(true)
  })

  it('detects indirect cycle (A→B→C→A) — all three nodes are roots with no children among them', () => {
    // A=1 parent=3, B=2 parent=1, C=3 parent=2 → forms a 3-node cycle
    const tasks = [makeTask(1, 3), makeTask(2, 1), makeTask(3, 2)]
    const roots = buildTree(tasks)
    const ids = roots.map((n) => n.id).sort()
    expect(ids).toEqual([1, 2, 3])
    expect(roots.every((n) => n.children.length === 0)).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(buildTree([])).toEqual([])
  })

  it('assigns correct depth values', () => {
    const tasks = [makeTask(1), makeTask(2, 1), makeTask(3, 2)]
    const roots = buildTree(tasks)
    const node1 = roots[0]
    const node2 = node1.children[0]
    const node3 = node2.children[0]
    expect(node1.depth).toBe(0)
    expect(node2.depth).toBe(1)
    expect(node3.depth).toBe(2)
  })

  it('sorts children by id for deterministic order', () => {
    const tasks = [makeTask(1), makeTask(3, 1), makeTask(2, 1)]
    const roots = buildTree(tasks)
    const childIds = roots[0].children.map((n) => n.id)
    expect(childIds).toEqual([2, 3])
  })

  it('sorts roots by id ascending (kills sort removal and arithmetic mutations)', () => {
    // 3 independent roots added in reverse id order — roots.sort must produce [1,2,3]
    // Mutant "roots.sort(() => undefined)": non-deterministic, may not sort
    // Mutant "a.id + b.id": comparator always positive → undefined sort behaviour
    // Mutant "roots" (no sort): order from Map iteration, which is insertion order [3,2,1]
    const tasks = [makeTask(3), makeTask(1), makeTask(2)]
    const roots = buildTree(tasks)
    expect(roots.map((n) => n.id)).toEqual([1, 2, 3])
  })

  it('treats node with an ancestor cycle (not involving itself) as root (kills visited.has survivor)', () => {
    // Task 4 → Task 3, Task 3 ↔ Task 2 (cycle in ancestors, does not involve id=4)
    // hasAncestorCycle(4, 3): current=3 → add(3) → current=2 → add(2) → current=3 → visited.has(3)=true
    // Without visited.has guard (mutant): loop 3→2→3→2→... until Stryker timeout
    // The test ensures node 4 is treated as root (its parent chain forms a cycle)
    const tasks = [makeTask(2, 3), makeTask(3, 2), makeTask(4, 3)]
    const roots = buildTree(tasks)
    const ids = roots.map((n) => n.id).sort((a, b) => a - b)
    expect(ids).toEqual([2, 3, 4])
    // Node 4 must be a root (its ancestor chain has a 2↔3 cycle)
    const node4 = roots.find((n) => n.id === 4)
    expect(node4).toBeDefined()
    expect(node4!.depth).toBe(0)
  })

  describe('MAX_TREE_DEPTH boundary', () => {
    it('does NOT promote a child at exactly MAX_TREE_DEPTH', () => {
      // Build a chain of MAX_TREE_DEPTH+1 nodes (depth 0..MAX_TREE_DEPTH)
      // Node at depth MAX_TREE_DEPTH should still be a child, not a root
      const tasks: Task[] = [makeTask(1)]
      for (let i = 2; i <= MAX_TREE_DEPTH + 1; i++) {
        tasks.push(makeTask(i, i - 1))
      }
      const roots = buildTree(tasks)
      // Only node 1 should be root
      expect(roots).toHaveLength(1)
      // Walk down the chain to the leaf
      let node = roots[0]
      for (let d = 1; d <= MAX_TREE_DEPTH; d++) {
        expect(node.children).toHaveLength(1)
        node = node.children[0]
        expect(node.depth).toBe(d)
      }
      // The leaf at MAX_TREE_DEPTH should have no children
      expect(node.children).toHaveLength(0)
    })

    it('promotes a child at depth MAX_TREE_DEPTH+1 to root', () => {
      // Build a chain of MAX_TREE_DEPTH+2 nodes so last node would be at depth MAX_TREE_DEPTH+1
      const tasks: Task[] = [makeTask(1)]
      for (let i = 2; i <= MAX_TREE_DEPTH + 2; i++) {
        tasks.push(makeTask(i, i - 1))
      }
      const roots = buildTree(tasks)
      const lastId = MAX_TREE_DEPTH + 2
      const promotedNode = roots.find((n) => n.id === lastId)
      expect(promotedNode).toBeDefined()
      expect(promotedNode!.depth).toBe(0)
    })
  })
})
