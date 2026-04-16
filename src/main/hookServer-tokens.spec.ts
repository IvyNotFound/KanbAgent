/**
 * Tests for hookServer-tokens.ts — parseTokensFromJSONL + parseTokensFromJSONLStream (T1948)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseTokensFromJSONL, parseTokensFromJSONLStream } from './hookServer-tokens'
import type { TokenCounts } from './hookServer-tokens'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAssistantLine(opts: {
  stopReason: string | null
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      stop_reason: opts.stopReason,
      usage: {
        input_tokens: opts.inputTokens ?? 0,
        output_tokens: opts.outputTokens ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
      },
    },
  })
}

const ZERO: TokenCounts = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }

// ── Mocks for parseTokensFromJSONLStream ──────────────────────────────────────

// We mock 'fs' and 'readline' so the stream-based function never touches disk.

const { mockCreateReadStream, mockCreateInterface } = vi.hoisted(() => ({
  mockCreateReadStream: vi.fn(),
  mockCreateInterface: vi.fn(),
}))

vi.mock('fs', () => ({
  default: { createReadStream: mockCreateReadStream },
  createReadStream: mockCreateReadStream,
}))

vi.mock('readline', () => ({
  default: { createInterface: mockCreateInterface },
  createInterface: mockCreateInterface,
}))

/**
 * Creates a fake readline EventEmitter that emits the provided lines then closes.
 * Returns a minimal object matching the EventEmitter interface used in the source.
 */
function fakeRl(lines: string[]): object {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}

  const on = (event: string, cb: (...args: unknown[]) => void) => {
    if (!handlers[event]) handlers[event] = []
    handlers[event].push(cb)
    return rl
  }

  const rl = { on }

  // Schedule emission asynchronously so callers can attach all handlers first.
  Promise.resolve().then(() => {
    for (const line of lines) {
      handlers['line']?.forEach((cb) => cb(line))
    }
    handlers['close']?.forEach((cb) => cb())
  })

  return rl
}

// ── parseTokensFromJSONL ──────────────────────────────────────────────────────

describe('parseTokensFromJSONL', () => {
  it('JSONL vide → retourne tous les compteurs à 0', () => {
    expect(parseTokensFromJSONL('')).toEqual(ZERO)
  })

  it('lignes vides uniquement → retourne 0', () => {
    expect(parseTokensFromJSONL('\n\n   \n')).toEqual(ZERO)
  })

  it('message assistant avec stop_reason non null → tokens comptabilisés', () => {
    const line = makeAssistantLine({ stopReason: 'end_turn', inputTokens: 100, outputTokens: 40 })
    expect(parseTokensFromJSONL(line)).toEqual({ tokensIn: 100, tokensOut: 40, cacheRead: 0, cacheWrite: 0 })
  })

  it('message assistant avec stop_reason null → ignoré', () => {
    const line = makeAssistantLine({ stopReason: null, inputTokens: 500, outputTokens: 1 })
    expect(parseTokensFromJSONL(line)).toEqual(ZERO)
  })

  it('plusieurs messages finalisés → tokens additionnés', () => {
    const content = [
      makeAssistantLine({ stopReason: 'tool_use', inputTokens: 100, outputTokens: 50 }),
      makeAssistantLine({ stopReason: 'end_turn', inputTokens: 200, outputTokens: 80, cacheRead: 30, cacheWrite: 10 }),
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 300, tokensOut: 130, cacheRead: 30, cacheWrite: 10 })
  })

  it('ligne malformée (non-JSON) → ignorée sans crash', () => {
    const content = ['not json at all', makeAssistantLine({ stopReason: 'end_turn', inputTokens: 10, outputTokens: 5 })].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 10, tokensOut: 5, cacheRead: 0, cacheWrite: 0 })
  })

  it('cache_read_input_tokens + cache_creation_input_tokens → cacheRead/cacheWrite corrects', () => {
    const line = makeAssistantLine({ stopReason: 'end_turn', cacheRead: 120, cacheWrite: 60 })
    const result = parseTokensFromJSONL(line)
    expect(result.cacheRead).toBe(120)
    expect(result.cacheWrite).toBe(60)
  })

  it('message sans champ usage → ignoré sans crash', () => {
    const line = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' } })
    expect(parseTokensFromJSONL(line)).toEqual(ZERO)
  })

  it('type différent de "assistant" → ignoré', () => {
    const content = [
      JSON.stringify({ type: 'user', message: { usage: { input_tokens: 99, output_tokens: 99 } } }),
      JSON.stringify({ type: 'tool_result', message: { stop_reason: 'end_turn', usage: { input_tokens: 99, output_tokens: 99 } } }),
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual(ZERO)
  })

  it('mélange entrées finalisées et intermédiaires → seules les finalisées comptent', () => {
    const content = [
      // intermédiaire — ignoré
      makeAssistantLine({ stopReason: null, inputTokens: 500, outputTokens: 1 }),
      // finalisé — compté
      makeAssistantLine({ stopReason: 'tool_use', inputTokens: 500, outputTokens: 150 }),
    ].join('\n')
    expect(parseTokensFromJSONL(content)).toEqual({ tokensIn: 500, tokensOut: 150, cacheRead: 0, cacheWrite: 0 })
  })
})

// ── parseTokensFromJSONLStream ────────────────────────────────────────────────

describe('parseTokensFromJSONLStream', () => {
  beforeEach(() => {
    mockCreateReadStream.mockReturnValue({})
  })

  it('JSONL vide (aucune ligne) → retourne tous les compteurs à 0', async () => {
    mockCreateInterface.mockReturnValue(fakeRl([]))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual(ZERO)
  })

  it('message assistant avec stop_reason non null → tokens comptabilisés', async () => {
    const line = makeAssistantLine({ stopReason: 'end_turn', inputTokens: 200, outputTokens: 80 })
    mockCreateInterface.mockReturnValue(fakeRl([line]))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual({
      tokensIn: 200,
      tokensOut: 80,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('message assistant avec stop_reason null → ignoré', async () => {
    const line = makeAssistantLine({ stopReason: null, inputTokens: 500, outputTokens: 1 })
    mockCreateInterface.mockReturnValue(fakeRl([line]))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual(ZERO)
  })

  it('plusieurs messages finalisés → tokens additionnés', async () => {
    const lines = [
      makeAssistantLine({ stopReason: 'tool_use', inputTokens: 100, outputTokens: 50 }),
      makeAssistantLine({ stopReason: 'end_turn', inputTokens: 200, outputTokens: 80, cacheRead: 30, cacheWrite: 10 }),
    ]
    mockCreateInterface.mockReturnValue(fakeRl(lines))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual({
      tokensIn: 300,
      tokensOut: 130,
      cacheRead: 30,
      cacheWrite: 10,
    })
  })

  it('ligne malformée (non-JSON) → ignorée sans crash', async () => {
    const lines = ['not json', makeAssistantLine({ stopReason: 'end_turn', inputTokens: 10, outputTokens: 5 })]
    mockCreateInterface.mockReturnValue(fakeRl(lines))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual({
      tokensIn: 10,
      tokensOut: 5,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('cache_read_input_tokens + cache_creation_input_tokens → cacheRead/cacheWrite corrects', async () => {
    const line = makeAssistantLine({ stopReason: 'end_turn', cacheRead: 100, cacheWrite: 50 })
    mockCreateInterface.mockReturnValue(fakeRl([line]))
    const result = await parseTokensFromJSONLStream('/fake/path')
    expect(result.cacheRead).toBe(100)
    expect(result.cacheWrite).toBe(50)
  })

  it('message sans champ usage → ignoré sans crash', async () => {
    const line = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' } })
    mockCreateInterface.mockReturnValue(fakeRl([line]))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual(ZERO)
  })

  it('type différent de "assistant" → ignoré', async () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { usage: { input_tokens: 99, output_tokens: 99 } } }),
      JSON.stringify({ type: 'system', message: { stop_reason: 'end_turn', usage: { input_tokens: 99, output_tokens: 99 } } }),
    ]
    mockCreateInterface.mockReturnValue(fakeRl(lines))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual(ZERO)
  })

  it('lignes vides → ignorées sans crash', async () => {
    const lines = ['', '   ', makeAssistantLine({ stopReason: 'end_turn', inputTokens: 5, outputTokens: 2 })]
    mockCreateInterface.mockReturnValue(fakeRl(lines))
    await expect(parseTokensFromJSONLStream('/fake/path')).resolves.toEqual({
      tokensIn: 5,
      tokensOut: 2,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('erreur sur le stream → promesse rejetée', async () => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    const fakeErrorRl = {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (!handlers[event]) handlers[event] = []
        handlers[event].push(cb)
        return fakeErrorRl
      },
    }
    Promise.resolve().then(() => {
      handlers['error']?.forEach((cb) => cb(new Error('stream error')))
    })
    mockCreateInterface.mockReturnValue(fakeErrorRl)
    await expect(parseTokensFromJSONLStream('/fake/path')).rejects.toThrow('stream error')
  })
})
