/** Types stream-json (ADR-009 §Types de messages JSONL). */

export interface StreamContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  name?: string
  input?: Record<string, unknown>
  content?: string | Array<{ type: string; text?: string }>
  tool_use_id?: string
  is_error?: boolean
  /** Pre-rendered HTML for text/tool_result blocks — computed once in flushEvents() (T791) */
  _html?: string
  /** Whether a tool_result block exceeds the collapse threshold — computed once in flushEvents() (T843) */
  _isLong?: boolean
  /** Line count of a tool_result block — computed once in flushEvents() (T843) */
  _lineCount?: number
}

export interface StreamEvent {
  type: 'system' | 'user' | 'assistant' | 'result' | 'error:spawn' | 'error:stderr' | 'error:exit'
  subtype?: string
  session_id?: string
  message?: {
    role: string
    content: StreamContentBlock[]
  }
  cost_usd?: number
  num_turns?: number
  duration_ms?: number
  /** Error message for error:spawn / error:exit events */
  error?: string
  /** Full stderr buffer captured on abnormal exit (error:exit only, T697) */
  stderr?: string
  /** Stable monotonic ID assigned on push — used as collapse key (T823). */
  _id?: number
}
