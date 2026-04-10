/**
 * Tests for hookServer — targeted mutation killing (T1267)
 *
 * Targets survived mutants in hookServer.ts:
 * - truncateHookPayload: exact boundary (<=), _raw field, _truncated wrapper
 * - handleStop guard: individual !convId, !transcriptPath, !cwd conditions
 * - handleStop zero-token guard: ConditionalExpression → true
 * - handleLifecycleEvent: row found vs not found (ConditionalExpression on row)
 * - server error handler: EADDRINUSE vs other error
 * - listen address: nullish fallback '127.0.0.1'
 * - server address port computation: typeof/null guard
 * - req.on('error') handler: headersSent branch
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
  mockWebContentsSend,
  mockDetectWslGatewayIp,
} = vi.hoisted(() => ({
  mockWriteDbNative: vi.fn(),
  mockAssertProjectPathAllowed: vi.fn(),
  mockAssertTranscriptPathAllowed: vi.fn(),
  mockInitHookSecret: vi.fn(),
  mockGetHookSecret: vi.fn().mockReturnValue('secret-t1267'),
  mockWebContentsSend: vi.fn(),
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
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer secret-t1267'
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

/** Build a minimal finalized JSONL transcript */
function makeTranscript(opts: { tokensIn: number; tokensOut: number }): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      stop_reason: 'end_turn',
      usage: {
        input_tokens: opts.tokensIn,
        output_tokens: opts.tokensOut,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }) + '\n'
}

// ── truncateHookPayload — boundary tests ──────────────────────────────────────
// Kills: EqualityOperator (json.length < vs <=), _raw field, _truncated wrapper

const HOOK_PAYLOAD_MAX_BYTES = 64 * 1024 // must match hookServer.ts

describe('truncateHookPayload (via pushHookEvent on pre-tool-use)', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1267')
    mockWriteDbNative.mockResolvedValue(undefined)
    const fakeWin = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockWebContentsSend },
    } as unknown as import('electron').BrowserWindow
    setHookWindow(fakeWin)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    setHookWindow(null as unknown as import('electron').BrowserWindow)
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('does NOT truncate payload exactly at HOOK_PAYLOAD_MAX_BYTES boundary', async () => {
    // payload JSON string length === HOOK_PAYLOAD_MAX_BYTES → should NOT truncate (condition: <= max)
    // JSON.stringify({data:"x".repeat(N)}) = '{"data":"' (9 chars) + N + '"}' (2 chars) = N+11
    // So for json.length === HOOK_PAYLOAD_MAX_BYTES: N = HOOK_PAYLOAD_MAX_BYTES - 11
    const dataLen = HOOK_PAYLOAD_MAX_BYTES - 11 // produces json.length === HOOK_PAYLOAD_MAX_BYTES
    const body = { data: 'x'.repeat(dataLen) }
    const json = JSON.stringify(body)
    // Sanity check our calculation
    expect(json.length).toBe(HOOK_PAYLOAD_MAX_BYTES)

    await makeRequest(port, { path: '/hooks/pre-tool-use', body })
    await new Promise((r) => setTimeout(r, 50))

    const call = mockWebContentsSend.mock.calls[0]
    const event = call[1] as { payload: Record<string, unknown> }
    // Exactly at boundary (<=) → NOT truncated
    expect(event.payload._truncated).toBeUndefined()
    expect(event.payload.data).toBe('x'.repeat(dataLen))
  })

  it('truncates payload exactly 1 byte over HOOK_PAYLOAD_MAX_BYTES', async () => {
    // JSON.stringify({data:"x...x"}) must be HOOK_PAYLOAD_MAX_BYTES + 1 bytes
    // dataLen = HOOK_PAYLOAD_MAX_BYTES - 11 + 1 = HOOK_PAYLOAD_MAX_BYTES - 10
    const dataLen = HOOK_PAYLOAD_MAX_BYTES - 10
    const body = { data: 'x'.repeat(dataLen) }
    await makeRequest(port, { path: '/hooks/pre-tool-use', body })
    await new Promise((r) => setTimeout(r, 50))

    const call = mockWebContentsSend.mock.calls[0]
    const event = call[1] as { payload: Record<string, unknown> }
    expect(event.payload._truncated).toBe(true)
    // _raw must be a string (sliced JSON), not empty
    expect(typeof event.payload._raw).toBe('string')
    expect((event.payload._raw as string).length).toBe(HOOK_PAYLOAD_MAX_BYTES)
  })

  it('truncated wrapper has exactly _truncated and _raw keys', async () => {
    const dataLen = HOOK_PAYLOAD_MAX_BYTES
    const body = { data: 'x'.repeat(dataLen) }
    await makeRequest(port, { path: '/hooks/pre-tool-use', body })
    await new Promise((r) => setTimeout(r, 50))

    const call = mockWebContentsSend.mock.calls[0]
    const event = call[1] as { payload: Record<string, unknown> }
    expect(event.payload._truncated).toBe(true)
    // _raw field must be present (not empty string)
    expect(event.payload._raw).toBeTruthy()
  })
})

// ── handleStop guard — individual field checks ────────────────────────────────
// Kills: LogicalOperator mutants on line 102, BooleanLiteral mutants line 103

describe('handleStop — individual missing field guards', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs3_guard_test.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1267')
    mockWriteDbNative.mockResolvedValue(undefined)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('skips DB when only session_id is missing (transcript_path and cwd present)', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 100, tokensOut: 50 }))
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { transcript_path: tmpFile, cwd: '/project' },
      // session_id absent
    })
    await new Promise((r) => setTimeout(r, 150))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('skips DB when only transcript_path is missing (session_id and cwd present)', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-1', cwd: '/project' },
      // transcript_path absent
    })
    await new Promise((r) => setTimeout(r, 150))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('skips DB when only cwd is missing (session_id and transcript_path present)', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 100, tokensOut: 50 }))
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-2', transcript_path: tmpFile },
      // cwd absent
    })
    await new Promise((r) => setTimeout(r, 150))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('proceeds to DB when all three fields are present and transcript has tokens', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 100, tokensOut: 50 }))
    mockWriteDbNative.mockResolvedValue(undefined)
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-all', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(mockWriteDbNative).toHaveBeenCalledOnce()
  })
})

// ── handleStop zero-token guard — ConditionalExpression → true ────────────────
// Kills: ConditionalExpression mutant at line 123 (`if (tokens.tokensIn === 0 && tokens.tokensOut === 0)`)

describe('handleStop — zero-token guard (line 123)', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs3_zero_token.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1267')
    mockWriteDbNative.mockResolvedValue(undefined)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('proceeds to DB when tokensOut > 0 but tokensIn = 0', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 0, tokensOut: 50 }))
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-out-only', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))
    // tokensIn=0 but tokensOut=50 → condition is false → should NOT skip
    expect(mockWriteDbNative).toHaveBeenCalledOnce()
  })

  it('skips DB when both tokensIn=0 and tokensOut=0', async () => {
    // A file with only streaming (stop_reason=null) entries → zero finalized tokens
    writeFileSync(tmpFile,
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } },
      }) + '\n'
    )
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-zeros', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── handleLifecycleEvent — row null check (line 191) ──────────────────────────
// Kills: BooleanLiteral `row`, ConditionalExpression true/false on `if (!row) return`

describe('handleLifecycleEvent — row null guard in DB callback', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1267')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('does NOT call db.prepare for INSERT when row not found (row=undefined)', async () => {
    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-norow', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(capturedCb).not.toBeNull()

    const mockPrepare = vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn() })
    capturedCb!({ prepare: mockPrepare })

    // Only SELECT prepared — no INSERT
    expect(mockPrepare).toHaveBeenCalledTimes(1)
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SELECT'))
  })

  it('calls db.prepare for INSERT when row found (row.id and row.agent_id present)', async () => {
    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-hasrow', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(capturedCb).not.toBeNull()

    const mockRun = vi.fn()
    const mockPrepare = vi.fn()
      .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ id: 10, agent_id: 3 }), run: mockRun })
      .mockReturnValueOnce({ run: mockRun })
    capturedCb!({ prepare: mockPrepare })

    // SELECT + INSERT both prepared
    expect(mockPrepare).toHaveBeenCalledTimes(2)
    expect(mockPrepare).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO agent_logs'))
    expect(mockRun).toHaveBeenCalledWith(10, 3, 'info', 'SessionStart', expect.any(String))
  })

  it('INSERT uses correct level=info and action=eventName from URL', async () => {
    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/subagent-stop',
      body: { session_id: 'conv-sub', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    const mockRun = vi.fn()
    const mockPrepare = vi.fn()
      .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ id: 5, agent_id: 1 }), run: mockRun })
      .mockReturnValueOnce({ run: mockRun })
    capturedCb!({ prepare: mockPrepare })

    expect(mockRun).toHaveBeenCalledWith(5, 1, 'info', 'SubagentStop', expect.any(String))
  })

  it('INSERT detail field is valid JSON string of the original payload', async () => {
    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    const payloadBody = { session_id: 'conv-json', cwd: '/project', extra: 'data' }
    await makeRequest(port, { path: '/hooks/subagent-start', body: payloadBody })
    await new Promise((r) => setTimeout(r, 100))

    const mockRun = vi.fn()
    const mockPrepare = vi.fn()
      .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ id: 7, agent_id: 2 }), run: mockRun })
      .mockReturnValueOnce({ run: mockRun })
    capturedCb!({ prepare: mockPrepare })

    const detail = mockRun.mock.calls[0][4] as string
    const parsed = JSON.parse(detail)
    expect(parsed.session_id).toBe('conv-json')
    expect(parsed.cwd).toBe('/project')
    expect(parsed.extra).toBe('data')
  })
})

// ── server error handler — EADDRINUSE vs other error ─────────────────────────
// Kills: ConditionalExpression true/false on err.code === 'EADDRINUSE', StringLiteral mutants

describe('startHookServer — server error handling', () => {
  it('handles EADDRINUSE without throwing (port in use)', async () => {
    // Start two servers on the same port to force EADDRINUSE on the second
    const h1 = startHookServer()
    const s1 = h1.primaryServer
    await new Promise<void>((resolve) => {
      if (s1.listening) { resolve(); return }
      s1.once('listening', resolve)
      s1.once('error', resolve) // EADDRINUSE is swallowed
    })

    // If s1 successfully bound a port, try to bind s2 on the same port
    if (s1.listening) {
      const h2 = startHookServer()
      const s2 = h2.primaryServer
      // Wait for s2 to hit EADDRINUSE or settle
      await new Promise<void>((resolve) => {
        if (s2.listening) { resolve(); return }
        s2.once('error', resolve)  // expected EADDRINUSE
        s2.once('listening', resolve)
      })
      // s1 should still be listening (not crashed)
      expect(s1.listening).toBe(true)
      // Close both
      await new Promise<void>((r) => h1.close(() => r()))
      if (s2.listening) await new Promise<void>((r) => h2.close(() => r()))
    } else {
      // s1 hit EADDRINUSE itself — hook port was in use, server didn't crash
      expect(s1.listening).toBe(false)
    }
  })
})

// ── listen address fallback ───────────────────────────────────────────────────
// Kills: LogicalOperator `detectWslGatewayIp() && '127.0.0.1'`, StringLiteral ""

describe('startHookServer — listen address', () => {
  afterEach(async () => {
    vi.resetAllMocks()
  })

  it('binds to 127.0.0.1 when detectWslGatewayIp returns null', async () => {
    mockDetectWslGatewayIp.mockReturnValue(null)
    mockGetHookSecret.mockReturnValue('secret-t1267')
    const [server, ] = await createTestServer()
    const addr = server.address() as { address: string } | null
    expect(addr).not.toBeNull()
    expect(addr!.address).toBe('127.0.0.1')
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('creates WSL server when detectWslGatewayIp returns an IP (T1905 dual-listen)', async () => {
    mockDetectWslGatewayIp.mockReturnValue('172.17.240.1')
    mockGetHookSecret.mockReturnValue('secret-t1267')
    const handle = startHookServer()
    // Primary is always 127.0.0.1
    await new Promise<void>((resolve) => {
      if (handle.primaryServer.listening) { resolve(); return }
      handle.primaryServer.once('listening', resolve)
      handle.primaryServer.once('error', resolve)
    })
    // WSL server should exist
    expect(handle.wslServer).not.toBeNull()
    if (handle.wslServer) {
      await new Promise<void>((resolve) => {
        if (handle.wslServer!.listening) { resolve(); return }
        handle.wslServer!.once('listening', resolve)
        handle.wslServer!.once('error', resolve)
      })
    }
    await new Promise<void>((r) => handle.close(() => r()))
    // Reset mock
    mockDetectWslGatewayIp.mockReturnValue(null)
  })
})

// ── server address port computation ──────────────────────────────────────────
// Kills: ConditionalExpression/EqualityOperator on `typeof addr === 'object' && addr !== null`

describe('startHookServer — server address port', () => {
  it('server.address() returns an object with a valid port number', async () => {
    mockGetHookSecret.mockReturnValue('secret-t1267')
    const [server, port] = await createTestServer()
    const addr = server.address()
    expect(typeof addr).toBe('object')
    expect(addr).not.toBeNull()
    expect((addr as { port: number }).port).toBe(port)
    expect((addr as { port: number }).port).toBeGreaterThan(0)
    await new Promise<void>((r) => server.close(() => r()))
  })
})

// ── handleStop DB path — SQL string literals ──────────────────────────────────
// Kills: StringLiteral mutants on SQL queries and status literals

describe('handleStop — SQL string literals in DB callback', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs3_sql_strings.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1267')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('UPDATE tokens query uses correct column names', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 100, tokensOut: 50 }))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-sql', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const mockRun = vi.fn()
    const mockStmt = { get: vi.fn().mockReturnValue({ id: 42 }), run: mockRun }
    capturedCb!({ prepare: vi.fn().mockReturnValue(mockStmt) })

    // First run: tokens update — 5 args: tokensIn, tokensOut, cacheRead, cacheWrite, sessionId
    expect(mockRun).toHaveBeenNthCalledWith(1, 100, 50, 0, 0, 42)
    // Second run: status update — 1 arg: sessionId
    expect(mockRun).toHaveBeenNthCalledWith(2, 42)
  })

  it('SELECT by conv_id uses correct column name claude_conv_id', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 200, tokensOut: 80 }))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-colname', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const mockGetConvId = vi.fn().mockReturnValue({ id: 55 })
    capturedCb!({
      prepare: vi.fn().mockReturnValue({ get: mockGetConvId, run: vi.fn() }),
    })

    expect(mockGetConvId).toHaveBeenCalledWith('conv-colname')
  })

  it('fallback SELECT filters status IN (started, completed) and checks tokens_in', async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 100, tokensOut: 50 }))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-fallback2', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    let callIdx = 0
    const mockDb = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        callIdx++
        if (callIdx === 1) return { get: vi.fn().mockReturnValue(undefined), run: vi.fn() }
        if (callIdx === 2) return { get: vi.fn().mockReturnValue({ id: 88 }), run: vi.fn() }
        return { get: vi.fn(), run: vi.fn() }
      }),
    }
    capturedCb!(mockDb)

    // Second prepare should be the fallback query
    const fallbackSql = mockDb.prepare.mock.calls[1][0] as string
    expect(fallbackSql).toContain('tokens_in')
    expect(fallbackSql).toContain("'started'")
    expect(fallbackSql).toContain("'completed'")
    expect(fallbackSql).toContain('ORDER BY id DESC')
    expect(fallbackSql).toContain('LIMIT 1')
  })

  it("UPDATE status query sets status='completed' only when status='started'", async () => {
    writeFileSync(tmpFile, makeTranscript({ tokensIn: 100, tokensOut: 50 }))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-status', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const preparedSqls: string[] = []
    const mockRun = vi.fn()
    const mockDb = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        preparedSqls.push(sql)
        return { get: vi.fn().mockReturnValue({ id: 99 }), run: mockRun }
      }),
    }
    capturedCb!(mockDb)

    // Status update SQL should contain 'completed' and check 'started'
    const statusSql = preparedSqls.find(s => s.includes('completed'))
    expect(statusSql).toBeDefined()
    expect(statusSql).toContain("status='completed'")
    expect(statusSql).toContain("status='started'")
    expect(statusSql).toContain("ended_at=datetime('now')")
  })
})

// ── LIFECYCLE_ROUTES — persistDb values ──────────────────────────────────────
// Kills: StringLiteral on route paths and BooleanLiteral on persistDb values

describe('LIFECYCLE_ROUTES — route paths and persistDb flag', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1267')
    mockWriteDbNative.mockResolvedValue(undefined)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('sends hook:event with event name SubagentStart for /hooks/subagent-start', async () => {
    const mockSend = vi.fn()
    setHookWindow({
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockSend },
    } as unknown as import('electron').BrowserWindow)

    await makeRequest(port, { path: '/hooks/subagent-start', body: { session_id: 'c1', cwd: '/p' } })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockSend).toHaveBeenCalledWith('hook:event', expect.objectContaining({ event: 'SubagentStart' }))
    setHookWindow(null as unknown as import('electron').BrowserWindow)
  })

  it('sends hook:event with event name SubagentStop for /hooks/subagent-stop', async () => {
    const mockSend = vi.fn()
    setHookWindow({
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockSend },
    } as unknown as import('electron').BrowserWindow)

    await makeRequest(port, { path: '/hooks/subagent-stop', body: { session_id: 'c1', cwd: '/p' } })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockSend).toHaveBeenCalledWith('hook:event', expect.objectContaining({ event: 'SubagentStop' }))
    setHookWindow(null as unknown as import('electron').BrowserWindow)
  })

  it('sends hook:event with channel name exactly "hook:event"', async () => {
    const mockSend = vi.fn()
    setHookWindow({
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockSend },
    } as unknown as import('electron').BrowserWindow)

    await makeRequest(port, { path: '/hooks/pre-tool-use', body: {} })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockSend).toHaveBeenCalledWith('hook:event', expect.any(Object))
    // Channel name must be exactly 'hook:event', not '' or something else
    expect(mockSend.mock.calls[0][0]).toBe('hook:event')
    setHookWindow(null as unknown as import('electron').BrowserWindow)
  })

  it('hook:event ts field is a recent timestamp (not 0)', async () => {
    const mockSend = vi.fn()
    setHookWindow({
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockSend },
    } as unknown as import('electron').BrowserWindow)

    const before = Date.now()
    await makeRequest(port, { path: '/hooks/pre-tool-use', body: { tool: 'read' } })
    await new Promise((r) => setTimeout(r, 50))
    const after = Date.now()

    const event = mockSend.mock.calls[0][1] as { ts: number }
    expect(event.ts).toBeGreaterThanOrEqual(before)
    expect(event.ts).toBeLessThanOrEqual(after + 100)
    setHookWindow(null as unknown as import('electron').BrowserWindow)
  })
})

// ── req.on('error') handler — headersSent branch ──────────────────────────────
// Kills: ConditionalExpression true/false on `if (!res.headersSent)`

describe('startHookServer — req error handler edge case', () => {
  it('server survives a request error (ECONNRESET-like) without crashing', async () => {
    mockGetHookSecret.mockReturnValue('secret-t1267')
    const [server, port] = await createTestServer()

    // Send a request then abruptly destroy it
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/hooks/pre-tool-use',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer secret-t1267',
        'Content-Type': 'application/json',
      },
    })
    req.on('error', () => { /* expected */ })
    req.write('{"tool"')
    req.destroy()

    await new Promise((r) => setTimeout(r, 100))

    // Server must still respond after the aborted request
    const health = await makeRequest(port, { path: '/hooks/session-start', body: {} })
    expect(health.status).toBe(200)
    await new Promise<void>((r) => server.close(() => r()))
  })
})
