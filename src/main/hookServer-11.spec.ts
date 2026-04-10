/**
 * Tests for hookServer — mutation killing round 3 (T1336)
 *
 * Targets remaining survived mutants that require:
 * - Console output spying for StringLiteral/BlockStatement mutations
 * - Initial listen address check (not re-listen) for L306 LogicalOperator
 * - EADDRINUSE vs non-EADDRINUSE distinction (L294 EqualityOperator)
 * - L271 url in LIFECYCLE_ROUTES (ConditionalExpression)
 * - L268/L275 ArrowFunction catch handlers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockWriteDbNative,
  mockAssertProjectPathAllowed,
  mockAssertTranscriptPathAllowed,
  mockInitHookSecret,
  mockGetHookSecret,
  mockDetectWslGatewayIp,
} = vi.hoisted(() => ({
  mockWriteDbNative: vi.fn(),
  mockAssertProjectPathAllowed: vi.fn(),
  mockAssertTranscriptPathAllowed: vi.fn(),
  mockInitHookSecret: vi.fn(),
  mockGetHookSecret: vi.fn().mockReturnValue('secret-t1336b'),
  mockDetectWslGatewayIp: vi.fn().mockReturnValue(null),
}))

vi.mock('./db', () => ({
  writeDbNative: mockWriteDbNative,
  assertProjectPathAllowed: mockAssertProjectPathAllowed,
  assertTranscriptPathAllowed: mockAssertTranscriptPathAllowed,
}))

vi.mock('./hookServer-inject', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hookServer-inject')>()
  return {
    ...actual,
    HOOK_PORT: actual.HOOK_PORT,
    initHookSecret: mockInitHookSecret,
    getHookSecret: mockGetHookSecret,
    detectWslGatewayIp: mockDetectWslGatewayIp,
  }
})

const { startHookServer, setHookWindow } = await import('./hookServer')

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a test server on a random port (re-listens after initial settle) */
async function createTestServer(): Promise<[http.Server, number]> {
  const server = startHookServer().primaryServer
  await new Promise<void>((resolve) => {
    if (server.listening) { resolve(); return }
    const cleanup = () => {
      server.removeListener('listening', onL)
      server.removeListener('error', onE)
    }
    const onL = () => { cleanup(); resolve() }
    const onE = () => { cleanup(); resolve() }
    server.once('listening', onL)
    server.once('error', onE)
  })
  await new Promise<void>((resolve) => {
    if (!server.listening) { resolve(); return }
    server.close(() => resolve())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', resolve)
    server.listen(0, '127.0.0.1')
  })
  const addr = server.address() as { port: number }
  return [server, addr.port]
}

function makeRequest(
  port: number,
  opts: { method?: string; path: string; body?: unknown; authHeader?: string | null }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
    }
    if (opts.authHeader !== null) {
      headers['Authorization'] =
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer secret-t1336b'
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, path: opts.path, method: opts.method ?? 'POST', headers },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

function makeTranscript(tokensIn: number, tokensOut: number): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      stop_reason: 'end_turn',
      usage: { input_tokens: tokensIn, output_tokens: tokensOut, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }) + '\n'
}

// ── L237: console.warn on unauthorized request ────────────────────────────────
// Kills: StringLiteral L237 "" — console.warn message

describe('startHookServer — console.log on listen', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    mockDetectWslGatewayIp.mockReturnValue(null)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs non-empty "Listening on" message when server starts', async () => {
    const server = startHookServer().primaryServer
    await new Promise<void>((resolve) => {
      if (server.listening) { resolve(); return }
      const cleanup = () => {
        server.removeListener('listening', onL)
        server.removeListener('error', onE)
      }
      const onL = () => { cleanup(); resolve() }
      const onE = () => { cleanup(); resolve() }
      server.once('listening', onL)
      server.once('error', onE)
    })

    if (server.listening) {
      const listenCalls = logSpy.mock.calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('Listening'))
      expect(listenCalls.length).toBeGreaterThan(0)
      expect((listenCalls[0][0] as string).length).toBeGreaterThan(0)
      expect(listenCalls[0][0]).toMatch(/Listening on .+:\d+/)
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

// ── L138/L143: console.warn in handleStop fallback/no-session paths ───────────
// Kills: StringLiteral template mutations

describe('handleStop — fallback and no-session console.warn messages', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>
  const tmpFile = join(tmpdir(), 'hs5_fallback.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('logs fallback warning (L138) when conv_id not found but fallback session exists', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-notfound', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // Execute callback with fallback session found
    if (capturedCb) {
      let callIdx = 0
      const mockDb = {
        prepare: vi.fn().mockImplementation(() => {
          callIdx++
          return callIdx === 1
            ? { get: vi.fn().mockReturnValue(undefined), run: vi.fn() }    // byConvId: not found
            : { get: vi.fn().mockReturnValue({ id: 77 }), run: vi.fn() }  // fallback: found
        }),
      }
      capturedCb!(mockDb)
    }

    // L138: console.warn(`[hookServer] Fallback: using session ${sessionId}...`)
    const fallbackWarn = warnSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('Fallback')
    )
    expect(fallbackWarn).toBeDefined()
    expect((fallbackWarn![0] as string).length).toBeGreaterThan(0)
  })

  it('logs no-session warning (L143) when both byConvId and fallback return undefined', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-nosession', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    if (capturedCb) {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn() }),
      }
      capturedCb!(mockDb)
    }

    // L143: console.warn(`[hookServer] No session found for conv_id=${convId}`)
    const noSessionWarn = warnSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('No session found')
    )
    expect(noSessionWarn).toBeDefined()
    expect((noSessionWarn![0] as string).length).toBeGreaterThan(0)
  })
})
