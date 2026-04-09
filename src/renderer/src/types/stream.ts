/** Types stream-json (ADR-009 §Types de messages JSONL). */

export interface StreamContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image_ref'
  text?: string
  name?: string
  input?: Record<string, unknown>
  content?: string | Array<{ type: string; text?: string }>
  tool_use_id?: string
  is_error?: boolean
  /** Local file path for image_ref blocks (T1717) */
  path?: string
  /** Blob URL for image_ref blocks — created via URL.createObjectURL (T1717) */
  objectUrl?: string
  /** Pre-rendered HTML for text/tool_result blocks — computed once in flushEvents() (T791) */
  _html?: string
  /** Whether a tool_result block exceeds the collapse threshold — computed once in flushEvents() (T843) */
  _isLong?: boolean
  /** Line count of a tool_result block — computed once in flushEvents() (T843) */
  _lineCount?: number
  /** Fallback question text for AskUserQuestion blocks when input.question is missing after IPC structured-clone (T1764) */
  _question?: string
}

export interface StreamEvent {
  type: 'system' | 'user' | 'assistant' | 'result' | 'text' | 'error' | 'error:spawn' | 'error:stderr' | 'error:exit' | 'ask_user' | 'permission_request'
  subtype?: string
  session_id?: string
  message?: {
    role: string
    content: StreamContentBlock[]
  }
  cost_usd?: number
  num_turns?: number
  duration_ms?: number
  /** Raw text for non-Claude CLI output (type: 'text' or 'error') — T1197 */
  text?: string
  /** Error message for error:spawn / error:exit events */
  error?: string
  /** Full stderr buffer captured on abnormal exit (error:exit only, T697) */
  stderr?: string
  /** Stable monotonic ID assigned on push — used as collapse key (T823). */
  _id?: number
  /** Pre-rendered HTML for type: 'text' events — computed once in flushEvents() (T1197) */
  _html?: string

  // ── Permission request fields (T1817) ───────────────────────────────────────
  /** Unique ID for correlating a permission request with its response. */
  permission_id?: string
  /** Tool name that requires permission (e.g. "Bash", "Write", "Edit"). */
  tool_name?: string
  /** Tool input arguments for the permission request. */
  tool_input?: Record<string, unknown>
}
