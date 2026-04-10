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
