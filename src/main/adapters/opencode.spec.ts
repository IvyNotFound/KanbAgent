/**
 * Deep mutation-killing tests for the opencode adapter (T1070, updated T1084).
 *
 * Targets:
 * - OPENCODE_CMD_REGEX: anchors, suffix pattern, invalid chars
 * - buildCommand: customBinaryName guard (falsy, valid, invalid)
 * - buildCommand: args array contains "run" subcommand and "--format json"
 * - buildCommand: no --message flag (opencode does not support it)
 * - parseLine: text, reasoning, error, lifecycle events, plain text fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn<() => boolean>())
const mockReadFileSync = vi.hoisted(() => vi.fn<() => string>())
vi.mock('fs', () => {
  const fns = {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  }
  return { default: fns, ...fns }
})

import { opencodeAdapter, OPENCODE_CMD_REGEX } from './opencode'

// ── OPENCODE_CMD_REGEX ────────────────────────────────────────────────────────

describe('OPENCODE_CMD_REGEX', () => {
  it('matches exact "opencode"', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode')).toBe(true)
  })

  it('matches "opencode-custom" (valid suffix)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-custom')).toBe(true)
  })

  it('matches "opencode-123" (numeric suffix)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-123')).toBe(true)
  })

  it('rejects "opencode-CAPS" (uppercase in suffix)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-CAPS')).toBe(false)
  })

  it('rejects "not-opencode" (anchor ^ required)', () => {
    expect(OPENCODE_CMD_REGEX.test('not-opencode')).toBe(false)
  })

  it('rejects "opencode-" (trailing dash without suffix body)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode-')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(OPENCODE_CMD_REGEX.test('')).toBe(false)
  })

  it('rejects "opencode extra" (space — anchor $ required)', () => {
    expect(OPENCODE_CMD_REGEX.test('opencode extra')).toBe(false)
  })
})

// ── opencodeAdapter.buildCommand ──────────────────────────────────────────────

describe('opencodeAdapter.buildCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: readFileSync returns empty string (system prompt not present in most tests)
    mockReadFileSync.mockReturnValue('')
  })
  it('defaults to "opencode" when customBinaryName is undefined', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.command).toBe('opencode')
  })

  it('defaults to "opencode" when customBinaryName is empty string (falsy)', () => {
    const spec = opencodeAdapter.buildCommand({ customBinaryName: '' })
    expect(spec.command).toBe('opencode')
  })

  it('defaults to "opencode" when customBinaryName fails regex (invalid)', () => {
    const spec = opencodeAdapter.buildCommand({ customBinaryName: 'rm -rf /' })
    expect(spec.command).toBe('opencode')
  })

  it('uses customBinaryName when it matches OPENCODE_CMD_REGEX', () => {
    const spec = opencodeAdapter.buildCommand({ customBinaryName: 'opencode-dev' })
    expect(spec.command).toBe('opencode-dev')
  })

  it('args array is non-empty (at least "run" and "--format" flags)', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args.length).toBeGreaterThan(0)
  })

  it('args contain "run" subcommand by default', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).toContain('run')
  })

  it('args[0] is "run" (subcommand position correct)', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args[0]).toBe('run')
  })

  it('args contain "--format" flag for JSONL output', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).toContain('--format')
  })

  it('args contain "json" as value for --format flag', () => {
    const spec = opencodeAdapter.buildCommand({})
    const idx = spec.args.indexOf('--format')
    expect(idx).toBeGreaterThan(-1)
    expect(spec.args[idx + 1]).toBe('json')
  })

  it('does not include --message flag (opencode has no --message @file support)', () => {
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    expect(spec.args).not.toContain('--message')
  })

  it('does not include --message when systemPromptFile is absent', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).not.toContain('--message')
  })

  it('customBinaryName exact name is in returned command field', () => {
    const spec = opencodeAdapter.buildCommand({ customBinaryName: 'opencode' })
    expect(spec.command).toBe('opencode')
  })

  it('appends initialMessage as positional arg when provided', () => {
    const spec = opencodeAdapter.buildCommand({ initialMessage: 'hello world' })
    expect(spec.args[spec.args.length - 1]).toBe('hello world')
  })

  it('does not append positional arg when initialMessage is absent', () => {
    const spec = opencodeAdapter.buildCommand({})
    // args: ['run', '--format', 'json'] — no extra positional
    expect(spec.args.length).toBe(3)
  })

  it('initialMessage is passed as a single arg (not split on spaces)', () => {
    const spec = opencodeAdapter.buildCommand({ initialMessage: 'fix the bug in app.ts' })
    const positionalArgs = spec.args.slice(3)
    expect(positionalArgs).toEqual(['fix the bug in app.ts'])
  })

  it('injects --model flag when modelId is provided (T1356)', () => {
    const spec = opencodeAdapter.buildCommand({ modelId: 'anthropic/claude-opus-4-5' })
    expect(spec.args).toContain('--model')
    const idx = spec.args.indexOf('--model')
    expect(spec.args[idx + 1]).toBe('anthropic/claude-opus-4-5')
  })

  it('does not inject --model when modelId is absent (T1356)', () => {
    const spec = opencodeAdapter.buildCommand({})
    expect(spec.args).not.toContain('--model')
  })

  it('places --model before initialMessage positional arg (T1356)', () => {
    const spec = opencodeAdapter.buildCommand({ modelId: 'gemini-2.5-pro', initialMessage: 'hello' })
    const modelIdx = spec.args.indexOf('--model')
    const msgIdx = spec.args.indexOf('hello')
    expect(modelIdx).toBeGreaterThan(-1)
    expect(msgIdx).toBeGreaterThan(modelIdx)
  })
})

// ── opencodeAdapter.parseLine ─────────────────────────────────────────────────

describe('opencodeAdapter.parseLine', () => {
  it('returns null for blank line', () => {
    expect(opencodeAdapter.parseLine('')).toBeNull()
    expect(opencodeAdapter.parseLine('   ')).toBeNull()
  })

  it('maps type:text event — new part-wrapped format v1.3.4+ (primary format)', () => {
    const line = '{"type":"text","sessionID":"ses_abc","part":{"id":"p1","type":"text","text":"hello","time":{"start":0,"end":1}}}'
    expect(opencodeAdapter.parseLine(line)).toEqual({ type: 'text', text: 'hello' })
  })

  it('maps type:text event — legacy flat format (backward compat < v1.3.4)', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","text":"hello","sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'hello' })
  })

  it('maps type:reasoning event — new part-wrapped format v1.3.4+ (primary format)', () => {
    const line = '{"type":"reasoning","sessionID":"ses_abc","part":{"id":"r1","type":"reasoning","text":"thinking...","time":{"start":0,"end":2}}}'
    expect(opencodeAdapter.parseLine(line)).toEqual({ type: 'text', text: 'thinking...' })
  })

  it('maps type:reasoning event — legacy flat format (backward compat < v1.3.4)', () => {
    const event = opencodeAdapter.parseLine('{"type":"reasoning","text":"thinking...","sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'thinking...' })
  })

  it('maps type:error event using message field', () => {
    const event = opencodeAdapter.parseLine('{"type":"error","message":"something failed"}')
    expect(event).toEqual({ type: 'error', text: 'something failed' })
  })

  it('maps type:error event using text field when message absent', () => {
    const event = opencodeAdapter.parseLine('{"type":"error","text":"alt error"}')
    expect(event).toEqual({ type: 'error', text: 'alt error' })
  })

  it('converts type:tool_use to assistant event with tool_use block', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","name":"bash","input":{"cmd":"ls -la"}}')
    expect(event?.type).toBe('assistant')
    expect(event?.message?.content[0]?.type).toBe('tool_use')
    expect(event?.message?.content[0]?.name).toBe('bash')
    expect(event?.message?.content[0]?.input).toEqual({ cmd: 'ls -la' })
  })

  it('converts type:tool_use with toolCallId to assistant event with tool_use_id', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","name":"bash","input":{},"toolCallId":"call_abc123"}')
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_abc123')
  })

  it('converts type:tool_use with id field (fallback) to assistant event with tool_use_id', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","name":"str_replace","input":{},"id":"tu_xyz"}')
    expect(event?.message?.content[0]?.tool_use_id).toBe('tu_xyz')
  })

  it('converts type:tool_use with unknown name to "unknown" fallback', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","input":{}}')
    expect(event?.message?.content[0]?.name).toBe('unknown')
  })

  it('does NOT set _blocked on tool_use with unknown name (opencode has no permission-deny concept — T1942)', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","input":{}}')
    expect(event?.message?.content[0]?._blocked).toBeUndefined()
  })

  it('converts type:tool_use with null input to empty object fallback', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_use","name":"bash","input":null}')
    expect(event?.message?.content[0]?.input).toEqual({})
  })

  it('converts type:tool_result to assistant event with tool_result block (content field)', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_result","content":"file found","toolCallId":"call_abc"}')
    expect(event?.type).toBe('assistant')
    expect(event?.message?.content[0]?.type).toBe('tool_result')
    expect(event?.message?.content[0]?.content).toBe('file found')
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_abc')
  })

  it('converts type:tool_result using result field when content is absent', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_result","result":"success output"}')
    expect(event?.message?.content[0]?.content).toBe('success output')
  })

  it('converts type:tool_result using output field when content and result are absent', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_result","output":"command output"}')
    expect(event?.message?.content[0]?.content).toBe('command output')
  })

  it('converts type:tool_result with isError:true to is_error block', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_result","content":"error msg","isError":true}')
    expect(event?.message?.content[0]?.is_error).toBe(true)
  })

  it('converts type:tool_result with is_error:true to is_error block (snake_case variant)', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_result","content":"err","is_error":true}')
    expect(event?.message?.content[0]?.is_error).toBe(true)
  })

  it('converts type:tool_result with no error flag to is_error:false', () => {
    const event = opencodeAdapter.parseLine('{"type":"tool_result","content":"ok"}')
    expect(event?.message?.content[0]?.is_error).toBe(false)
  })

  it('converts type:tool_use with part wrapper (v1.3+) — extracts name and input from part', () => {
    const line = '{"type":"tool_use","sessionID":"s1","part":{"name":"bash","input":{"cmd":"ls -la"},"toolCallId":"call_xyz"}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.type).toBe('assistant')
    expect(event?.message?.content[0]?.type).toBe('tool_use')
    expect(event?.message?.content[0]?.name).toBe('bash')
    expect(event?.message?.content[0]?.input).toEqual({ cmd: 'ls -la' })
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_xyz')
  })

  it('converts type:tool_use with part wrapper (v1.3+) — id fallback in part', () => {
    const line = '{"type":"tool_use","part":{"name":"str_replace","input":{},"id":"tu_part_id"}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.tool_use_id).toBe('tu_part_id')
  })

  it('converts type:tool_use with part wrapper (v1.3+) — unknown name fallback when part.name missing', () => {
    const line = '{"type":"tool_use","part":{"input":{}}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.name).toBe('unknown')
  })

  it('converts type:tool_use with part wrapper (v1.3+) — prefers part.name over flat name', () => {
    const line = '{"type":"tool_use","name":"flat_name","part":{"name":"part_name","input":{}}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.name).toBe('part_name')
  })

  it('converts type:tool_result with part wrapper (v1.3+) — extracts content from part', () => {
    const line = '{"type":"tool_result","sessionID":"s1","part":{"content":"tool output","toolCallId":"call_abc","isError":false}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.type).toBe('assistant')
    expect(event?.message?.content[0]?.type).toBe('tool_result')
    expect(event?.message?.content[0]?.content).toBe('tool output')
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_abc')
    expect(event?.message?.content[0]?.is_error).toBe(false)
  })

  it('converts type:tool_result with part wrapper (v1.3+) — result field fallback', () => {
    const line = '{"type":"tool_result","part":{"result":"fallback result","id":"tr_id"}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.content).toBe('fallback result')
    expect(event?.message?.content[0]?.tool_use_id).toBe('tr_id')
  })

  it('converts type:tool_result with part wrapper (v1.3+) — output field fallback', () => {
    const line = '{"type":"tool_result","part":{"output":"cmd output"}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.content).toBe('cmd output')
  })

  it('converts type:tool_result with part wrapper (v1.3+) — isError:true propagated', () => {
    const line = '{"type":"tool_result","part":{"content":"err","isError":true}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.is_error).toBe(true)
  })

  it('converts type:tool_result with part wrapper (v1.3+) — is_error:true propagated (snake_case)', () => {
    const line = '{"type":"tool_result","part":{"content":"err","is_error":true}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.is_error).toBe(true)
  })

  it('converts type:tool_result with part wrapper (v1.3+) — prefers part.content over flat content', () => {
    const line = '{"type":"tool_result","content":"flat_content","part":{"content":"part_content"}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.message?.content[0]?.content).toBe('part_content')
  })

  it('returns null for type:step_start (lifecycle event)', () => {
    const event = opencodeAdapter.parseLine('{"type":"step_start","timestamp":1234}')
    expect(event).toBeNull()
  })

  it('returns system:step_finish event for type:step_finish (for token accounting)', () => {
    const event = opencodeAdapter.parseLine('{"type":"step_finish","duration":100}')
    expect(event?.type).toBe('system')
    expect((event as any)?.subtype).toBe('step_finish')
  })

  it('returns system:step_finish event for type:step_finish with cost and tokens (v1.3.4+ full format)', () => {
    const line = '{"type":"step_finish","sessionID":"ses_abc","cost":0.0042,"tokens":{"input":1200,"output":350,"cache_read":0,"cache_write":0},"duration":3800}'
    const event = opencodeAdapter.parseLine(line)
    expect(event?.type).toBe('system')
    expect((event as any)?.subtype).toBe('step_finish')
  })

  it('falls back to plain text for non-JSON line', () => {
    const event = opencodeAdapter.parseLine('some plain text output')
    expect(event).toEqual({ type: 'text', text: 'some plain text output' })
  })

  it('maps type:text event with part-wrapped format (v1.3+)', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","part":{"id":"p1","type":"text","text":"hello from part","time":{"start":0,"end":1}},"sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'hello from part' })
  })

  it('maps type:reasoning event with part-wrapped format (v1.3+)', () => {
    const event = opencodeAdapter.parseLine('{"type":"reasoning","part":{"id":"r1","type":"reasoning","text":"thinking via part","time":{"start":0,"end":2}},"sessionID":"s1"}')
    expect(event).toEqual({ type: 'text', text: 'thinking via part' })
  })

  it('prefers part.text over flat text when both present', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","part":{"text":"from part"},"text":"from flat"}')
    expect(event).toEqual({ type: 'text', text: 'from part' })
  })

  it('falls back to flat text when part is present but has no text field', () => {
    const event = opencodeAdapter.parseLine('{"type":"text","part":{"other":"field"},"text":"flat fallback"}')
    expect(event).toEqual({ type: 'text', text: 'flat fallback' })
  })

  it('falls back to raw line for type:text event with missing text field and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = '{"type":"text","other":"field"}'
    const event = opencodeAdapter.parseLine(raw)
    expect(event).toEqual({ type: 'text', text: raw })
    expect(warnSpy).toHaveBeenCalledWith(
      '[opencode] parseLine: text event with unknown structure, surfacing raw line'
    )
    warnSpy.mockRestore()
  })

  it('maps type:error with nested error.data.message (opencode v1.2+ format)', () => {
    const line = '{"type":"error","timestamp":1000,"sessionID":"s1","error":{"name":"ProviderAuthError","data":{"providerID":"google","message":"API key is missing"}}}'
    const event = opencodeAdapter.parseLine(line)
    expect(event).toEqual({ type: 'error', text: 'API key is missing' })
  })

  it('falls back to raw line for type:error with unknown nested structure', () => {
    const raw = '{"type":"error","error":{"name":"UnknownError"}}'
    const event = opencodeAdapter.parseLine(raw)
    expect(event).toEqual({ type: 'error', text: raw })
  })

  // ── OpenCode SDK v2 official format ──────────────────────────────────────────

  it('SDK v2: resolves tool name from part.tool', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      timestamp: 1776348998710,
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call_0406b82ff9c744ab9c7d0c88',
        state: { status: 'completed', input: { filePath: '/tmp/foo' }, output: '<result>ok</result>' },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const events = Array.isArray(result) ? result : [result]
    expect(events[0]?.message?.content[0]?.name).toBe('read')
  })

  it('SDK v2: resolves input from part.state.input', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'read',
        callID: 'call_abc',
        state: { status: 'completed', input: { filePath: '/tmp/bar' }, output: 'content' },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const events = Array.isArray(result) ? result : [result]
    expect(events[0]?.message?.content[0]?.input).toEqual({ filePath: '/tmp/bar' })
  })

  it('SDK v2: resolves call ID from part.callID', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'bash',
        callID: 'call_0406b82ff9c744ab',
        state: { status: 'completed', input: { command: 'ls' }, output: 'file.ts' },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const events = Array.isArray(result) ? result : [result]
    expect(events[0]?.message?.content[0]?.tool_use_id).toBe('call_0406b82ff9c744ab')
  })

  it('SDK v2: returns array [tool_use, tool_result] when state.output present', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'read',
        callID: 'call_xyz',
        state: { status: 'completed', input: { filePath: '/tmp/f' }, output: 'file content here' },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    expect(Array.isArray(result)).toBe(true)
    const events = result as any[]
    expect(events).toHaveLength(2)
    expect(events[0]?.message?.content[0]?.type).toBe('tool_use')
    expect(events[1]?.message?.content[0]?.type).toBe('tool_result')
    expect(events[1]?.message?.content[0]?.content).toBe('file content here')
    expect(events[1]?.message?.content[0]?.tool_use_id).toBe('call_xyz')
  })

  it('SDK v2: tool_result in array has is_error:false when status is "completed"', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'bash',
        callID: 'call_ok',
        state: { status: 'completed', input: {}, output: 'ok' },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const events = result as any[]
    expect(events[1]?.message?.content[0]?.is_error).toBe(false)
  })

  it('SDK v2: tool_result has is_error:true when state.status is "error"', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'bash',
        callID: 'call_err',
        state: { status: 'error', input: {}, output: 'command not found' },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const events = result as any[]
    expect(events[1]?.message?.content[0]?.is_error).toBe(true)
  })

  it('SDK v2: returns single StreamEvent (not array) when state.output is absent', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'bash',
        callID: 'call_pending',
        state: { status: 'pending', input: { command: 'ls' } },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    expect(Array.isArray(result)).toBe(false)
    expect(result?.message?.content[0]?.type).toBe('tool_use')
  })

  it('SDK v2: part.tool takes priority over part.name (both present)', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'sdk_tool',
        name: 'legacy_name',
        callID: 'call_prio',
        state: { status: 'pending', input: {} },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const event = Array.isArray(result) ? result[0] : result
    expect(event?.message?.content[0]?.name).toBe('sdk_tool')
  })

  it('SDK v2: part.input takes priority over part.state.input (both present)', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'read',
        callID: 'call_input_prio',
        input: { direct: true },
        state: { status: 'pending', input: { fromState: true } },
      },
    })
    const result = opencodeAdapter.parseLine(line)
    const event = Array.isArray(result) ? result[0] : result
    expect(event?.message?.content[0]?.input).toEqual({ direct: true })
  })

  it('SDK v2: warns when tool name falls back to unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const line = JSON.stringify({ type: 'tool_use', part: { callID: 'call_unk', state: { status: 'pending', input: {} } } })
    opencodeAdapter.parseLine(line)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[opencode] tool_use fallback to unknown:'),
      expect.any(String)
    )
    warnSpy.mockRestore()
  })

  it('legacy format still works after SDK v2 changes (backward compat)', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'bash', input: { cmd: 'echo hi' }, toolCallId: 'call_legacy' })
    const result = opencodeAdapter.parseLine(line)
    const event = Array.isArray(result) ? result[0] : result
    expect(event?.message?.content[0]?.name).toBe('bash')
    expect(event?.message?.content[0]?.input).toEqual({ cmd: 'echo hi' })
    expect(event?.message?.content[0]?.tool_use_id).toBe('call_legacy')
  })
})

// ── opencodeAdapter.formatStdinMessage ────────────────────────────────────────

describe('opencodeAdapter.formatStdinMessage', () => {
  it('is defined (opencode uses plain-text stdin, not Claude JSONL)', () => {
    expect(typeof opencodeAdapter.formatStdinMessage).toBe('function')
  })

  it('returns text with a trailing newline', () => {
    const result = opencodeAdapter.formatStdinMessage!('hello world')
    expect(result).toBe('hello world\n')
  })

  it('preserves special characters in the message', () => {
    const result = opencodeAdapter.formatStdinMessage!('fix: add "quoted" & <html> stuff')
    expect(result).toBe('fix: add "quoted" & <html> stuff\n')
  })

  it('returns empty string + newline for empty input', () => {
    const result = opencodeAdapter.formatStdinMessage!('')
    expect(result).toBe('\n')
  })
})

// ── opencodeAdapter.singleShotStdin ──────────────────────────────────────────

describe('opencodeAdapter.singleShotStdin', () => {
  it('is true (opencode run reads one prompt per spawn — stdin must be closed after write)', () => {
    expect(opencodeAdapter.singleShotStdin).toBe(true)
  })
})

// ── opencodeAdapter.extractTokenUsage ────────────────────────────────────────

describe('opencodeAdapter.extractTokenUsage', () => {
  it('returns null for events with no usage field', () => {
    expect(opencodeAdapter.extractTokenUsage?.({ type: 'text', text: 'hello' })).toBeNull()
  })

  it('extracts inputTokens / outputTokens (camelCase format)', () => {
    const event = { type: 'system', subtype: 'step_finish', usage: { inputTokens: 100, outputTokens: 50 } } as any
    expect(opencodeAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 100, tokensOut: 50 })
  })

  it('extracts input_tokens / output_tokens (snake_case format)', () => {
    const event = { type: 'system', subtype: 'step_finish', usage: { input_tokens: 80, output_tokens: 40 } } as any
    expect(opencodeAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 80, tokensOut: 40 })
  })

  it('extracts prompt_tokens / completion_tokens (OpenAI legacy format)', () => {
    const event = { type: 'system', subtype: 'step_finish', usage: { prompt_tokens: 60, completion_tokens: 30 } } as any
    expect(opencodeAdapter.extractTokenUsage?.(event)).toMatchObject({ tokensIn: 60, tokensOut: 30 })
  })

  it('includes costUsd when present in usage', () => {
    const event = { type: 'system', subtype: 'step_finish', usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 } } as any
    const result = opencodeAdapter.extractTokenUsage?.(event)
    expect(result?.costUsd).toBe(0.001)
  })

  it('omits costUsd when not a number', () => {
    const event = { type: 'system', subtype: 'step_finish', usage: { input_tokens: 10, output_tokens: 5 } } as any
    const result = opencodeAdapter.extractTokenUsage?.(event)
    expect(result?.costUsd).toBeUndefined()
  })
})

// ── opencodeAdapter.prepareSystemPrompt ──────────────────────────────────────

describe('opencodeAdapter.prepareSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockReturnValue('')
  })

  // ── No worktree (no cwd) ──────────────────────────────────────────────────

  it('without cwd: writes opencode-sp-*.txt to tempDir', async () => {
    const result = await opencodeAdapter.prepareSystemPrompt('my prompt', '/tmp')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/opencode-sp-\d+\.txt$/),
      'my prompt',
      'utf-8'
    )
    expect(result.filePath).toMatch(/opencode-sp-\d+\.txt$/)
  })

  it('without cwd: returns filePath inside tempDir', async () => {
    const result = await opencodeAdapter.prepareSystemPrompt('prompt', join('/tmp'))
    expect(result.filePath).toContain('tmp')
    expect(result.filePath).toContain('opencode-sp-')
  })

  it('without cwd: cleanup calls unlinkSync on the .txt file', async () => {
    const result = await opencodeAdapter.prepareSystemPrompt('prompt', '/tmp')
    vi.clearAllMocks()
    await result.cleanup()
    expect(mockUnlinkSync).toHaveBeenCalledWith(result.filePath)
  })

  // ── Worktree mode (cwd provided, no existing opencode.jsonc) ─────────────

  it('with cwd (no existing file): writes opencode.jsonc with instructions array', async () => {
    mockExistsSync.mockReturnValue(false)
    await opencodeAdapter.prepareSystemPrompt('sys prompt', '/tmp', '/worktree')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/worktree', 'opencode.jsonc'),
      JSON.stringify({ instructions: ['sys prompt'] }, null, 2),
      'utf-8'
    )
  })

  it('with cwd (no existing file): returns filePath = opencode.jsonc in worktree', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await opencodeAdapter.prepareSystemPrompt('prompt', '/tmp', '/worktree')
    expect(result.filePath).toBe(join('/worktree', 'opencode.jsonc'))
  })

  it('with cwd (no existing file): cleanup calls unlinkSync (not writeFileSync)', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await opencodeAdapter.prepareSystemPrompt('prompt', '/tmp', '/worktree')
    vi.clearAllMocks()
    await result.cleanup()
    expect(mockUnlinkSync).toHaveBeenCalledWith(join('/worktree', 'opencode.jsonc'))
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  // ── Worktree mode (cwd provided, existing opencode.jsonc) ────────────────

  it('with cwd (existing file): prepends system prompt to instructions array', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ instructions: ['existing instruction'] }))
    await opencodeAdapter.prepareSystemPrompt('new prompt', '/tmp', '/worktree')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/worktree', 'opencode.jsonc'),
      JSON.stringify({ instructions: ['new prompt', 'existing instruction'] }, null, 2),
      'utf-8'
    )
  })

  it('with cwd (existing file, no instructions array): creates instructions array with prompt', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'claude-opus-4-6' }))
    await opencodeAdapter.prepareSystemPrompt('my prompt', '/tmp', '/worktree')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/worktree', 'opencode.jsonc'),
      JSON.stringify({ model: 'claude-opus-4-6', instructions: ['my prompt'] }, null, 2),
      'utf-8'
    )
  })

  it('with cwd (existing file): cleanup restores original content via writeFileSync', async () => {
    const original = JSON.stringify({ instructions: ['old'] })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(original)
    const result = await opencodeAdapter.prepareSystemPrompt('new', '/tmp', '/worktree')
    vi.clearAllMocks()
    await result.cleanup()
    expect(mockWriteFileSync).toHaveBeenCalledWith(join('/worktree', 'opencode.jsonc'), original, 'utf-8')
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })

  it('with cwd (existing file, malformed JSON): overwrites with fresh instructions', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not valid json }{')
    await opencodeAdapter.prepareSystemPrompt('prompt', '/tmp', '/worktree')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/worktree', 'opencode.jsonc'),
      JSON.stringify({ instructions: ['prompt'] }, null, 2),
      'utf-8'
    )
  })
})

// ── opencodeAdapter.buildCommand — system prompt injection (T1987) ────────────

describe('opencodeAdapter.buildCommand — system prompt injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('system prompt content')
  })

  it('with .txt systemPromptFile: wraps content in <system-instructions> tags', () => {
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt', initialMessage: 'task' })
    const lastArg = spec.args[spec.args.length - 1]
    expect(lastArg).toContain('<system-instructions>')
    expect(lastArg).toContain('</system-instructions>')
    expect(lastArg).toContain('system prompt content')
  })

  it('with .txt systemPromptFile: combines system prompt and initialMessage', () => {
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt', initialMessage: 'do the task' })
    const lastArg = spec.args[spec.args.length - 1]
    expect(lastArg).toContain('system prompt content')
    expect(lastArg).toContain('do the task')
    expect(lastArg.indexOf('system prompt content')).toBeLessThan(lastArg.indexOf('do the task'))
  })

  it('with .txt systemPromptFile: calls readFileSync on the provided path', () => {
    opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/sp.txt', 'utf-8')
  })

  it('with .txt systemPromptFile and empty content: falls back to pushing initialMessage as-is', () => {
    mockReadFileSync.mockReturnValue('')
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt', initialMessage: 'hello' })
    expect(spec.args[spec.args.length - 1]).toBe('hello')
  })

  it('with .txt systemPromptFile, empty content and no initialMessage: pushes nothing', () => {
    mockReadFileSync.mockReturnValue('')
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: '/tmp/sp.txt' })
    // run, --format, json — no extra positional
    expect(spec.args.length).toBe(3)
  })

  it('with .jsonc systemPromptFile (worktree): pushes initialMessage as-is without reading file', () => {
    const spec = opencodeAdapter.buildCommand({
      systemPromptFile: join('/worktree', 'opencode.jsonc'),
      initialMessage: 'do the task',
    })
    expect(spec.args[spec.args.length - 1]).toBe('do the task')
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('with .jsonc systemPromptFile (worktree) and no initialMessage: pushes nothing', () => {
    const spec = opencodeAdapter.buildCommand({ systemPromptFile: join('/worktree', 'opencode.jsonc') })
    expect(spec.args.length).toBe(3)
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('with no systemPromptFile: behaves as before (pushes initialMessage directly)', () => {
    const spec = opencodeAdapter.buildCommand({ initialMessage: 'hello world' })
    expect(spec.args[spec.args.length - 1]).toBe('hello world')
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })
})

