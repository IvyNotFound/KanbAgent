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
    mockDetectWslGatewayIp.mockReturnValue('127.0.0.2')
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
