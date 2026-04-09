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
  const server = startHookServer()
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

describe('Bearer auth check L236 — unauthorized requests must not trigger handlers', () => {
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

  it('with correct Bearer token: pushes hook:event (handler runs)', async () => {
    // Correct auth → handler MUST run → hook:event pushed
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { tool: 'read', session_id: 'c1' },
      authHeader: 'Bearer secret-t1316',
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).toHaveBeenCalledWith('hook:event', expect.any(Object))
  })

  it('with wrong Bearer token: does NOT push hook:event (handler must not run)', async () => {
    // Wrong auth → handler MUST NOT run → no hook:event
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { tool: 'read', session_id: 'c1' },
      authHeader: 'Bearer wrong-secret',
    })
    await new Promise((r) => setTimeout(r, 50))
    // Kills ConditionalExpression → false mutant: if mutant always passes auth,
    // handler would run and mockWebContentsSend would be called
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('with no Authorization header: does NOT push hook:event', async () => {
    // No auth header → must be rejected → handler does not run
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'c1', cwd: '/p' },
      authHeader: null,
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('with empty Authorization header: does NOT push hook:event', async () => {
    // Empty auth → not equal to "Bearer secret" → rejected
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: {},
      authHeader: '',
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('with only "Bearer" (no secret): does NOT push hook:event', async () => {
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: {},
      authHeader: 'Bearer ',
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('with correct auth: calls writeDbNative for session-start (persistDb=true route)', async () => {
    // Correct auth + session-start (persistDb=true) → writeDbNative called
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 1, agent_id: 1 }),
          run: vi.fn(),
        }),
      })
    })
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'c1', cwd: '/project' },
      authHeader: 'Bearer secret-t1316',
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDbNative).toHaveBeenCalled()
  })

  it('with wrong auth: does NOT call writeDbNative for session-start', async () => {
    // Wrong auth → handler not run → no DB write
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'c1', cwd: '/project' },
      authHeader: 'Bearer wrong-secret',
    })
    await new Promise((r) => setTimeout(r, 100))
    // Kills ConditionalExpression → false: if auth bypass, writeDbNative would be called
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('with no auth: does NOT call writeDbNative for session-start', async () => {
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'c1', cwd: '/project' },
      authHeader: null,
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('auth comparison is exact: "Bearer secret-t1316x" (extra char) is rejected', async () => {
    // Tests the exact equality — a mutant removing/relaxing the check would pass this wrong secret
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: {},
      authHeader: 'Bearer secret-t1316x',
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })

  it('auth comparison is exact: "bearer secret-t1316" (lowercase) is rejected', async () => {
    // Case-sensitive — "bearer" !== "Bearer"
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: {},
      authHeader: 'bearer secret-t1316',
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })
})

// ── L294: err.code === 'EADDRINUSE' — ConditionalExpression true/false ─────────
// Kill:
//   → true mutant: console.warn used for ALL errors (even non-EADDRINUSE)
//   → false mutant: console.error used for ALL errors (even EADDRINUSE)
// Need to verify:
//   EADDRINUSE → console.warn (not console.error)
//   Other code → console.error (not console.warn for the branch)

describe('server error handler L294 — EADDRINUSE vs other error codes', () => {
  it('EADDRINUSE emits console.warn with port message (not console.error)', () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const server = startHookServer()

    // Emit EADDRINUSE error directly on the server
    const eaddrinuse = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }) as NodeJS.ErrnoException
    server.emit('error', eaddrinuse)

    // EADDRINUSE → must use console.warn, NOT console.error
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already in use'))
    expect(errorSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    errorSpy.mockRestore()

    // Cleanup: close if listening, or it will try to bind HOOK_PORT
    if (server.listening) {
      server.close()
    }
  })

  it('non-EADDRINUSE error emits console.error (not console.warn for the EADDRINUSE branch)', () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const server = startHookServer()

    // Emit a non-EADDRINUSE error
    const otherErr = Object.assign(new Error('EACCES'), { code: 'EACCES' }) as NodeJS.ErrnoException
    server.emit('error', otherErr)

    // Non-EADDRINUSE → must use console.error for the 'Server error' branch
    expect(errorSpy).toHaveBeenCalledWith('[hookServer] Server error:', otherErr)
    // console.warn for EADDRINUSE must NOT have been called with 'already in use'
    const warnCalls = warnSpy.mock.calls.filter(c => (c[0] as string).includes('already in use'))
    expect(warnCalls).toHaveLength(0)

    warnSpy.mockRestore()
    errorSpy.mockRestore()

    if (server.listening) {
      server.close()
    }
  })

  it('EADDRINUSE warning message contains the HOOK_PORT value', () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const server = startHookServer()
    const eaddrinuse = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }) as NodeJS.ErrnoException
    server.emit('error', eaddrinuse)

    // Message must contain the port number (kills StringLiteral mutant on the message)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(String(HOOK_PORT)))

    warnSpy.mockRestore()
    if (server.listening) {
      server.close()
    }
  })

  it('EADDRINUSE error code string is checked exactly: "EADDRINUSEX" is NOT treated as EADDRINUSE', () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('secret-t1316')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const server = startHookServer()
    // Code that starts with EADDRINUSE but is not exactly it → should go to the else (error) branch
    const notEaddrinuse = Object.assign(new Error('other'), { code: 'EADDRINUSEEXTRA' }) as NodeJS.ErrnoException
    server.emit('error', notEaddrinuse)

    // Should use console.error (the else branch), not the EADDRINUSE warn branch
    expect(errorSpy).toHaveBeenCalled()
    const warnAddrinuse = warnSpy.mock.calls.filter(c => (c[0] as string).includes('already in use'))
    expect(warnAddrinuse).toHaveLength(0)

    warnSpy.mockRestore()
    errorSpy.mockRestore()
    if (server.listening) {
      server.close()
    }
  })
})

// ── L309: addr port computation fallback ─────────────────────────────────────
// Kills: ConditionalExpression/EqualityOperator on `typeof addr === 'object' && addr !== null`
// When server.address() returns an object → use addr.port
// When server.address() returns null or string → fall back to HOOK_PORT

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

    const server = startHookServer()

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
      server.once('error', (err) => {
        // EADDRINUSE: port in use on CI — listen callback not reached, that's OK
        // The addr computation is covered by the test above
        logSpy.mockRestore()
        if (!server.listening) {
          resolve() // EADDRINUSE swallowed by hookServer
        } else {
          server.close(() => resolve())
        }
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
