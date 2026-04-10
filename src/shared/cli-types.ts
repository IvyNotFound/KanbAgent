/**
 * Shared types for multi-CLI support in KanbAgent.
 *
 * Defines the CliAdapter contract, CliInstance shape, and all CLI-specific types.
 * Used by both the main process (adapters, ipc-wsl) and the renderer (LaunchSessionModal).
 *
 * Architecture: ADR-010 — each CLI has a dedicated CliAdapter in main/adapters/<cli>.ts.
 * Spawn is done directly via Node.js child_process — no third-party CLI wrapper.
 *
 * @module shared/cli-types
 */

// ── CLI identity ───────────────────────────────────────────────────────────────

/**
 * Identifiers for supported coding agent CLIs (phase 1).
 *
 * Excluded: `gh copilot` (no true agent mode), `cursor` (IDE only — no CLI agent).
 */
export type CliType =
  | 'claude'    // Anthropic Claude Code — stream-json, OAuth or API key
  | 'codex'     // OpenAI Codex CLI — full-auto approval mode
  | 'gemini'    // Google Gemini CLI — headless mode
  | 'opencode'  // SST OpenCode — terminal agent
  | 'aider'     // Paul Gauthier Aider — multi-LLM, headless
  | 'goose'     // Block Goose — CLI + ACP protocol

// ── CLI instance ───────────────────────────────────────────────────────────────

/**
 * Represents a detected CLI installation on a given environment (WSL distro or local).
 *
 * @property cli       - Which coding agent CLI this instance represents.
 * @property distro    - WSL distribution name (e.g. `"Ubuntu"`) or `"local"` for native installs.
 * @property version   - CLI version string as reported by `<cli> --version`.
 * @property isDefault - Whether this distro is marked as default in `wsl.exe -l`.
 * @property type      - `"wsl"` for WSL distro instances, `"local"` for native installs.
 */
export interface CliInstance {
  cli: CliType
  distro: string
  version: string
  isDefault: boolean
  type: 'wsl' | 'local'
}

/**
 * Backward-compatible alias.
 * All existing code using `ClaudeInstance` continues to work — no import changes required.
 */
export type ClaudeInstance = CliInstance

// ── Adapter contract ───────────────────────────────────────────────────────────

/**
 * Declares what a CLI supports — used by LaunchSessionModal to show/hide options.
 *
 * R2 mitigation (T1036): defined here so the renderer can use a static map
 * while T1012 (adapter-level capabilities) is not yet shipped.
 */
export interface CliCapabilities {
  /** Git worktree isolation (T1031) — true for every CLI. */
  worktree: boolean
  /** Multi-instance / profile selection (Claude only). */
  profileSelection: boolean
  /** System prompt injection via --append-system-prompt (or equivalent). */
  systemPrompt: boolean
  /** Thinking mode toggle — --settings alwaysThinkingEnabled (Claude only). */
  thinkingMode: boolean
  /** Session resume via --resume / conversation ID (Claude only). */
  convResume: boolean
  /** Model selection via --model flag (T1356). */
  modelSelection: boolean
}

/**
 * Options forwarded from agent:create to each adapter's buildCommand.
 */
export interface LaunchOpts {
  /** Validated conversation UUID to resume via --resume (or equivalent). */
  convId?: string
  /** `'disabled'` → inject alwaysThinkingEnabled:false (Claude only). */
  thinkingMode?: string
  /** `'auto'` → inject --dangerously-skip-permissions (Claude only). */
  permissionMode?: string
  /** Absolute path to temp file containing the raw system prompt text. */
  systemPromptFile?: string
  /** Custom binary name (e.g. `"claude-pro2"`, `"gemini-beta"`). Validated by adapter.binaryRegex. */
  customBinaryName?: string
  /** Initial user message to pass at spawn time (used by adapters that take prompts as positional args, e.g. opencode). */
  initialMessage?: string
  /** Model identifier to pass via CLI flag (e.g. `-m gemini-2.5-flash` for Gemini). */
  model?: string
  /** Model ID to pass via --model flag (T1356 — OpenCode only for now). */
  modelId?: string
}

/**
 * Spawn specification returned by CliAdapter.buildCommand.
 * The caller (agent-stream.ts) is responsible for wrapping in wsl.exe if needed.
 */
export interface SpawnSpec {
  /** Executable to spawn (e.g. `"bash"`, `"powershell.exe"`, `"wsl.exe"`). */
  command: string
  /** Arguments array passed to spawn. */
  args: string[]
  /** Additional environment variables to merge into the spawn env. */
  env?: Record<string, string>
}

/**
 * Result of CliAdapter.prepareSystemPrompt — temp file + cleanup callback.
 */
export interface SystemPromptResult {
  /** Absolute path to the temp file written with the system prompt. */
  filePath: string
  /** Remove the temp file. Called after spawn confirms the file was read. */
  cleanup: () => Promise<void>
}

/**
 * Token usage counts accumulated from a CLI stream session.
 * Used by extractTokenUsage to aggregate usage across events.
 */
export interface TokenCounts {
  /** Number of input (prompt) tokens consumed. */
  tokensIn: number
  /** Number of output (completion) tokens generated. */
  tokensOut: number
  /** Number of tokens read from the prompt cache (Claude / compatible CLIs). */
  cacheRead: number
  /** Number of tokens written to the prompt cache (Claude / compatible CLIs). */
  cacheWrite: number
  /** Session cost in USD, if reported by the CLI. */
  costUsd?: number
}

/**
 * A parsed event emitted from the CLI stdout stream.
 * Shape varies by CLI; Claude uses JSONL (ADR-009), others emit plain text lines.
 */
export interface StreamEvent {
  /** Event type — normalized across adapters. */
  type: 'system' | 'user' | 'assistant' | 'result' | 'text' | 'error' | 'ask_user' | 'permission_request'
  subtype?: string
  /** Conversation ID (extracted by extractConvId). */
  session_id?: string
  message?: {
    role: string
    content: Array<{
      type: string
      text?: string
      /** tool_use block: tool name */
      name?: string
      /** tool_use block: tool input arguments */
      input?: Record<string, unknown>
      /** tool_use / tool_result correlation ID */
      tool_use_id?: string
      /** tool_result block: result content string */
      content?: string
      /** tool_result block: whether the tool call failed */
      is_error?: boolean
    }>
  }
  /** Plain-text output line (non-JSONL CLIs). */
  text?: string
  cost_usd?: number
  num_turns?: number

  // ── Permission request fields (T1816) ───────────────────────────────────────
  /** Unique ID for correlating a permission request with its response. */
  permission_id?: string
  /** Tool name that requires permission (e.g. "Bash", "Write", "Edit"). */
  tool_name?: string
  /** Tool input arguments for the permission request. */
  tool_input?: Record<string, unknown>
}

/**
 * Contract that every CLI adapter must implement.
 *
 * Each adapter lives in `src/main/adapters/<cli>.ts` and is imported
 * by ipc-wsl.ts (detection) and agent-stream.ts (spawn).
 *
 * Implementation rules:
 * - buildCommand must never shell-inject: use args arrays, not strings
 * - prepareSystemPrompt writes a temp file; caller triggers cleanup after spawn
 * - parseLine returns null for lines that are not meaningful events (e.g. blank lines)
 * - extractConvId is optional; only Claude exposes a stable conversation UUID
 */
export interface CliAdapter {
  /** CLI identifier — must match the CliType value. */
  cli: CliType

  /**
   * Known binary names for this CLI (used for detection via `which`/`where`).
   * First entry is the canonical binary name.
   */
  binaries: string[]

  /**
   * Regex to validate customBinaryName for this CLI.
   * If undefined, agent-stream falls back to `^<canonical-binary>(-[a-z0-9-]+)?$`.
   */
  binaryRegex?: RegExp

  /**
   * Build the spawn spec for launching this CLI in headless/agent mode.
   * Returned SpawnSpec is wrapped in wsl.exe by the caller for WSL environments.
   */
  buildCommand(opts: LaunchOpts): SpawnSpec

  /**
   * Write the system prompt to a temp file and return the path + cleanup callback.
   * @param prompt  - Raw system prompt string.
   * @param tempDir - Directory for temp file (typically os.tmpdir()).
   */
  prepareSystemPrompt(prompt: string, tempDir: string): Promise<SystemPromptResult>

  /**
   * Parse a single stdout line into a StreamEvent.
   * Returns null if the line carries no meaningful event (blank, debug noise, etc.).
   */
  parseLine(line: string): StreamEvent | null

  /**
   * Extract the stable conversation/session ID from a stream event.
   * Only implemented for CLIs that support session resume (currently Claude only).
   */
  extractConvId?(event: StreamEvent): string | null

  /**
   * Extract token usage from a stream event.
   * Called on every non-null event returned by parseLine.
   * Return null if this event carries no usage data.
   * Counts are accumulated across all events in a session by stream-handlers.ts.
   *
   * Implementations should use `(event as any).<field>` for CLI-specific fields
   * not present in the StreamEvent base type.
   *
   * @param event - Parsed stream event returned by parseLine.
   * @returns Partial token counts to accumulate, or null if the event carries no usage data.
   */
  extractTokenUsage?(event: StreamEvent): Partial<TokenCounts> | null

  /**
   * Format a user message for delivery via proc.stdin.write().
   * If defined, `agent:send` uses this instead of the default Claude JSONL format.
   * Returned string is written verbatim to stdin.
   */
  formatStdinMessage?(text: string): string

  /**
   * If true, stdin is closed (EOF) after each `formatStdinMessage` write.
   * Prevents indefinite stdin wait for one-shot CLIs (e.g. opencode run).
   */
  singleShotStdin?: boolean
}
