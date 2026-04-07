import type { AgentGroup } from '@renderer/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentRow {
  id: number
  name: string
  type: string
  scope: string | null
  session_status: string | null
  tasks_in_progress: number
  tasks_todo: number
}

export type DotStatus = 'cyan' | 'green' | 'yellow' | 'red' | 'gray'

export interface LayoutNode {
  id: number
  name: string
  type: string
  status: DotStatus
  x: number
  y: number
}

export interface LayoutGroup {
  key: string
  label: string
  x: number
  y: number
  w: number
  h: number
  depth: number
  agents: LayoutNode[]
  children: LayoutGroup[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CARD_W = 148
export const CARD_H = 68
export const H_GAP = 14
export const NESTING_PAD = 16
export const GROUP_HEADER_H = 28
export const CHILD_V_GAP = 12
export const CHILD_H_GAP = 14
export const GROUP_GAP = 22
export const CANVAS_PAD = 32

export const DOT_COLORS_DARK: Record<DotStatus, string> = {
  cyan: '#67e8f9',
  green: '#86efac',
  yellow: '#fde047',
  red: '#fca5a5',
  gray: '#a1a1aa',
}

export const DOT_COLORS_LIGHT: Record<DotStatus, string> = {
  cyan: '#0891b2',
  green: '#16a34a',
  yellow: '#ca8a04',
  red: '#dc2626',
  gray: '#52525b',
}

// ── Status ────────────────────────────────────────────────────────────────────

export function dotStatus(agent: AgentRow): DotStatus {
  if (agent.session_status === 'blocked') return 'red'
  if (agent.session_status === 'started') return 'cyan'
  if (agent.tasks_todo > 0) return 'green'
  if (agent.tasks_in_progress > 0) return 'cyan'
  if (!agent.session_status) return 'gray'
  return 'yellow'
}

// ── Hierarchical layout (recursive, post-order) ───────────────────────────────

/**
 * Recursively builds the layout for a group tree node using a post-order traversal.
 *
 * Post-order: children are fully positioned before the parent derives its own dimensions.
 * Direct agents are laid out in a horizontal row inside the group padding.
 * Child sub-groups are placed below the agent row, advancing left-to-right.
 * The group width and height are computed from the maximum of the agent row width
 * and the total children width, plus nesting padding on both sides.
 *
 * @param group - The agent group tree node to lay out (may contain nested children).
 * @param x - Absolute x position of the group's top-left corner on the canvas.
 * @param y - Absolute y position of the group's top-left corner on the canvas.
 * @param agentsByGroup - Map from group ID to its direct agent rows.
 * @param depth - Current nesting depth (0 = root group).
 * @returns A `LayoutGroup` with absolute `x`, `y`, computed `w` (width), `h` (height),
 *   and recursively laid-out `children` and `agents`.
 */
export function buildGroupLayout(
  group: AgentGroup,
  x: number,
  y: number,
  agentsByGroup: Map<number, AgentRow[]>,
  depth: number,
): LayoutGroup {
  const directAgents = agentsByGroup.get(group.id) ?? []
  const children = group.children ?? []
  const n = directAgents.length
  const agentsRowH = n > 0 ? CARD_H + CHILD_V_GAP : 0

  const innerX = x + NESTING_PAD
  const innerY = y + NESTING_PAD + GROUP_HEADER_H + CHILD_V_GAP

  // Agent nodes positioned inside group
  const agentNodes: LayoutNode[] = directAgents.map((a, i) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    status: dotStatus(a),
    x: innerX + i * (CARD_W + H_GAP),
    y: innerY,
  }))

  // Build children (post-order), advancing curChildX as we go
  const childrenY = innerY + agentsRowH
  let curChildX = innerX
  const childLayouts: LayoutGroup[] = children.map(child => {
    const cl = buildGroupLayout(child, curChildX, childrenY, agentsByGroup, depth + 1)
    curChildX += cl.w + CHILD_H_GAP
    return cl
  })

  // Derive parent size from built children and direct agents
  const agentsRowW = n > 0 ? n * CARD_W + (n - 1) * H_GAP : 0
  const childrenTotalW =
    childLayouts.length > 0
      ? childLayouts.reduce((s, c) => s + c.w, 0) + (childLayouts.length - 1) * CHILD_H_GAP
      : 0
  const contentW = Math.max(agentsRowW, childrenTotalW, CARD_W)
  const w = contentW + NESTING_PAD * 2
  const childrenMaxH = childLayouts.length > 0 ? Math.max(...childLayouts.map(c => c.h)) : 0
  const h = NESTING_PAD + GROUP_HEADER_H + CHILD_V_GAP + agentsRowH + childrenMaxH + NESTING_PAD

  return {
    key: String(group.id),
    label: group.name,
    x, y, w, h, depth,
    agents: agentNodes,
    children: childLayouts,
  }
}

// ── Flat layout (scope-based fallback, no children) ───────────────────────────

/**
 * Builds a single-level group layout without children (scope-based fallback).
 *
 * Used when agents are grouped by scope string rather than the hierarchical group tree.
 * All agents are laid out in a single horizontal row inside the group.
 *
 * @param key - Unique key for the group (typically the scope string).
 * @param label - Display label shown in the group header.
 * @param groupAgents - List of agents belonging to this group.
 * @param x - Absolute x position of the group's top-left corner on the canvas.
 * @param y - Absolute y position of the group's top-left corner on the canvas.
 * @returns A `LayoutGroup` with computed dimensions, agent nodes, and no children.
 */
export function buildFlatGroup(
  key: string,
  label: string,
  groupAgents: AgentRow[],
  x: number,
  y: number,
): LayoutGroup {
  const n = groupAgents.length
  const contentW = n > 0 ? n * CARD_W + (n - 1) * H_GAP : CARD_W
  const w = contentW + NESTING_PAD * 2
  const h = NESTING_PAD + GROUP_HEADER_H + CHILD_V_GAP + CARD_H + NESTING_PAD
  const agentNodes: LayoutNode[] = groupAgents.map((a, i) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    status: dotStatus(a),
    x: x + NESTING_PAD + i * (CARD_W + H_GAP),
    y: y + NESTING_PAD + GROUP_HEADER_H + CHILD_V_GAP,
  }))
  return { key, label, x, y, w, h, depth: 0, agents: agentNodes, children: [] }
}

// ── Flatten tree ──────────────────────────────────────────────────────────────

/** Flatten group tree to depth-first list (parent before children). */
export function flattenGroups(groups: LayoutGroup[]): LayoutGroup[] {
  return groups.flatMap(g => [g, ...flattenGroups(g.children)])
}
