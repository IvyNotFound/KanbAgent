/**
 * Tests for hookServer HTTP server — startHookServer, setHookWindow,
 * handleStop, handleLifecycleEvent, pushHookEvent, truncateHookPayload (T1101)
 *
 * These tests spin up real http.Server instances on random ports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockWriteDb, mockAssertProjectPathAllowed, mockAssertTranscriptPathAllowed, mockInitHookSecret, mockGetHookSecret, mockWebContentsSend, mockDetectWslGatewayIp } = vi.hoisted(
  () => ({
    mockWriteDb: vi.fn(),
    mockAssertProjectPathAllowed: vi.fn(), // no-op by default — allows all paths
    mockAssertTranscriptPathAllowed: vi.fn(), // no-op by default — T1871
    mockInitHookSecret: vi.fn(),
    mockGetHookSecret: vi.fn().mockReturnValue('test-secret-abc123'),
    mockWebContentsSend: vi.fn(),
    mockDetectWslGatewayIp: vi.fn().mockReturnValue(null),
  })
)

vi.mock('./db', () => ({
  writeDbNative: mockWriteDb,
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

// ── Import module ─────────────────────────────────────────────────────────────

const { startHookServer, setHookWindow, pendingPermissions, MAX_PENDING_PERMISSIONS } = await import('./hookServer')
import type { HookServerHandle } from './hookServer'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Start a server on a random port.
 * startHookServer() returns a HookServerHandle; we use primaryServer for tests.
 * We wait for the first listen() to settle (listening or EADDRINUSE) before
 * re-listening on port 0 to avoid the race where the EADDRINUSE error from
 * the initial listen gets caught by the second listen's error handler.
 */
async function createTestServer(): Promise<[http.Server, number, HookServerHandle]> {
  const handle = startHookServer()
  const server = handle.primaryServer
  // Wait for the initial listen(HOOK_PORT) to settle: either 'listening' or 'error'
  await new Promise<void>((resolve) => {
    if (server.listening) { resolve(); return }
    const onListening = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); resolve() } // EADDRINUSE is handled by hookServer
    const cleanup = () => {
      server.removeListener('listening', onListening)
      server.removeListener('error', onError)
    }
    server.once('listening', onListening)
    server.once('error', onError)
  })
  // Now close if still listening, then relisten on a random port
  await new Promise<void>((resolve) => {
    if (!server.listening) { resolve(); return }
    server.close(() => resolve())
  })
  // Relisten on random port
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', resolve)
    server.listen(0, '127.0.0.1')
  })
  const addr = server.address() as { port: number }
  return [server, addr.port, handle]
}

function makeRequest(
  port: number,
  opts: {
    method?: string
    path: string
    body?: unknown
    authHeader?: string | null
  }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
    }
    if (opts.authHeader !== null) {
      headers['Authorization'] =
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer test-secret-abc123'
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

// ── setHookWindow ─────────────────────────────────────────────────────────────

describe('setHookWindow', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-abc123')
    mockWriteDb.mockResolvedValue(undefined)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    setHookWindow(null as unknown as import('electron').BrowserWindow)
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('sets the window used for IPC push — hook:event is sent on valid route', async () => {
    const fakeWin = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockWebContentsSend },
    } as unknown as import('electron').BrowserWindow
    setHookWindow(fakeWin)

    await makeRequest(port, { path: '/hooks/pre-tool-use', body: { session_id: 'c1' } })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ event: 'PreToolUse' })
    )
  })

  it('does not send hook:event when window is null', async () => {
    // window was reset to null in beforeEach via afterEach from previous run — or here explicitly
    setHookWindow(null as unknown as import('electron').BrowserWindow)

    await makeRequest(port, { path: '/hooks/pre-tool-use', body: {} })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).not.toHaveBeenCalled()
  })
})

// ── startHookServer — HTTP mechanics ─────────────────────────────────────────

describe('startHookServer', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-abc123')
    mockWriteDb.mockResolvedValue(undefined)
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('calls initHookSecret on startup', () => {
    expect(mockInitHookSecret).toHaveBeenCalled()
  })

  it('listens on 127.0.0.1 when no WSL gateway is detected', () => {
    const addr = server.address() as { address: string; port: number } | null
    expect(addr).not.toBeNull()
    expect(addr!.address).toBe('127.0.0.1')
  })

  it('returns 404 for GET /hooks/stop', async () => {
    const res = await makeRequest(port, { method: 'GET', path: '/hooks/stop', authHeader: null })
    expect(res.status).toBe(404)
  })

  it('returns 404 for POST to non-hooks path', async () => {
    const res = await makeRequest(port, { path: '/other/path', body: {} })
    expect(res.status).toBe(404)
  })

  it('returns 200 {} with wrong Authorization header (does not block Claude Code)', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/stop',
      body: {},
      authHeader: 'Bearer wrong-secret',
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('returns 200 {} with no Authorization header', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/stop',
      body: {},
      authHeader: null,
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('returns 200 {} for valid POST /hooks/stop', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/tmp/t.jsonl', cwd: '/cwd' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('returns 200 {} for valid POST /hooks/session-start', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'c1', cwd: '/cwd' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('returns 200 for /hooks/pre-tool-use (IPC-only, no DB write)', async () => {
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { tool: 'bash', session_id: 'c1', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns 200 for /hooks/post-tool-use (IPC-only, no DB write)', async () => {
    await makeRequest(port, {
      path: '/hooks/post-tool-use',
      body: { tool: 'bash', session_id: 'c1', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns 200 for /hooks/instructions-loaded (IPC-only, no DB write)', async () => {
    await makeRequest(port, {
      path: '/hooks/instructions-loaded',
      body: { session_id: 'c1', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns 200 for unknown /hooks/* path without crashing', async () => {
    const res = await makeRequest(port, { path: '/hooks/unknown-event', body: { foo: 'bar' } })
    expect(res.status).toBe(200)
  })

  it('handles malformed JSON body without crashing server', async () => {
    await new Promise<{ status: number }>((resolve, reject) => {
      const body = '{broken json'
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/stop',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-secret-abc123',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }) }
      )
      req.on('error', reject)
      req.end(body)
    })
    // Server must still respond after bad payload
    const health = await makeRequest(port, { path: '/hooks/session-start', body: {} })
    expect(health.status).toBe(200)
  })
})

// ── handleStop — guard conditions ─────────────────────────────────────────────

describe('handleStop via HTTP', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-abc123')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('skips writeDb when session_id is missing', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { transcript_path: '/tmp/t.jsonl', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when transcript_path is missing', async () => {
    await makeRequest(port, { path: '/hooks/stop', body: { session_id: 'c1', cwd: '/cwd' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when cwd is missing', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/tmp/t.jsonl' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when transcript file does not exist', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/nonexistent/file.jsonl', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when cwd is not in the allowlist (T1175)', async () => {
    mockAssertProjectPathAllowed.mockImplementationOnce(() => {
      throw new Error('DB_PATH_NOT_ALLOWED: /evil/.claude/project.db')
    })
    // assertProjectPathAllowed fires before transcript read — no need for a valid file
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/any/path.jsonl', cwd: '/evil' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockAssertProjectPathAllowed).toHaveBeenCalled()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when transcript_path is outside allowed directories (T1871)', async () => {
    mockAssertTranscriptPathAllowed.mockImplementationOnce(() => {
      throw new Error('TRANSCRIPT_PATH_NOT_ALLOWED: /etc/passwd')
    })
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/etc/passwd', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockAssertTranscriptPathAllowed).toHaveBeenCalled()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })
})

// ── Permission request cap (T1853) ───────────────────────────────────────────

describe('handlePermissionRequest — cap at MAX_PENDING_PERMISSIONS', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-abc123')
    ;[server, port] = await createTestServer()

    // Set up a fake window so the handler doesn't short-circuit on "no renderer"
    const fakeWin = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockWebContentsSend },
    } as unknown as import('electron').BrowserWindow
    setHookWindow(fakeWin)
  })

  afterEach(async () => {
    // Clean up pending permissions
    for (const [id, p] of pendingPermissions) {
      clearTimeout(p.timer)
      pendingPermissions.delete(id)
    }
    setHookWindow(null as unknown as import('electron').BrowserWindow)
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('denies immediately when pendingPermissions is at capacity', async () => {
    // Fill the map to capacity with dummy entries
    for (let i = 0; i < MAX_PENDING_PERMISSIONS; i++) {
      const timer = setTimeout(() => {}, 120_000)
      pendingPermissions.set(`fill-${i}`, { resolve: () => {}, timer })
    }
    expect(pendingPermissions.size).toBe(MAX_PENDING_PERMISSIONS)

    // This request should be denied immediately (not block)
    const { status, body } = await makeRequest(port, {
      path: '/hooks/permission-request',
      body: { tool_name: 'Write', tool_input: { path: '/foo' } },
    })

    expect(status).toBe(200)
    const parsed = JSON.parse(body)
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(parsed.hookSpecificOutput.decision.reason).toContain('Too many pending')
    // Map should not have grown
    expect(pendingPermissions.size).toBe(MAX_PENDING_PERMISSIONS)
  })
})

// handleLifecycleEvent and pushHookEvent/truncateHookPayload tests
// are in hookServer-push.spec.ts (split to keep files < 400 lines)
