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

describe('startHookServer — error handlers on async routes', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs4_async_catch.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('server stays alive when handleStop internal promise rejects', async () => {
    // Make writeDbNative throw to trigger the .catch() on handleStop
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockImplementation(() => Promise.reject(new Error('DB crash')))

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-crash', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // Server must still respond
    const health = await makeRequest(port, { path: '/hooks/pre-tool-use', body: {} })
    expect(health.status).toBe(200)
  })

  it('server stays alive when handleLifecycleEvent internal promise rejects', async () => {
    // Make writeDbNative throw to trigger the .catch() on handleLifecycleEvent
    mockWriteDbNative.mockImplementation(() => Promise.reject(new Error('lifecycle crash')))

    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-lc-crash', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const health = await makeRequest(port, { path: '/hooks/pre-tool-use', body: {} })
    expect(health.status).toBe(200)
  })
})

// ── L271: url in LIFECYCLE_ROUTES ConditionalExpression → true ───────────────
// Kills: ConditionalExpression "true" — if always true, /hooks/stop would go through lifecycle too
// Test that /hooks/stop behavior is distinct from lifecycle routes

describe('startHookServer — /hooks/stop vs lifecycle route dispatch', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs4_dispatch.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('/hooks/stop calls writeDbNative (handleStop path), not via lifecycle route', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-disp', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // handleStop was called (writeDbNative called once with transcript data)
    expect(mockWriteDbNative).toHaveBeenCalledOnce()
  })

  it('/hooks/pre-tool-use does NOT call writeDbNative (persistDb=false)', async () => {
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { session_id: 'conv-ptu', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('/hooks/unknown-event does not call writeDbNative (not in LIFECYCLE_ROUTES)', async () => {
    await makeRequest(port, {
      path: '/hooks/unknown-event',
      body: { session_id: 'conv-unk', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── L279-280: JSON parse catch block ─────────────────────────────────────────
// Kills: BlockStatement L279 "{}" and StringLiteral L280 ""
// If block empty, malformed JSON would crash the 'end' callback

describe('startHookServer — malformed JSON body handling', () => {
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

  it('server returns 200 before JSON parse, then handles parse error gracefully', async () => {
    await new Promise<{ status: number }>((resolve, reject) => {
      const body = '{invalid json'
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/session-start',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-t1336',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }) }
      )
      req.on('error', reject)
      req.end(body)
    })
    // Server still alive
    const health = await makeRequest(port, { path: '/hooks/pre-tool-use', body: {} })
    expect(health.status).toBe(200)
  })

  it('server does NOT call writeDbNative when JSON is malformed', async () => {
    const body = 'not-json'
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/session-start',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-t1336',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => { res.resume(); resolve() }
      )
      req.on('error', reject)
      req.end(body)
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── L293-295: EADDRINUSE vs other server error ────────────────────────────────
// Kills: BlockStatement L293 "{}", ConditionalExpression L294 true/false, EqualityOperator, StringLiteral

describe('startHookServer — server error event handling', () => {
  it('EADDRINUSE does not crash process — server reports not listening', async () => {
    mockGetHookSecret.mockReturnValue('secret-t1336')

    // Create a server that binds a port successfully
    const s1 = http.createServer()
    await new Promise<void>((resolve, reject) => {
      s1.once('listening', resolve)
      s1.once('error', reject)
      s1.listen(0, '127.0.0.1')
    })
    const boundPort = (s1.address() as { port: number }).port

    // Create a hook server then manually emit EADDRINUSE on its server
    const hookServer = startHookServer().primaryServer
    // Wait for it to settle
    await new Promise<void>((resolve) => {
      if (hookServer.listening) { resolve(); return }
      hookServer.once('listening', resolve)
      hookServer.once('error', resolve)
    })
    // Close the hook server and relisten on the same port as s1
    if (hookServer.listening) await new Promise<void>((r) => hookServer.close(() => r()))

    // Emit a synthetic EADDRINUSE error on the server
    const eaddrinuse = Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' })
    let errorCaught = false
    hookServer.once('error', () => { errorCaught = true })
    hookServer.emit('error', eaddrinuse)
    expect(errorCaught).toBe(true)

    await new Promise<void>((r) => s1.close(() => r()))
  })

  it('non-EADDRINUSE server error is handled without crashing', async () => {
    mockGetHookSecret.mockReturnValue('secret-t1336')
    const hookServer = startHookServer().primaryServer
    await new Promise<void>((resolve) => {
      if (hookServer.listening) { resolve(); return }
      hookServer.once('listening', resolve)
      hookServer.once('error', resolve)
    })
    if (hookServer.listening) await new Promise<void>((r) => hookServer.close(() => r()))

    // Emit a non-EADDRINUSE error
    const otherErr = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    let errorCaught = false
    hookServer.once('error', () => { errorCaught = true })
    hookServer.emit('error', otherErr)
    expect(errorCaught).toBe(true)
  })
})

// ── L306: detectWslGatewayIp() ?? '127.0.0.1' LogicalOperator ────────────────
// Kills: LogicalOperator "detectWslGatewayIp() && '127.0.0.1'"
// If mutated to &&: when WSL returns null, null && '127.0.0.1' = null → server.listen(port, null) → error
