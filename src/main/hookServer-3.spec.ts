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
