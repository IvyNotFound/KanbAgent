/**
 * Tests for hookServer — mutation killing round 4 (T1336)
 *
 * Targets remaining survived mutants:
 * - L102: LogicalOperator — || vs && in guard condition
 * - L103: BooleanLiteral mutations in console.warn args (shape checks)
 * - L147/L151: SQL UPDATE string literals
 * - L228: OptionalChaining req.url?.startsWith
 * - L238/L249/L258: Response Content-Type header ObjectLiteral/StringLiteral
 * - L271: url in LIFECYCLE_ROUTES ConditionalExpression
 * - L309: typeof addr port computation (console.log spy)
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
  mockGetHookSecret: vi.fn().mockReturnValue('secret-t1336c'),
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

/** Make an HTTP request and return status + body + headers */
function makeRequestFull(
  port: number,
  opts: { method?: string; path: string; body?: unknown; authHeader?: string | null }
): Promise<{ status: number; body: string; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
    }
    if (opts.authHeader !== null) {
      headers['Authorization'] =
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer secret-t1336c'
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, path: opts.path, method: opts.method ?? 'POST', headers },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: data,
          headers: res.headers as Record<string, string | string[]>,
        }))
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

// ── L102: LogicalOperator guard condition ─────────────────────────────────────
// Kills: LogicalOperator L102 "!convId && !transcriptPath || !cwd"
// With mutation: sending {session_id: 'c1', cwd: '/p'} (no transcript_path) would NOT return early
// because !convId=false, so (!convId && !transcriptPath) = false, and !cwd=false → guard=false
// → function continues → parseTokensFromJSONLStream(undefined) → throw TypeError
// → catch block catches it → returns early → writeDbNative not called
// This is hard to distinguish from original behavior.
// Let's try: send with transcript_path present but missing session_id, cwd present.
// Original: !convId=true → true → returns early
// Mutant: !convId=true, !transcript_path=false → (true && false) = false → !cwd=false → guard=false
// → continues! → parseTokensFromJSONLStream(validFile) → tokens > 0 → tries assertProjectPathAllowed
// → writeDbNative IS called with mutation but NOT with original

describe('handleStop — guard condition covers each missing field independently (L102)', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs6_guard_logic.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336c')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('skips DB when session_id missing but transcript_path and cwd present (kills && mutation)', async () => {
    // session_id=absent, transcript_path=present, cwd=present
    // Original (||): !convId=true → returns early → writeDbNative NOT called
    // Mutant (&&): (!convId && !transcript_path) = (true && false)=false, !cwd=false → guard=false
    //   → continues → reads tokens from file → assertProjectPathAllowed → writeDbNative IS called
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequestFull(port, {
      path: '/hooks/stop',
      body: { transcript_path: tmpFile, cwd: '/project' },
      // no session_id
    })
    await new Promise((r) => setTimeout(r, 300))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── L103: BooleanLiteral in console.warn args ─────────────────────────────────
// Kills: BooleanLiteral !convId → convId, !transcriptPath → transcriptPath, etc.
// The console.warn call: console.warn('...', { convId: !!convId, transcriptPath: !!transcriptPath, cwd: !!cwd })
// With mutation BooleanLiteral "convId" (replacing !convId), the object has `convId: convId` (the raw value)
// instead of `convId: !!convId` (boolean). The value of convId when guard triggers is falsy (undefined/null).
// convId is undefined: !!convId = false; with mutation: convId value = undefined.
// So the object has convId: undefined vs convId: false.
// We can detect this by spying on console.warn and checking the arg is boolean.

describe('handleStop — console.warn args are booleans for missing field diagnostics', () => {
  let server: http.Server
  let port: number
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336c')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('console.warn diagnostic arg has boolean values (not raw undefined values)', async () => {
    // Send with all three fields missing
    await makeRequestFull(port, {
      path: '/hooks/stop',
      body: {},
    })
    await new Promise((r) => setTimeout(r, 100))

    const warnCalls = warnSpy.mock.calls
    const stopWarn = warnCalls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('missing required fields'))
    expect(stopWarn).toBeDefined()

    // The second arg is the diagnostic object: { convId: !!convId, transcriptPath: !!transcriptPath, cwd: !!cwd }
    const diagObj = stopWarn![1] as Record<string, unknown>
    expect(diagObj).toBeDefined()
    expect(typeof diagObj.convId).toBe('boolean')
    expect(typeof diagObj.transcriptPath).toBe('boolean')
    expect(typeof diagObj.cwd).toBe('boolean')
    // All missing → all false
    expect(diagObj.convId).toBe(false)
    expect(diagObj.transcriptPath).toBe(false)
    expect(diagObj.cwd).toBe(false)
  })

  it('console.warn diagnostic shows which fields are present (true) vs missing (false)', async () => {
    // Send with only session_id, missing transcript_path and cwd
    await makeRequestFull(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-1' },
    })
    await new Promise((r) => setTimeout(r, 100))

    const warnCalls = warnSpy.mock.calls
    const stopWarn = warnCalls.find(c => typeof c[0] === 'string' && (c[0] as string).includes('missing required fields'))
    expect(stopWarn).toBeDefined()

    const diagObj = stopWarn![1] as Record<string, unknown>
    expect(diagObj.convId).toBe(true)   // session_id present
    expect(diagObj.transcriptPath).toBe(false) // transcript_path missing
    expect(diagObj.cwd).toBe(false)      // cwd missing
  })
})

// ── L147/L151: SQL UPDATE string literals in handleStop ───────────────────────
// Kills: StringLiteral L147 "" and template L151 ""
// Need to verify that db.prepare is called with the correct UPDATE SQL containing
// the actual column names (not "" or modified strings)

describe('handleStop — UPDATE SQL string content verification', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs6_sql_update.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336c')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('db.prepare receives UPDATE SQL with tokens_cache_read and tokens_cache_write columns', async () => {
    writeFileSync(tmpFile, makeTranscript(300, 120))

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequestFull(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-sql-up', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedCb).not.toBeNull()

    const preparedSqls: string[] = []
    const mockDb = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        preparedSqls.push(sql)
        return { get: vi.fn().mockReturnValue({ id: 55 }), run: vi.fn() }
      }),
    }
    capturedCb!(mockDb)

    // L147 UPDATE SQL must contain these specific column names
    const tokenUpdateSql = preparedSqls.find(s => s.includes('tokens_in'))
    expect(tokenUpdateSql).toBeDefined()
    expect(tokenUpdateSql!.length).toBeGreaterThan(10)
    expect(tokenUpdateSql).toContain('tokens_in')
    expect(tokenUpdateSql).toContain('tokens_out')
    expect(tokenUpdateSql).toContain('tokens_cache_read')
    expect(tokenUpdateSql).toContain('tokens_cache_write')
    expect(tokenUpdateSql).toContain('UPDATE sessions SET')
  })

  it('console.log is called with session summary after successful DB update', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    let capturedCb: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCb = cb
    })

    await makeRequestFull(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-log', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    if (capturedCb) {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ id: 42 }), run: vi.fn() }),
      }
      capturedCb!(mockDb)
    }

    // L151: console.log(`[hookServer] session ${sessionId}: in=...`)
    const logCalls = logSpy.mock.calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('session'))
    expect(logCalls.length).toBeGreaterThan(0)
    expect((logCalls[0][0] as string).length).toBeGreaterThan(10)
    expect(logCalls[0][0]).toMatch(/session \d+:/)

    logSpy.mockRestore()
  })
})

// ── L228: OptionalChaining req.url?.startsWith ────────────────────────────────
// Kills: OptionalChaining → req.url.startsWith
// req.url is always set in HTTP/1.1 requests (default '/').
// However, we can verify that the startsWith check is what filters non-hooks paths.

describe('startHookServer — URL startsWith check filters non-hook paths', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336c')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('path /hookssomething (no slash after) returns 404 — startsWith not prefix match', async () => {
    // '/hookssomething'.startsWith('/hooks/') = false → 404
    const res = await makeRequestFull(port, { path: '/hookssomething', body: {}, authHeader: null })
    expect(res.status).toBe(404)
  })

  it('path exactly /hooks/ (empty event name) returns 200 (starts with /hooks/)', async () => {
    // '/hooks/'.startsWith('/hooks/') = true → processed (even if no matching handler)
    const res = await makeRequestFull(port, { path: '/hooks/', body: {} })
    expect(res.status).toBe(200)
  })
})

// ── L238/L249/L258: Response Content-Type header ──────────────────────────────
// Kills: ObjectLiteral L238 "{}", StringLiteral L238 "" — Content-Type header for auth failure
// Kills: ObjectLiteral L249/L258 "{}", StringLiteral L249/L258 "" — Content-Type for 200/413 responses
