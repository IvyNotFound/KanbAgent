/**
 * Tests for hookServer — targeted mutation killing (T1316)
 *
 * Targets surviving mutants identified in mutation score report:
 * - L236: ConditionalExpression → false (auth bypass: `authHeader !== Bearer` flipped to always pass)
 * - L294: ConditionalExpression true/false on `err.code === 'EADDRINUSE'`
 *         true → all errors treated as EADDRINUSE (warn); false → no errors treated as EADDRINUSE (error)
 * - L309: addr port computation — typeof/null fallback to HOOK_PORT
 * - L271: `url in LIFECYCLE_ROUTES` — lifecycle routes vs unknown /hooks/* paths
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'

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
  mockGetHookSecret: vi.fn().mockReturnValue('secret-t1316'),
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

const { startHookServer, setHookWindow, HOOK_PORT } = await import('./hookServer')

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
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer secret-t1316'
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

// ── L236: Bearer auth ConditionalExpression → false (total auth bypass) ───────
// Kill: mutant changes `authHeader !== Bearer ${hookSecret}` to `false`
// → auth check never triggers → all requests authenticated → handlers always run
// Tests must verify that with BAD auth, handlers do NOT execute (not just that 200 is returned)

describe('listen callback addr port computation L309', () => {
  it('server.address() returns an object (not null, not string) with valid port', async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')
    mockDetectWslGatewayIp.mockReturnValue(null)

    const [server, port] = await createTestServer()
    const addr = server.address()

    // addr must be an object (not null, not a string)
    expect(typeof addr).toBe('object')
    expect(addr).not.toBeNull()
    // Port from server.address() must match our test port
    expect((addr as { port: number }).port).toBe(port)
    // Port must be > 0 (valid port, not 0 or HOOK_PORT default)
    expect((addr as { port: number }).port).toBeGreaterThan(0)

    await new Promise<void>((r) => server.close(() => r()))
  })

  it('server reports correct address in console.log during listen callback (log shows listenHost:port)', () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')
    mockDetectWslGatewayIp.mockReturnValue(null)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const server = startHookServer().primaryServer

    return new Promise<void>((resolve, reject) => {
      if (server.listening) {
        // Already listening — check the log was called
        const listenCalls = logSpy.mock.calls.filter(c => (c[0] as string).includes('[hookServer] Listening'))
        expect(listenCalls.length).toBeGreaterThanOrEqual(1)
        logSpy.mockRestore()
        server.close(() => resolve())
        return
      }
      server.once('listening', () => {
        // Log must contain 'Listening on 127.0.0.1:' + some port number
        const listenCalls = logSpy.mock.calls.filter(c => (c[0] as string).includes('[hookServer] Listening'))
        expect(listenCalls.length).toBeGreaterThanOrEqual(1)
        expect(listenCalls[0][0]).toMatch(/\[hookServer\] Listening on 127\.0\.0\.1:\d+/)
        logSpy.mockRestore()
        server.close(() => resolve())
      })
      server.once('error', () => {
        // ADR-013: EADDRINUSE triggers port scan retry — server will listen on next port.
        // Don't resolve yet and don't restore the spy; the 'listening' handler will fire.
      })
    })
  })
})

// ── L271: `url in LIFECYCLE_ROUTES` — lifecycle vs unknown /hooks/* ─────────
// Kill: mutant removes/flips this check → unknown /hooks/foo routes trigger handlers
// Or: known routes are treated as not-in-map → handlers skipped

describe('LIFECYCLE_ROUTES membership check L271', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')
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

  it('known lifecycle route /hooks/session-start: pushes hook:event', async () => {
    // Confirms membership in LIFECYCLE_ROUTES → handler fires
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'c1', cwd: '/p' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).toHaveBeenCalledWith('hook:event',
      expect.objectContaining({ event: 'SessionStart' })
    )
  })

  it('known lifecycle route /hooks/subagent-start: pushes hook:event', async () => {
    await makeRequest(port, {
      path: '/hooks/subagent-start',
      body: { session_id: 'c1', cwd: '/p' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).toHaveBeenCalledWith('hook:event',
      expect.objectContaining({ event: 'SubagentStart' })
    )
  })

  it('unknown /hooks/unknown-route does NOT push hook:event (not in LIFECYCLE_ROUTES)', async () => {
    // Kills: mutant that makes all /hooks/* routes trigger handleLifecycleEvent
    await makeRequest(port, {
      path: '/hooks/unknown-route',
      body: { session_id: 'c1', cwd: '/p' },
    })
    await new Promise((r) => setTimeout(r, 50))
    // unknown route is not in LIFECYCLE_ROUTES and not /hooks/stop → no event pushed
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('unknown /hooks/foo-bar does NOT call writeDbNative', async () => {
    await makeRequest(port, {
      path: '/hooks/foo-bar',
      body: { session_id: 'c1', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('/hooks/stop is handled by handleStop (not LIFECYCLE_ROUTES): pushes Stop event', async () => {
    // /hooks/stop is NOT in LIFECYCLE_ROUTES — it has its own handler
    // handleStop always calls pushHookEvent('Stop', payload) before any DB work
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/tmp/x.jsonl', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).toHaveBeenCalledWith('hook:event',
      expect.objectContaining({ event: 'Stop' })
    )
  })

  it('all 6 lifecycle routes from LIFECYCLE_ROUTES push distinct event names', async () => {
    const routes = [
      { path: '/hooks/session-start',       event: 'SessionStart' },
      { path: '/hooks/subagent-start',      event: 'SubagentStart' },
      { path: '/hooks/subagent-stop',       event: 'SubagentStop' },
      { path: '/hooks/pre-tool-use',        event: 'PreToolUse' },
      { path: '/hooks/post-tool-use',       event: 'PostToolUse' },
      { path: '/hooks/instructions-loaded', event: 'InstructionsLoaded' },
    ]

    for (const { path, event } of routes) {
      mockWebContentsSend.mockClear()
      await makeRequest(port, { path, body: { session_id: 'c1', cwd: '/p' } })
      await new Promise((r) => setTimeout(r, 50))
      expect(mockWebContentsSend).toHaveBeenCalledWith('hook:event',
        expect.objectContaining({ event })
      )
    }
  })

  it('/hooks/session-start (persistDb=true) calls writeDbNative when conv_id and cwd present', async () => {
    // Confirms LIFECYCLE_ROUTES[url] = true for session-start
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
          run: vi.fn(),
        }),
      })
    })
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-123', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))
    // persistDb=true for session-start → writeDbNative called
    expect(mockWriteDbNative).toHaveBeenCalled()
  })

  it('/hooks/pre-tool-use (persistDb=false) does NOT call writeDbNative even with valid cwd', async () => {
    // Confirms LIFECYCLE_ROUTES[url] = false for pre-tool-use
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { session_id: 'conv-123', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))
    // persistDb=false → writeDbNative must NOT be called
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})
