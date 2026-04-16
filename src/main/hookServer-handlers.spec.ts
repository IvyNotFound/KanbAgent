/**
 * Tests for hookServer-handlers.ts — handlePermissionRequest lifecycle,
 * MAX_PENDING_PERMISSIONS guard, timer cleanup, handleLifecycleEvent, handleStop.
 *
 * T1947
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type http from 'http'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAssertProjectPathAllowed, mockWriteDb, mockAssertTranscriptPathAllowed } = vi.hoisted(() => ({
  mockAssertProjectPathAllowed: vi.fn(),
  mockWriteDb: vi.fn(),
  mockAssertTranscriptPathAllowed: vi.fn(),
}))

vi.mock('./db', () => ({
  writeDbNative: mockWriteDb,
  assertProjectPathAllowed: mockAssertProjectPathAllowed,
  assertTranscriptPathAllowed: mockAssertTranscriptPathAllowed,
}))

vi.mock('fs/promises', () => ({
  default: {},
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('./hookServer-tokens', () => ({
  parseTokensFromJSONLStream: vi.fn().mockResolvedValue({
    tokensIn: 100,
    tokensOut: 50,
    cacheRead: 10,
    cacheWrite: 5,
  }),
}))

// ── Import modules ─────────────────────────────────────────────────────────────

const {
  handlePermissionRequest,
  resolvePermission,
  handleLifecycleEvent,
  handleStop,
  pendingPermissions,
  MAX_PENDING_PERMISSIONS,
} = await import('./hookServer-handlers')

const { parseTokensFromJSONLStream } = await import('./hookServer-tokens')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
    headersSent: false,
  } as unknown as http.ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

function makeWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(destroyed),
    webContents: { send: vi.fn() },
  } as unknown as import('electron').BrowserWindow
}

// ── handlePermissionRequest — core lifecycle ──────────────────────────────────

describe('handlePermissionRequest — allow / deny lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    pendingPermissions.clear()
  })

  it('returns allow response when resolvePermission is called with approve', async () => {
    const win = makeWindow()
    const res = makeRes()

    handlePermissionRequest(
      { tool_name: 'Bash', tool_input: { command: 'ls' } },
      res,
      () => win
    )

    // Extract the permission_id from the IPC send call
    const hookEventCall = win.webContents.send.mock.calls.find(
      (c) => c[0] === 'hook:event'
    )
    expect(hookEventCall).toBeDefined()
    const event = hookEventCall![1] as { payload: { permission_id: string } }
    const permissionId = event.payload.permission_id
    expect(permissionId).toMatch(/^perm_/)

    // Resolve with allow
    const resolved = resolvePermission(permissionId, { behavior: 'allow' })
    expect(resolved).toBe(true)

    // Flush promise microtasks
    await Promise.resolve()
    await Promise.resolve()

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.behavior).toBe('allow')
  })

  it('returns deny response when resolvePermission is called with deny', async () => {
    const win = makeWindow()
    const res = makeRes()

    handlePermissionRequest(
      { tool_name: 'Edit', tool_input: { path: '/etc/passwd' } },
      res,
      () => win
    )

    const hookEventCall = win.webContents.send.mock.calls.find((c) => c[0] === 'hook:event')
    const event = hookEventCall![1] as { payload: { permission_id: string } }
    const permissionId = event.payload.permission_id

    const resolved = resolvePermission(permissionId, { behavior: 'deny', reason: 'User refused' })
    expect(resolved).toBe(true)

    await Promise.resolve()
    await Promise.resolve()

    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(body.hookSpecificOutput.decision.reason).toBe('User refused')
  })

  it('returns deny after timeout fires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const win = makeWindow()
      const res = makeRes()

      handlePermissionRequest(
        { tool_name: 'Bash', tool_input: {} },
        res,
        () => win
      )

      expect(pendingPermissions.size).toBe(1)

      // Advance past PERMISSION_TIMEOUT_MS (120_000)
      vi.advanceTimersByTime(120_001)

      // Entry should be removed immediately by the timeout callback
      expect(pendingPermissions.size).toBe(0)

      // Flush microtasks so promise.then runs
      await Promise.resolve()
      await Promise.resolve()

      const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
      expect(body.hookSpecificOutput.decision.reason).toContain('Timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes entry from pendingPermissions after resolution (no memory leak)', async () => {
    const win = makeWindow()
    const res = makeRes()

    handlePermissionRequest(
      { tool_name: 'Bash', tool_input: {} },
      res,
      () => win
    )

    expect(pendingPermissions.size).toBe(1)

    const hookEventCall = win.webContents.send.mock.calls.find((c) => c[0] === 'hook:event')
    const event = hookEventCall![1] as { payload: { permission_id: string } }
    resolvePermission(event.payload.permission_id, { behavior: 'allow' })

    expect(pendingPermissions.size).toBe(0)

    await Promise.resolve()
    await Promise.resolve()
  })

  it('clears the timer when permission is resolved before timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const win = makeWindow()
      const res = makeRes()

      handlePermissionRequest(
        { tool_name: 'Bash', tool_input: {} },
        res,
        () => win
      )

      const hookEventCall = win.webContents.send.mock.calls.find((c) => c[0] === 'hook:event')
      const event = hookEventCall![1] as { payload: { permission_id: string } }
      resolvePermission(event.payload.permission_id, { behavior: 'allow' })

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
    } finally {
      clearTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('handles multiple parallel requests independently (distinct permissionIds)', async () => {
    const win = makeWindow()
    const res1 = makeRes()
    const res2 = makeRes()

    handlePermissionRequest({ tool_name: 'Bash', tool_input: {} }, res1, () => win)
    handlePermissionRequest({ tool_name: 'Edit', tool_input: {} }, res2, () => win)

    expect(pendingPermissions.size).toBe(2)

    // Collect the two permission IDs
    const hookEventCalls = win.webContents.send.mock.calls.filter((c) => c[0] === 'hook:event')
    expect(hookEventCalls).toHaveLength(2)
    const id1 = (hookEventCalls[0][1] as { payload: { permission_id: string } }).payload.permission_id
    const id2 = (hookEventCalls[1][1] as { payload: { permission_id: string } }).payload.permission_id
    expect(id1).not.toBe(id2)

    // Resolve first with allow, second with deny
    resolvePermission(id1, { behavior: 'allow' })
    resolvePermission(id2, { behavior: 'deny', reason: 'denied separately' })

    await Promise.resolve()
    await Promise.resolve()

    const body1 = JSON.parse((res1.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    const body2 = JSON.parse((res2.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(body1.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(body2.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(pendingPermissions.size).toBe(0)
  })
})

// ── handlePermissionRequest — MAX_PENDING_PERMISSIONS guard ───────────────────

describe('handlePermissionRequest — MAX_PENDING_PERMISSIONS guard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    pendingPermissions.clear()
  })

  afterEach(() => {
    pendingPermissions.clear()
  })

  it('denies immediately when pendingPermissions is at MAX_PENDING_PERMISSIONS', () => {
    // Fill the map to the limit
    for (let i = 0; i < MAX_PENDING_PERMISSIONS; i++) {
      pendingPermissions.set(`perm_fake_${i}`, {
        resolve: vi.fn(),
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
      })
    }
    expect(pendingPermissions.size).toBe(MAX_PENDING_PERMISSIONS)

    const res = makeRes()
    handlePermissionRequest(
      { tool_name: 'Bash', tool_input: {} },
      res,
      () => makeWindow()
    )

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(body.hookSpecificOutput.decision.reason).toContain('Too many pending')

    // Map should not have grown
    expect(pendingPermissions.size).toBe(MAX_PENDING_PERMISSIONS)
  })

  it('MAX_PENDING_PERMISSIONS constant is 50', () => {
    expect(MAX_PENDING_PERMISSIONS).toBe(50)
  })
})

// ── handlePermissionRequest — no renderer ────────────────────────────────────

describe('handlePermissionRequest — no renderer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    pendingPermissions.clear()
  })

  it('denies immediately when getHookWindow returns null', () => {
    const res = makeRes()
    handlePermissionRequest(
      { tool_name: 'Bash', tool_input: {} },
      res,
      () => null
    )

    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(body.hookSpecificOutput.decision.reason).toContain('No renderer')
  })

  it('denies immediately when window is destroyed', () => {
    const res = makeRes()
    handlePermissionRequest(
      { tool_name: 'Bash', tool_input: {} },
      res,
      () => makeWindow(true)
    )

    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(body.hookSpecificOutput.decision.reason).toContain('No renderer')
  })
})

// ── resolvePermission ─────────────────────────────────────────────────────────

describe('resolvePermission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    pendingPermissions.clear()
  })

  it('returns false for unknown permissionId (expired or never existed)', () => {
    expect(resolvePermission('perm_unknown_999', { behavior: 'allow' })).toBe(false)
  })
})

// ── handleLifecycleEvent ──────────────────────────────────────────────────────

describe('handleLifecycleEvent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteDb.mockResolvedValue(undefined)
  })

  it('calls pushHookEvent with correct event name and payload', async () => {
    const pushHookEvent = vi.fn()
    const payload = { session_id: 'conv-1', cwd: '/my/project' }

    await handleLifecycleEvent('SessionStart', payload, false, pushHookEvent)

    expect(pushHookEvent).toHaveBeenCalledWith('SessionStart', payload)
  })

  it('calls pushHookEvent even when persistDb=false', async () => {
    const pushHookEvent = vi.fn()
    const payload = { session_id: 'conv-2', cwd: '/project', tool: 'Bash' }

    await handleLifecycleEvent('PreToolUse', payload, false, pushHookEvent)

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(pushHookEvent).toHaveBeenCalledWith('PreToolUse', payload)
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('calls pushHookEvent AND writeDb when persistDb=true and cwd+conv_id present', async () => {
    const pushHookEvent = vi.fn()
    mockWriteDb.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 1, agent_id: 2 }),
          run: vi.fn(),
        }),
      })
    })

    await handleLifecycleEvent(
      'SubagentStart',
      { session_id: 'conv-abc', cwd: '/my/project' },
      true,
      pushHookEvent
    )

    expect(pushHookEvent).toHaveBeenCalledWith('SubagentStart', expect.objectContaining({ session_id: 'conv-abc' }))
    expect(mockWriteDb).toHaveBeenCalledWith(
      expect.stringContaining('project.db'),
      expect.any(Function)
    )
  })

  it('skips writeDb when convId is missing (persistDb=true)', async () => {
    const pushHookEvent = vi.fn()

    await handleLifecycleEvent('SessionStart', { cwd: '/project' }, true, pushHookEvent)

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when cwd is missing (persistDb=true)', async () => {
    const pushHookEvent = vi.fn()

    await handleLifecycleEvent('SessionStart', { session_id: 'conv-x' }, true, pushHookEvent)

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('skips writeDb when cwd is not in the allowlist', async () => {
    const pushHookEvent = vi.fn()
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })

    await handleLifecycleEvent(
      'SessionStart',
      { session_id: 'conv-x', cwd: '/evil' },
      true,
      pushHookEvent
    )

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })
})

// ── handleStop ────────────────────────────────────────────────────────────────

describe('handleStop', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWriteDb.mockResolvedValue(undefined)
    vi.mocked(parseTokensFromJSONLStream).mockResolvedValue({
      tokensIn: 100,
      tokensOut: 50,
      cacheRead: 10,
      cacheWrite: 5,
    })
  })

  it('calls pushHookEvent with Stop and full payload', async () => {
    const pushHookEvent = vi.fn()
    const payload = {
      session_id: 'conv-stop-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/my/project',
    }

    mockWriteDb.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb({
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 42 }),
          run: vi.fn(),
        }),
      })
    })

    await handleStop(payload, pushHookEvent)

    expect(pushHookEvent).toHaveBeenCalledWith('Stop', payload)
  })

  it('returns early when convId is missing', async () => {
    const pushHookEvent = vi.fn()

    await handleStop(
      { transcript_path: '/tmp/t.jsonl', cwd: '/project' },
      pushHookEvent
    )

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns early when transcript_path is missing', async () => {
    const pushHookEvent = vi.fn()

    await handleStop(
      { session_id: 'conv-x', cwd: '/project' },
      pushHookEvent
    )

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns early when cwd is missing', async () => {
    const pushHookEvent = vi.fn()

    await handleStop(
      { session_id: 'conv-x', transcript_path: '/tmp/t.jsonl' },
      pushHookEvent
    )

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns early when cwd is not in allowlist', async () => {
    const pushHookEvent = vi.fn()
    mockAssertProjectPathAllowed.mockImplementationOnce(() => { throw new Error('not allowed') })

    await handleStop(
      { session_id: 'conv-x', transcript_path: '/tmp/t.jsonl', cwd: '/evil' },
      pushHookEvent
    )

    expect(pushHookEvent).toHaveBeenCalledOnce()
    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('returns early when transcript_path fails security check', async () => {
    const pushHookEvent = vi.fn()
    mockAssertTranscriptPathAllowed.mockImplementationOnce(() => { throw new Error('path not allowed') })

    await handleStop(
      { session_id: 'conv-x', transcript_path: '/evil/path.jsonl', cwd: '/project' },
      pushHookEvent
    )

    expect(mockWriteDb).not.toHaveBeenCalled()
  })

  it('calls writeDbNative to update token counts when all fields are valid', async () => {
    const pushHookEvent = vi.fn()
    const dbMock = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: 99 }),
        run: vi.fn(),
      }),
    }
    mockWriteDb.mockImplementation(async (_path: string, cb: (db: unknown) => void) => {
      cb(dbMock)
    })

    await handleStop(
      { session_id: 'conv-ok', transcript_path: '/tmp/t.jsonl', cwd: '/project' },
      pushHookEvent
    )

    expect(mockWriteDb).toHaveBeenCalledWith(
      expect.stringContaining('project.db'),
      expect.any(Function)
    )
  })

  it('does not call writeDb when token counts are both zero', async () => {
    const pushHookEvent = vi.fn()
    vi.mocked(parseTokensFromJSONLStream).mockResolvedValue({
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })

    await handleStop(
      { session_id: 'conv-empty', transcript_path: '/tmp/t.jsonl', cwd: '/project' },
      pushHookEvent
    )

    expect(mockWriteDb).not.toHaveBeenCalled()
  })
})
