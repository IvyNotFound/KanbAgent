import type { Task } from '@renderer/types'

/** Task node enriched with children for tree view. */
export interface TaskNode extends Task {
  children: TaskNode[]
  depth: number
}

/** Maximum visual depth for tree rendering (children beyond this depth are flattened to roots). */
export const MAX_TREE_DEPTH = 3

/**
 * Builds a tree structure from a flat list of tasks using `parent_task_id`.
 *
 * Guards against:
 * - Circular references (A → B → A) using a visited Set during traversal
 * - Tasks referencing unknown parents (treated as roots)
 * - Depth overflow beyond MAX_TREE_DEPTH (children promoted to roots)
 *
 * @param tasks - Flat task array from the store
 * @returns Array of root TaskNodes with nested children
 */
export function buildTree(tasks: Task[]): TaskNode[] {
  const nodeMap = new Map<number, TaskNode>()

  // First pass: create all nodes
  for (const task of tasks) {
    nodeMap.set(task.id, { ...task, children: [], depth: 0 })
  }

  const roots: TaskNode[] = []

  // Detect cycles: for each node, walk up the parent chain and detect if we revisit the same id
  function hasAncestorCycle(nodeId: number, parentId: number): boolean {
    const visited = new Set<number>()
    let current: number | null = parentId
    while (current !== null) {
      if (visited.has(current)) return true // cycle among ancestors
      if (current === nodeId) return true   // would create a cycle
      visited.add(current)
      const parent = nodeMap.get(current)
      current = parent?.parent_task_id ?? null
    }
    return false
  }

  // Second pass: wire up parent → children relationships
  for (const node of nodeMap.values()) {
    const parentId = node.parent_task_id
    if (parentId !== null && nodeMap.has(parentId) && !hasAncestorCycle(node.id, parentId)) {
      const parent = nodeMap.get(parentId)!
      node.depth = (parent.depth ?? 0) + 1
      if (node.depth <= MAX_TREE_DEPTH) {
        parent.children.push(node)
      } else {
        // Depth overflow: promote to root
        node.depth = 0
        roots.push(node)
      }
    } else {
      // No parent, unknown parent, or cycle detected → treat as root
      node.depth = 0
      roots.push(node)
    }
  }

  // Sort children by id for deterministic order
  function sortChildren(node: TaskNode): void {
    node.children.sort((a, b) => a.id - b.id)
    for (const child of node.children) sortChildren(child)
  }
  roots.sort((a, b) => a.id - b.id)
  for (const root of roots) sortChildren(root)

  return roots
}
