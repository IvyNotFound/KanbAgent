/**
 * Shared Zod schemas for IPC validation.
 *
 * Single source of truth for all input/output contracts between main and renderer.
 * These schemas are used by main-process IPC handlers for runtime validation.
 * The exported TypeScript types (via `z.infer`) are consumed by `electron.d.ts`
 * so the renderer benefits from accurate typing without manual duplication.
 *
 * Usage in main handlers:
 *   import { PositiveIdSchema, CreateAgentDataSchema } from '../shared/ipc-schemas'
 *
 * Usage in renderer types (electron.d.ts):
 *   import type { CreateAgentData, UpdateAgentData } from '../../../shared/ipc-schemas'
 *
 * @module shared/ipc-schemas
 */

import { z } from 'zod'

// ── Primitive schemas ─────────────────────────────────────────────────────────

/**
 * Positive integer DB identifier (agent ID, task ID, group ID, etc.).
 * Rejects 0, negative numbers, and non-integers.
 */
export const PositiveIdSchema = z.number().int().positive()

/**
 * Agent display name: human-readable, 1–200 chars.
 * Used for agent names in the database and UI labels.
 */
export const AgentDisplayNameSchema = z.string().min(1).max(200)

/**
 * Agent name for git worktree branches: alphanumeric + hyphens only.
 * Prevents shell injection in `git worktree add -b agent/<name>/s<id>`.
 */
export const AgentWorktreeNameSchema = z.string().regex(
  /^[\w-]+$/,
  'agentName must be alphanumeric with hyphens only'
)

/**
 * Worktree session identifier: alphanumeric + hyphens only.
 * Matches the nonce format produced by dbstart.js (e.g. `"abc123-def456"`).
 */
export const SessionIdSchema = z.string().regex(
  /^[\w-]+$/,
  'sessionId must be alphanumeric with hyphens only'
)

/**
 * Claude Code conversation UUID (lowercase hex, 8-4-4-4-12 format).
 * Validated before being stored in sessions.claude_conv_id.
 */
export const ConvIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'convId must be a valid UUID'
)

/**
 * Non-empty, non-whitespace file system path.
 * Used for worktree workDir validation.
 */
export const WorkDirSchema = z.string().min(1).refine(
  s => s.trim().length > 0,
  { message: 'workDir must not be whitespace-only' }
)

/**
 * System prompt text: max 100 000 chars.
 * Shared by system_prompt and system_prompt_suffix fields.
 */
export const SystemPromptSchema = z.string().max(100_000)

// ── Composite schemas ─────────────────────────────────────────────────────────

/**
 * Data required to create a new agent.
 * Validated in the `create-agent` IPC handler before DB insertion.
 */
export const CreateAgentDataSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  scope: z.string().max(200).nullable().optional(),
  perimetre: z.string().max(200).nullable().optional(),
  thinkingMode: z.string().nullable().optional(),
  systemPrompt: SystemPromptSchema.nullable().optional(),
  description: z.string().max(2000).optional(),
  preferredModel: z.string().max(200).nullable().optional(),
})

/**
 * Partial fields for bulk-updating an existing agent (`update-agent` handler).
 * All fields are optional; only provided keys are applied via SET clauses.
 */
export const UpdateAgentDataSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().min(1).max(100).optional(),
  scope: z.string().max(200).nullable().optional(),
  perimetre: z.string().max(200).nullable().optional(),
  thinkingMode: z.string().nullable().optional(),
  allowedTools: z.string().max(10_000).nullable().optional(),
  systemPrompt: SystemPromptSchema.nullable().optional(),
  systemPromptSuffix: SystemPromptSchema.nullable().optional(),
  autoLaunch: z.boolean().optional(),
  permissionMode: z.enum(['default', 'auto']).nullable().optional(),
  maxSessions: z.number().int().refine(v => v >= 1 || v === -1, {
    message: 'maxSessions must be an integer >= 1 or -1 (unlimited)',
  }).optional(),
  worktreeEnabled: z.boolean().nullable().optional(),
  preferredModel: z.string().max(200).nullable().optional(),
})

// ── Inferred TypeScript types ─────────────────────────────────────────────────

/** TypeScript type for agent creation payload — derived from Zod schema. */
export type CreateAgentData = z.infer<typeof CreateAgentDataSchema>

/** TypeScript type for agent update payload — derived from Zod schema. */
export type UpdateAgentData = z.infer<typeof UpdateAgentDataSchema>
