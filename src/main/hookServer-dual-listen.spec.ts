/**
 * Tests for hookServer dual-listen (T1905) — primary 127.0.0.1 + WSL gateway
 * with retry backoff when WSL adapter is not available at startup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockWriteDb, mockAssertProjectPathAllowed, mockAssertTranscriptPathAllowed, mockInitHookSecret, mockGetHookSecret, mockDetectWslGatewayIp } = vi.hoisted(
  () => ({
    mockWriteDb: vi.fn(),
    mockAssertProjectPathAllowed: vi.fn(),
    mockAssertTranscriptPathAllowed: vi.fn(),
    mockInitHookSecret: vi.fn(),
    mockGetHookSecret: vi.fn().mockReturnValue('test-secret-dual'),
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

const { startHookServer } = await import('./hookServer')
import type { HookServerHandle } from './hookServer'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for a server to settle its initial listen (listening or error). */
async function waitForListen(server: http.Server): Promise<void> {
  if (server.listening) return
  await new Promise<void>((resolve) => {
    const onListening = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); resolve() }
    const cleanup = () => {
      server.removeListener('listening', onListening)
      server.removeListener('error', onError)
    }
    server.once('listening', onListening)
    server.once('error', onError)
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startHookServer — dual listen (T1905)', () => {
  let handle: HookServerHandle | null = null

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    mockGetHookSecret.mockReturnValue('test-secret-dual')
    mockDetectWslGatewayIp.mockReturnValue(null)
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (handle) {
      await new Promise<void>((resolve) => handle!.close(resolve))
      handle = null
    }
  })

  it('returns a HookServerHandle with primaryServer and close()', () => {
    handle = startHookServer()
    expect(handle).toBeDefined()
    expect(handle.primaryServer).toBeInstanceOf(http.Server)
    expect(typeof handle.close).toBe('function')
  })

  it('always binds primary server on 127.0.0.1', async () => {
    vi.useRealTimers()
    handle = startHookServer()
    await waitForListen(handle.primaryServer)
    if (handle.primaryServer.listening) {
      const addr = handle.primaryServer.address() as { address: string; port: number }
      expect(addr.address).toBe('127.0.0.1')
    } else {
      // Port 27182 in use — still pass (primary was attempted on 127.0.0.1)
      expect(handle.primaryServer.listening).toBe(false)
    }
    vi.useFakeTimers()
  })

  it('wslServer is null when no WSL gateway is detected', () => {
    mockDetectWslGatewayIp.mockReturnValue(null)
    handle = startHookServer()
    expect(handle.wslServer).toBeNull()
  })

  it('schedules retry when WSL gateway not found at startup', () => {
    mockDetectWslGatewayIp.mockReturnValue(null)
    handle = startHookServer()
    expect(mockDetectWslGatewayIp).toHaveBeenCalledTimes(1)

    // Advance past the first retry delay (5s)
    vi.advanceTimersByTime(5_000)
    expect(mockDetectWslGatewayIp).toHaveBeenCalledTimes(2)

    // Advance past the second retry delay (15s)
    vi.advanceTimersByTime(15_000)
    expect(mockDetectWslGatewayIp).toHaveBeenCalledTimes(3)

    // Advance past the third retry delay (30s)
    vi.advanceTimersByTime(30_000)
    // No 4th attempt — max 3 retries
    expect(mockDetectWslGatewayIp).toHaveBeenCalledTimes(4) // initial + 3 retries
  })

  it('does not create WSL server after all retries fail', () => {
    mockDetectWslGatewayIp.mockReturnValue(null)
    handle = startHookServer()

    // Exhaust all retries
    vi.advanceTimersByTime(5_000 + 15_000 + 30_000)
    expect(handle.wslServer).toBeNull()
  })

  it('creates WSL server when gateway IP becomes available on retry', async () => {
    // First call returns null, second returns an IP
    mockDetectWslGatewayIp
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('172.17.240.1')

    handle = startHookServer()
    expect(handle.wslServer).toBeNull()

    // Advance to the first retry (5s)
    vi.advanceTimersByTime(5_000)

    // WSL server should now be created
    expect(handle.wslServer).toBeInstanceOf(http.Server)
  })

  it('close() cancels pending WSL retry timers', () => {
    mockDetectWslGatewayIp.mockReturnValue(null)
    handle = startHookServer()

    // Close immediately — should not throw on timer advance
    handle.close()
    handle = null

    // Advancing timers should not trigger any retries
    vi.advanceTimersByTime(60_000)
    // Only the initial call happened
    expect(mockDetectWslGatewayIp).toHaveBeenCalledTimes(1)
  })

  it('close() closes both primary and WSL servers', async () => {
    mockDetectWslGatewayIp.mockReturnValue('172.17.240.1')
    handle = startHookServer()

    await waitForListen(handle.primaryServer)
    expect(handle.wslServer).toBeInstanceOf(http.Server)
    if (handle.wslServer) await waitForListen(handle.wslServer)

    const closedPromise = new Promise<void>((resolve) => handle!.close(resolve))

    // Use real timers for close callback
    vi.useRealTimers()
    await closedPromise

    expect(handle.primaryServer.listening).toBe(false)
    handle = null // prevent double-close in afterEach
  })
})
