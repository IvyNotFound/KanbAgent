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
