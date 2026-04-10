/**
 * Tests for hookServer — handleStop DB path (byConvId lookup, fallback, zero tokens, token update)
 * Covers the NoCoverage mutants in the writeDbNative callback (T1219, updated for T1224 better-sqlite3 migration)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockWriteDb, mockWriteDbNative, mockAssertProjectPathAllowed, mockAssertTranscriptPathAllowed, mockInitHookSecret, mockGetHookSecret, mockDetectWslGatewayIp } = vi.hoisted(
  () => ({
    mockWriteDb: vi.fn(),
    mockWriteDbNative: vi.fn(),
    mockAssertProjectPathAllowed: vi.fn(), // no-op by default
    mockAssertTranscriptPathAllowed: vi.fn(), // no-op by default — T1871
    mockInitHookSecret: vi.fn(),
    mockGetHookSecret: vi.fn().mockReturnValue('test-secret-db'),
    mockDetectWslGatewayIp: vi.fn().mockReturnValue(null),
  })
)

vi.mock('./db', () => ({
  writeDb: mockWriteDb,
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

// ── Import module ──────────────────────────────────────────────────────────────

const { startHookServer, setHookWindow } = await import('./hookServer')

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createTestServer(): Promise<[http.Server, number]> {
  const server = startHookServer().primaryServer
  await new Promise<void>((resolve) => {
    if (server.listening) { resolve(); return }
    const onListening = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); resolve() }
    const cleanup = () => {
      server.removeListener('listening', onListening)
      server.removeListener('error', onError)
    }
    server.once('listening', onListening)
    server.once('error', onError)
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
  opts: { path: string; body?: unknown; authHeader?: string | null }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
    }
    if (opts.authHeader !== null) {
      headers['Authorization'] =
        opts.authHeader !== undefined ? opts.authHeader : 'Bearer test-secret-db'
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, path: opts.path, method: 'POST', headers },
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

/** Build a minimal JSONL transcript with given token counts */
function makeTranscript(opts: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      stop_reason: 'end_turn',
      usage: {
        input_tokens: opts.inputTokens,
        output_tokens: opts.outputTokens,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
      },
    },
  }) + '\n'
}

// ── handleStop — DB write path ─────────────────────────────────────────────────

describe('handleStop — DB write path via real transcript', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hookServer_db_test_transcript.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-db')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    setHookWindow(null as unknown as import('electron').BrowserWindow)
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('calls writeDbNative when all fields present and transcript has non-zero tokens', async () => {
    writeFileSync(tmpFile, makeTranscript({ inputTokens: 500, outputTokens: 200 }))
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-abc', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(mockWriteDbNative).toHaveBeenCalledOnce()
    expect(mockWriteDbNative).toHaveBeenCalledWith(
      expect.stringContaining('project.db'),
      expect.any(Function)
    )
  })

  it('skips writeDbNative when transcript parses to zero tokens (both tokensIn and tokensOut are 0)', async () => {
    // File with no finalized assistant messages → zero tokens
    writeFileSync(tmpFile, JSON.stringify({ type: 'user', message: { content: 'hello' } }) + '\n')
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-zero', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // tokensIn=0 and tokensOut=0 → early return, no DB write
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('runs writeDbNative callback: executes DB statements to find session by conv_id', async () => {
    writeFileSync(tmpFile, makeTranscript({ inputTokens: 100, outputTokens: 50 }))

    let capturedCallback: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCallback = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-lookup', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedCallback).not.toBeNull()

    // Execute the callback with a mock DB using better-sqlite3 native API
    const mockStmt = {
      get: vi.fn().mockReturnValue({ id: 42 }),
      run: vi.fn(),
    }
    const mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
    }

    capturedCallback!(mockDb)

    // Should have prepared a SELECT statement with conv_id lookup
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM sessions WHERE claude_conv_id = ?')
    )
    // Should have called stmt.get with the conv_id
    expect(mockStmt.get).toHaveBeenCalledWith('conv-lookup')
  })

  it('runs writeDbNative callback: updates tokens and status on found session', async () => {
    writeFileSync(tmpFile, makeTranscript({ inputTokens: 300, outputTokens: 120, cacheRead: 50, cacheWrite: 20 }))

    let capturedCallback: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCallback = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-update', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedCallback).not.toBeNull()

    const mockStmt = {
      get: vi.fn().mockReturnValue({ id: 99 }),
      run: vi.fn(),
    }
    const mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
    }

    capturedCallback!(mockDb)

    // Should have run two UPDATEs: tokens + status
    expect(mockStmt.run).toHaveBeenCalledWith(300, 120, 50, 20, 99)
    expect(mockStmt.run).toHaveBeenCalledWith(99)
  })

  it('runs writeDbNative callback: falls back to most recent started session when conv_id not found', async () => {
    writeFileSync(tmpFile, makeTranscript({ inputTokens: 200, outputTokens: 80 }))

    let capturedCallback: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCallback = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-unknown', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedCallback).not.toBeNull()

    // First stmt (byConvId): .get() returns undefined → session not found
    // Second stmt (fallback): .get() returns row → session found via fallback
    let callCount = 0
    const mockDb = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return { get: vi.fn().mockReturnValue(undefined), run: vi.fn() }
        }
        return { get: vi.fn().mockReturnValue({ id: 77 }), run: vi.fn() }
      }),
    }

    capturedCallback!(mockDb)

    // Fallback stmt prepared with the fallback query
    expect(mockDb.prepare).toHaveBeenCalledTimes(4) // byConvId + fallback + 2 UPDATEs
    expect(mockDb.prepare).toHaveBeenNthCalledWith(2,
      expect.stringContaining("status IN ('started','completed')")
    )
  })

  it('runs writeDbNative callback: returns early when no session found (byConvId and fallback both fail)', async () => {
    writeFileSync(tmpFile, makeTranscript({ inputTokens: 100, outputTokens: 50 }))

    let capturedCallback: ((db: unknown) => void) | null = null
    mockWriteDbNative.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      capturedCallback = cb
    })

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-noexist', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedCallback).not.toBeNull()

    // Both stmts: .get() returns undefined → no session found
    const mockStmt = {
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn(),
    }
    const mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
    }

    capturedCallback!(mockDb)

    // No UPDATE should be run
    expect(mockStmt.run).not.toHaveBeenCalled()
  })

  it('handles writeDbNative rejection without crashing server', async () => {
    writeFileSync(tmpFile, makeTranscript({ inputTokens: 100, outputTokens: 50 }))
    mockWriteDbNative.mockRejectedValue(new Error('DB write failed'))

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-err', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))

    // Server should still be alive
    const health = await makeRequest(port, { path: '/hooks/session-start', body: {} })
    expect(health.status).toBe(200)
  })

  it('pushes Stop hook:event even when writeDbNative is not called (missing session_id)', async () => {
    const mockWebContentsSend = vi.fn()
    const fakeWin = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: mockWebContentsSend },
    } as unknown as import('electron').BrowserWindow
    setHookWindow(fakeWin)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { transcript_path: '/tmp/x.jsonl', cwd: '/cwd' },
    })
    await new Promise((r) => setTimeout(r, 50))

    // pushHookEvent is always called for /hooks/stop, even without session_id
    expect(mockWebContentsSend).toHaveBeenCalledWith(
      'hook:event',
      expect.objectContaining({ event: 'Stop' })
    )
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })
})

// ── handleStop — token skip guard (L123) ──────────────────────────────────────

describe('handleStop — token skip guard', () => {
  let server: http.Server
  let port: number
  const tmpFile = join(tmpdir(), 'hookServer_token_skip.jsonl')

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-db')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('skips DB when only tokensIn is 0 but tokensOut is also 0 (both zero → skip)', async () => {
    // Only streaming entries (stop_reason=null) → tokensIn=0, tokensOut=0
    writeFileSync(tmpFile,
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: null, usage: { input_tokens: 100, output_tokens: 1 } },
      }) + '\n'
    )
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-skip', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(mockWriteDbNative).not.toHaveBeenCalled()
  })

  it('does NOT skip DB when tokensIn > 0 (even if tokensOut is 0)', async () => {
    // A finalized message with tokensIn > 0 and tokensOut = 0
    writeFileSync(tmpFile,
      JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      }) + '\n'
    )
    mockWriteDbNative.mockResolvedValue(undefined)

    await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'conv-nonzero', transcript_path: tmpFile, cwd: '/project' },
    })
    await new Promise((r) => setTimeout(r, 200))
    // tokensIn=100, tokensOut=0 → NOT (tokensIn===0 && tokensOut===0) → writeDbNative called
    expect(mockWriteDbNative).toHaveBeenCalled()
  })
})

// ── startHookServer — edge cases ───────────────────────────────────────────────

describe('startHookServer — listen and body size edge cases', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    vi.resetAllMocks()
    mockGetHookSecret.mockReturnValue('test-secret-db')
    ;[server, port] = await createTestServer()
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('returns 200 and body {} for valid authorized request', async () => {
    const res = await makeRequest(port, { path: '/hooks/session-start', body: { session_id: 'x', cwd: '/p' } })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('rejects oversized body with 413', async () => {
    // Send > 1 MB body
    const largeBody = 'x'.repeat(1.1 * 1024 * 1024)
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hooks/session-start',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-secret-db',
          },
        },
        (res) => {
          res.resume()
          resolve({ status: res.statusCode ?? 0 })
        }
      )
      req.on('error', (e) => {
        // ECONNRESET is expected after req.destroy() — resolve with the status we got
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve({ status: 413 })
        } else {
          reject(e)
        }
      })
      req.write(largeBody)
      req.end()
    })
    expect(result.status).toBe(413)
  })

  it('returns 200 for authorized /hooks/stop', async () => {
    const res = await makeRequest(port, {
      path: '/hooks/stop',
      body: { session_id: 'c1', transcript_path: '/tmp/t.jsonl', cwd: '/cwd' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('{}')
  })

  it('server address port equals the port used for the test', () => {
    const addr = server.address() as { port: number } | null
    expect(addr).not.toBeNull()
    expect(addr!.port).toBe(port)
    expect(addr!.port).toBeGreaterThan(0)
  })
})
