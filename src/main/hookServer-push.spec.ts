/**
 * Tests for hookServer — handleLifecycleEvent (persistDb routing) and
 * pushHookEvent / truncateHookPayload (T1101)
 *
 * Split from hookServer-server.spec.ts to keep files < 400 lines.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockWriteDb, mockAssertProjectPathAllowed, mockAssertTranscriptPathAllowed, mockInitHookSecret, mockGetHookSecret, mockWebContentsSend } = vi.hoisted(
  () => ({
    mockWriteDb: vi.fn(),
    mockAssertProjectPathAllowed: vi.fn(), // no-op by default — allows all paths
    mockAssertTranscriptPathAllowed: vi.fn(), // no-op by default — T1871
    mockInitHookSecret: vi.fn(),
    mockGetHookSecret: vi.fn().mockReturnValue('test-secret-abc123'),
    mockWebContentsSend: vi.fn(),
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
  }
})

// ── Import module ─────────────────────────────────────────────────────────────

const { startHookServer, setHookWindow } = await import('./hookServer')

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createTestServer(): Promise<[http.Server, number]> {
  const server = startHookServer()
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

// ── handleLifecycleEvent — persistDb routing ──────────────────────────────────

describe('handleLifecycleEvent via HTTP', () => {
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

  it('calls writeDb for /hooks/session-start (persistDb=true)', async () => {
    mockWriteDb.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 42, agent_id: 7 }),
          run: vi.fn(),
        }),
      })
    })
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-abc', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDb).toHaveBeenCalledWith(
      expect.stringContaining('project.db'),
      expect.any(Function)
    )
  })

  it('skips writeDb when cwd missing on session-start', async () => {
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-abc' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when session_id missing on session-start', async () => {
    await makeRequest(port, { path: '/hooks/session-start', body: { cwd: '/project' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('handles writeDb rejection without crashing server', async () => {
    mockWriteDb.mockRejectedValue(new Error('DB write failed'))
    await makeRequest(port, {
      path: '/hooks/subagent-start',
      body: { session_id: 'conv-xyz', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))
    const health = await makeRequest(port, { path: '/hooks/pre-tool-use', body: {} })
    expect(health.status).toBe(200)
  })

  it('calls writeDb for /hooks/subagent-stop (persistDb=true)', async () => {
    mockWriteDb.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
          run: vi.fn(),
        }),
      })
    })
    await makeRequest(port, {
      path: '/hooks/subagent-stop',
      body: { session_id: 'conv-stop', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDb).toHaveBeenCalled()
  })

  it('calls writeDb for /hooks/subagent-start (persistDb=true)', async () => {
    mockWriteDb.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 10, agent_id: 3 }),
          run: vi.fn(),
        }),
      })
    })
    await makeRequest(port, {
      path: '/hooks/subagent-start',
      body: { session_id: 'conv-sub', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDb).toHaveBeenCalled()
  })

  it('does NOT call writeDb for /hooks/pre-tool-use (persistDb=false)', async () => {
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { session_id: 'conv-abc', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('does NOT call writeDb for /hooks/post-tool-use (persistDb=false)', async () => {
    await makeRequest(port, {
      path: '/hooks/post-tool-use',
      body: { session_id: 'conv-abc', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('does NOT call writeDb for /hooks/instructions-loaded (persistDb=false)', async () => {
    await makeRequest(port, {
      path: '/hooks/instructions-loaded',
      body: { session_id: 'conv-abc', cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when cwd is not in the allowlist (T1175)', async () => {
    mockAssertProjectPathAllowed.mockImplementationOnce(() => {
      throw new Error('DB_PATH_NOT_ALLOWED: /evil/.claude/project.db')
    })
    await makeRequest(port, {
      path: '/hooks/session-start',
      body: { session_id: 'conv-abc', cwd: '/evil' },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(mockWriteDb).not.toHaveBeenCalled()
  })
})

// ── pushHookEvent and truncateHookPayload ─────────────────────────────────────

describe('pushHookEvent and truncateHookPayload', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-abc123')
    mockWriteDb.mockResolvedValue(undefined)
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

  it('pushes hook:event with correct event name and ts field', async () => {
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { tool: 'bash', session_id: 'c1' },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ event: 'PreToolUse', ts: expect.any(Number) })
    )
  })

  it('truncates large payload (> 64 KB) with _truncated=true wrapper', async () => {
    const largePayload = { data: 'x'.repeat(65 * 1024) }
    await makeRequest(port, { path: '/hooks/pre-tool-use', body: largePayload })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ payload: expect.objectContaining({ _truncated: true }) })
    )
  })

  it('does NOT truncate small payload — _truncated flag absent', async () => {
    await makeRequest(port, {
      path: '/hooks/pre-tool-use',
      body: { tool: 'bash', session_id: 'c1' },
    })
    await new Promise((r) => setTimeout(r, 50))

    const call = mockWebContentsSend.mock.calls[0]
    const event = call[1] as { payload: Record<string, unknown> }
    expect(event.payload._truncated).toBeUndefined()
  })

  it('does not call webContents.send when window is destroyed', async () => {
    const destroyedWin = {
      isDestroyed: vi.fn().mockReturnValue(true),
      webContents: { send: vi.fn() },
    } as unknown as import('electron').BrowserWindow
    setHookWindow(destroyedWin)

    await makeRequest(port, { path: '/hooks/pre-tool-use', body: { tool: 'bash' } })
    await new Promise((r) => setTimeout(r, 50))

    expect(destroyedWin.webContents.send).not.toHaveBeenCalled()
  })

  it('pushes Stop event for /hooks/stop route', async () => {
    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/tmp/x.jsonl', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ event: 'Stop' })
    )
  })

  it('pushes postToolUse event for /hooks/post-tool-use route', async () => {
    await makeRequest(port, {
      path: '/hooks/post-tool-use',
      body: { tool: 'read', session_id: 'c2' },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ event: 'PostToolUse' })
    )
  })

  it('pushes instructionsLoaded event for /hooks/instructions-loaded route', async () => {
    await makeRequest(port, {
      path: '/hooks/instructions-loaded',
      body: { session_id: 'c1', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ event: 'InstructionsLoaded' })
    )
  })
})
