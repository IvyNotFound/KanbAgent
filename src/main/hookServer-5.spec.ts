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

describe('startHookServer — console.warn on unauthorized request', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('logs unauthorized access warning with non-empty message', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: {},
      authHeader: 'Bearer wrong',
    })
    // console.warn should have been called with a non-empty first argument
    const calls = warnSpy.mock.calls
    const authWarnCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('Unauthorized'))
    expect(authWarnCall).toBeDefined()
    expect((authWarnCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L280: console.warn on malformed JSON ──────────────────────────────────────
// Kills: StringLiteral L280 "" — console.warn message, BlockStatement L279 "{}"

describe('startHookServer — console.warn on malformed JSON payload', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('logs parse failure warning when body is malformed JSON', async () => {
    const body = '{bad json'
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/session-start',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-t1336b',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => { res.resume(); resolve() }
      )
      req.on('error', reject)
      req.end(body)
    })
    await new Promise((r) => setTimeout(r, 50))

    const calls = warnSpy.mock.calls
    const parseWarnCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('parse'))
    expect(parseWarnCall).toBeDefined()
    expect((parseWarnCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L120: console.warn on transcript read error ───────────────────────────────
// Kills: StringLiteral L120 "" — console.warn message
// Kills: BlockStatement L119 "{}" — if empty, function continues without return, uses undefined tokens

describe('handleStop — console.warn on transcript read error', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('logs transcript read error with non-empty message', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-1', transcript_path: '/nonexistent/path.jsonl', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const calls = warnSpy.mock.calls
    const readErrCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('transcript'))
    expect(readErrCall).toBeDefined()
    expect((readErrCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L112: console.warn on blocked path (handleStop) ──────────────────────────
// Kills: StringLiteral L112 "" — console.warn message

describe('handleStop — console.warn on blocked cwd path', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>
  const tmpFile = join(tmpdir(), 'hs5_blocked_warn.jsonl')

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

  it('logs non-empty warning when assertProjectPathAllowed throws in handleStop', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-b', transcript_path: tmpFile, cwd: '/evil' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const calls = warnSpy.mock.calls
    const blockWarnCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('allowlist'))
    expect(blockWarnCall).toBeDefined()
    expect((blockWarnCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L184: console.warn on blocked path (lifecycle) ───────────────────────────
// Kills: StringLiteral L184 "" — console.warn message

describe('handleLifecycleEvent — console.warn on blocked cwd path', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('logs non-empty warning when assertProjectPathAllowed throws in lifecycle handler', async () => {
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })

    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-b', cwd: '/evil/path' },
    })
    await new Promise((r) => setTimeout(r, 100))

    const calls = warnSpy.mock.calls
    const blockWarnCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('allowlist'))
    expect(blockWarnCall).toBeDefined()
    expect((blockWarnCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L154: console.error on writeDbNative failure (handleStop) ────────────────
// Kills: StringLiteral L154 "" — console.error message
// Kills: BlockStatement L153 "{}" — if empty, error propagates to L268 .catch()

describe('handleStop — console.error on writeDbNative failure', () => {
  let server: http.Server
  let port: number
  let errorSpy: ReturnType<typeof vi.spyOn>
  const tmpFile = join(tmpdir(), 'hs5_writedb_err.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    errorSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('logs writeDbNative failure via console.error with non-empty message', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockRejectedValue(new Error('DB write crash'))

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-dberr', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const calls = errorSpy.mock.calls
    const dbErrCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('writeDbNative'))
    expect(dbErrCall).toBeDefined()
    expect((dbErrCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L197: console.warn on lifecycle writeDbNative failure ────────────────────
// Kills: StringLiteral L197 "`" — template string
// Kills: BlockStatement L196 "{}" — if empty, error propagates to L275 .catch()

describe('handleLifecycleEvent — console.warn on writeDbNative failure', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336b')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('logs agent_logs insert failure with non-empty message', async () => {
    mockWriteDbNative.mockRejectedValue(new Error('agent_logs failed'))

    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-lc', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const calls = warnSpy.mock.calls
    const lcErrCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('agent_logs'))
    expect(lcErrCall).toBeDefined()
    expect((lcErrCall![0] as string).length).toBeGreaterThan(0)
  })
})

// ── L268/L275 ArrowFunction → () => undefined ─────────────────────────────────
// Kills: ArrowFunction mutations on .catch() handlers
// If mutated to () => undefined, the console.error is NOT called when handler throws.
// Test: verify that when handleStop/handleLifecycleEvent reject, console.error is called
// (which only happens via the .catch() arrow function).
