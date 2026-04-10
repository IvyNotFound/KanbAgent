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

describe('handleStop — dbPath uses .claude subdirectory', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs4_dbpath.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('assertProjectPathAllowed is called with cwd before dbPath construction', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-1', transcript_path: tmpFile, cwd: '/my/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(mockAssertProjectPathAllowed).toHaveBeenCalledWith('/my/project')
  })

  it('writeDbNative is called with path containing .claude/project.db', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-2', transcript_path: tmpFile, cwd: '/my/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(mockWriteDbNative).toHaveBeenCalledWith(
      expect.stringContaining(join('.claude', 'project.db')),
      expect.any(Function)
    )
  })
})

// ── L111: assertProjectPathAllowed catch returns early (handleStop) ────────────────
// Kills: BlockStatement L111 "{}" — catch block emptied means assertProjectPathAllowed rejection doesn't stop the flow

describe('handleStop — catch block for assertProjectPathAllowed prevents DB write', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs4_assert_catch.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('returns early (no DB write) when assertProjectPathAllowed throws', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-blocked', transcript_path: tmpFile, cwd: '/evil' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // Both writeDbNative and parseTokensFromJSONLStream are skipped when path is blocked
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── L119-120: transcript parse error catch block (handleStop) ─────────────────
// Kills: BlockStatement L119 "{}" and StringLiteral L120 ""
// If block is empty, the function continues without tokens → tries to call writeDbNative with undefined tokens

describe('handleStop — transcript read error catch block prevents DB write', () => {
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

  it('skips writeDbNative when transcript file does not exist (read error)', async () => {
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-notf', transcript_path: '/nonexistent/transcript.jsonl', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // parseTokensFromJSONLStream throws ENOENT → catch block returns early → no DB write
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('server remains alive after transcript read error', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-err', transcript_path: '/missing/file.jsonl', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const health = await makeRequest(port, { path: '/hooks/session-start', body: {} })
    expect(health.status).toBe(200)
  })
})

// ── L153-154: writeDbNative catch block (handleStop) ─────────────────────────
// Kills: BlockStatement L153 "{}" — if empty, errors propagate and crash the async handler

describe('handleStop — writeDbNative error catch block keeps server alive', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hs4_writedb_catch.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('server remains alive after writeDbNative throws', async () => {
    writeFileSync(tmpFile, makeTranscript(100, 50))
    mockWriteDbNative.mockRejectedValue(new Error('DB failed'))

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-dberr', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    const health = await makeRequest(port, { path: '/hooks/session-start', body: {} })
    expect(health.status).toBe(200)
  })
})

// ── L179: dbPath in handleLifecycleEvent includes '.claude' ──────────────────
// Kills: StringLiteral L179 "" (dbPath = join(cwd, '', 'project.db') not '.claude')

describe('handleLifecycleEvent — dbPath uses .claude subdirectory', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1336')
    mockWriteDbNative.mockResolvedValue(undefined)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('assertProjectPathAllowed called with cwd for session-start', async () => {
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-lc1', cwd: '/my/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(mockAssertProjectPathAllowed).toHaveBeenCalledWith('/my/project')
  })

  it('writeDbNative called with .claude/project.db path for subagent-start', async () => {
    await makeRequest(port, {
      path: '/hooks/subagent-start',
      body: { session_id: 'conv-lc2', cwd: '/my/project' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(mockWriteDbNative).toHaveBeenCalledWith(
      expect.stringContaining(join('.claude', 'project.db')),
      expect.any(Function)
    )
  })
})

// ── L196: handleLifecycleEvent assertProjectPathAllowed catch block ────────────────
// Kills: BlockStatement L196 "{}" — empty catch means blocked path still writes to DB

describe('handleLifecycleEvent — assertProjectPathAllowed catch prevents DB write', () => {
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

  it('skips writeDbNative when path is blocked for session-start', async () => {
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })

    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-evil', cwd: '/evil/path' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('skips writeDbNative when path is blocked for subagent-stop', async () => {
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })

    await makeRequest(port, {
      path: '/hooks/subagent-stop',
      body: { session_id: 'conv-blocked', cwd: '/evil/path' },
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── L228: OptionalChaining req.url?.startsWith ────────────────────────────────
// Kills: OptionalChaining → req.url.startsWith (crashes if url is null)
// This is tricky to test since req.url is always set in http.IncomingMessage.
// We can verify the negative case: requests to non-/hooks/ paths get 404.
