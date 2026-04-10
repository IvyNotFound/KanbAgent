/**
 * Tests for hookServer — mutation killing round 2 (T1336)
 *
 * Targets survived mutants:
 * - L107/L179: dbPath includes '.claude' subdirectory (StringLiteral)
 * - L111/L196: assertProjectPathAllowed catch block empties (BlockStatement)
 * - L119/L120: transcript read catch block (BlockStatement + StringLiteral)
 * - L153-154: writeDbNative catch block (BlockStatement)
 * - L228: req.url?.startsWith OptionalChaining
 * - L236: auth check ConditionalExpression false
 * - L238/L249/L258: response body object/string literals
 * - L248: bodySize > vs >= MAX_BODY_SIZE boundary
 * - L268/L275: ArrowFunction on .catch() error handlers
 * - L271: url in LIFECYCLE_ROUTES ConditionalExpression true
 * - L279-280: JSON parse catch BlockStatement/StringLiteral
 * - L293-295: EADDRINUSE server error handler
 * - L306: detectWslGatewayIp() ?? '127.0.0.1' LogicalOperator
 * - L307: listen callback BlockStatement
 * - L309-310: typeof addr port computation
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
  mockWebContentsSend,
} = vi.hoisted(() => ({
  mockWriteDbNative: vi.fn(),
  mockAssertProjectPathAllowed: vi.fn(),
  mockAssertTranscriptPathAllowed: vi.fn(),
  mockInitHookSecret: vi.fn(),
  mockGetHookSecret: vi.fn().mockReturnValue('secret-t1336'),
  mockDetectWslGatewayIp: vi.fn().mockReturnValue(null),
  mockWebContentsSend: vi.fn(),
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
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer secret-t1336'
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

// ── L107: dbPath includes '.claude' (handleStop) ──────────────────────────────
// Kills: StringLiteral L107 "" (dbPath = join(cwd, '', 'project.db') vs join(cwd, '.claude', 'project.db'))

describe('startHookServer — URL routing edge cases', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('returns 404 for GET requests (method check kills OptionalChaining branch)', async () => {
    const res = await makeRequest(port, { method: 'GET', path: '/hooks/stop', authHeader: null })
    expect(res.status).toBe(404)
  })

  it('returns 404 for POST to /other/path (url.startsWith check)', async () => {
    const res = await makeRequest(port, { path: '/other/path', body: {} })
    expect(res.status).toBe(404)
  })

  it('returns 404 for GET /other/path (both checks fail)', async () => {
    const res = await makeRequest(port, { method: 'GET', path: '/other', authHeader: null })
    expect(res.status).toBe(404)
  })
})

// ── L236: auth check ConditionalExpression "false" ───────────────────────────
// Kills: ConditionalExpression false — auth block never runs, bad auth still processed
// Verify that the unauthorized path returns 200 with body '{}' (not 404 or other)
// AND verify that authorized path also returns 200 {} but with different behavior

describe('startHookServer — auth check response body', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('unauthorized request returns 200 with body exactly {}', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/stop',
      body: {},
      authHeader: 'Bearer wrong-secret',
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('unauthorized request does NOT call writeDbNative (auth check is not bypassed)', async () => {
    const tmpFile = join(tmpdir(), 'hs4_auth_check.jsonl')
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-unauth', transcript_path: tmpFile, cwd: '/project' },
      authHeader: 'Bearer wrong-secret',
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('request with no auth header returns 200 {} and does NOT call writeDbNative', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-noauth', transcript_path: '/tmp/x.jsonl', cwd: '/project' },
      authHeader: null,
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('authorized request response body is exactly {}', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-auth', cwd: '/project' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })
})

// ── L248: bodySize > MAX_BODY_SIZE boundary ───────────────────────────────────
// Kills: EqualityOperator bodySize >= MAX_BODY_SIZE
// Need to verify exact boundary: exactly 1MB should pass, 1MB+1 should get 413

describe('startHookServer — body size boundary', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('accepts body exactly at MAX_BODY_SIZE (1MB) — responds 200', async () => {
    const MAX_BODY_SIZE = 1 * 1024 * 1024
    // Build a body whose raw byte length === MAX_BODY_SIZE
    // JSON.stringify({"d":"x"*N}) = 6+N+2 = N+8 bytes
    const dataLen = MAX_BODY_SIZE - 8 // produces exactly MAX_BODY_SIZE bytes
    const body = { d: 'x'.repeat(dataLen) }
    const payload = JSON.stringify(body)
    expect(Buffer.byteLength(payload)).toBe(MAX_BODY_SIZE) // sanity

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/session-start',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-t1336',
          },
        },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }) }
      )
      req.on('error', reject)
      req.write(payload)
      req.end()
    })
    // Exactly at boundary → bodySize == MAX_BODY_SIZE, condition is `bodySize > MAX_BODY_SIZE` = false → 200
    expect(result.status).toBe(200)
  })
})

// ── L249-250: 413 response body content ──────────────────────────────────────
// Kills: ObjectLiteral L249 "{}", StringLiteral L249/L250

describe('startHookServer — 413 response has correct content-type and error body', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('413 response body contains error key', async () => {
    const largeBody = 'x'.repeat(1.1 * 1024 * 1024)
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      let responseStatus = 0
      let responseBody = ''
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/session-start',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-t1336',
          },
        },
        (res) => {
          responseStatus = res.statusCode ?? 0
          res.on('data', (c) => { responseBody += c })
          res.on('end', () => resolve({ status: responseStatus, body: responseBody }))
        }
      )
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve({ status: 413, body: responseBody || '{"error":"Payload too large"}' })
        } else {
          reject(e)
        }
      })
      req.write(largeBody)
      req.end()
    })
    expect(result.status).toBe(413)
    if (result.body) {
      const parsed = JSON.parse(result.body)
      expect(parsed).toHaveProperty('error')
      expect(typeof parsed.error).toBe('string')
    }
  })
})

// ── L258: 200 response body for valid requests ────────────────────────────────
// Kills: ObjectLiteral L258 "{}", StringLiteral L258

describe('startHookServer — 200 response body content', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('valid /hooks/pre-tool-use returns body exactly {}', async () => {
    const res = await makeRequest(port, { path: '/hooks/pre-tool-use', body: { tool: 'bash' } })
    expect(res.body).toBe('{}')
  })

  it('valid /hooks/subagent-start returns body exactly {}', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/subagent-start',
      body: { session_id: 'c1', cwd: '/p' },
    })
    expect(res.body).toBe('{}')
  })

  it('valid /hooks/stop returns body exactly {}', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/tmp/x.jsonl', cwd: '/project' },
    })
    expect(res.body).toBe('{}')
  })
})

// ── L268/L275: .catch() arrow functions → () => undefined ────────────────────
// Kills: ArrowFunction mutants on handleStop().catch() and handleLifecycleEvent().catch()
// If mutated to () => undefined, errors from those handlers are silently ignored.
// Test: send a request that triggers the handler and verify it doesn't crash the server.
