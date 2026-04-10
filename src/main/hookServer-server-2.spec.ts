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
