/**
 * Tests for ADR-013 — PermissionRequest project allowlist guard.
 *
 * Verifies that handlePermissionRequest denies requests for projects
 * not managed by this instance (multi-instance isolation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  parseTokensFromJSONLStream: vi.fn(),
}))

// ── Import module ─────────────────────────────────────────────────────────────

const { handlePermissionRequest } = await import('./hookServer-handlers')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes(): { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; headersSent: boolean } {
  return { writeHead: vi.fn(), end: vi.fn(), headersSent: false }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handlePermissionRequest — project allowlist guard (ADR-013)', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('denies immediately when cwd is not in allowlist', () => {
    mockAssertProjectPathAllowed.mockImplementation(() => { throw new Error('not allowed') })
    const res = makeRes()

    handlePermissionRequest(
      { cwd: '/other/project', tool_name: 'Bash', tool_input: {} },
      res as unknown as import('http').ServerResponse,
      () => null
    )

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
    const body = JSON.parse(res.end.mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(body.hookSpecificOutput.decision.reason).toContain('not managed by this instance')
  })

  it('proceeds when cwd is in allowlist (falls through to no-renderer deny)', () => {
    mockAssertProjectPathAllowed.mockReturnValue(undefined) // no throw
    const res = makeRes()

    handlePermissionRequest(
      { cwd: '/my/project', tool_name: 'Bash', tool_input: {} },
      res as unknown as import('http').ServerResponse,
      () => null
    )

    // Guard passed but no renderer → denied with "No renderer" reason
    const body = JSON.parse(res.end.mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.reason).not.toContain('not managed by this instance')
    expect(body.hookSpecificOutput.decision.reason).toContain('No renderer')
  })

  it('does not check allowlist when cwd is absent', () => {
    const res = makeRes()

    handlePermissionRequest(
      { tool_name: 'Bash', tool_input: {} }, // no cwd field
      res as unknown as import('http').ServerResponse,
      () => null
    )

    expect(mockAssertProjectPathAllowed).not.toHaveBeenCalled()
    const body = JSON.parse(res.end.mock.calls[0][0] as string)
    expect(body.hookSpecificOutput.decision.reason).toContain('No renderer')
  })
})
