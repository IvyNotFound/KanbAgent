/**
 * Tests for hookServer — JSONL transcript parsing (T737) + exports (T741) + WSL fix (T858)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseTokensFromJSONL, HOOK_PORT, detectWslGatewayIp, injectHookUrls, resolvePermission, pendingPermissions, MAX_PENDING_PERMISSIONS } from './hookServer'

// ── Hoisted mocks (must be declared before vi.mock, which are hoisted) ────────
const { mockNetworkInterfaces, mockReadFile, mockWriteFile, mockMkdir, mockExecSync } = vi.hoisted(() => ({
  mockNetworkInterfaces: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockExecSync: vi.fn(),
}))

vi.mock('os', () => ({
  default: { networkInterfaces: mockNetworkInterfaces },
  networkInterfaces: mockNetworkInterfaces,
}))

vi.mock('child_process', () => ({
  default: { execSync: mockExecSync },
  execSync: mockExecSync,
}))

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

// ── Constants ─────────────────────────────────────────────────────────────────

describe('resolvePermission', () => {
  afterEach(() => {
    // Clean up any pending permissions left by tests
    for (const [id, p] of pendingPermissions) {
      clearTimeout(p.timer)
      pendingPermissions.delete(id)
    }
  })

  it('returns false for unknown permissionId', () => {
    expect(resolvePermission('nonexistent', { behavior: 'allow' })).toBe(false)
  })

  it('resolves a pending permission and returns true', async () => {
    const decision = { behavior: 'allow' as const }
    let resolvedValue: { behavior: string } | undefined

    const promise = new Promise<{ behavior: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ behavior: 'deny' }), 60_000)
      pendingPermissions.set('test-1', { resolve, timer })
    })
    promise.then((v) => { resolvedValue = v })

    const result = resolvePermission('test-1', decision)
    expect(result).toBe(true)
    expect(pendingPermissions.has('test-1')).toBe(false)

    // Let the microtask resolve
    await promise
    expect(resolvedValue?.behavior).toBe('allow')
  })

  it('returns false on second call for same permissionId (already consumed)', () => {
    const timer = setTimeout(() => {}, 60_000)
    pendingPermissions.set('test-2', { resolve: () => {}, timer })

    expect(resolvePermission('test-2', { behavior: 'deny' })).toBe(true)
    expect(resolvePermission('test-2', { behavior: 'allow' })).toBe(false)
  })

  it('clears the timeout when resolved', () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    const timer = setTimeout(() => {}, 60_000)
    pendingPermissions.set('test-3', { resolve: () => {}, timer })

    resolvePermission('test-3', { behavior: 'allow' })

    expect(clearSpy).toHaveBeenCalledWith(timer)
    clearSpy.mockRestore()
  })
})

// ── MAX_PENDING_PERMISSIONS (T1853) ──────────────────────────────────────────

describe('MAX_PENDING_PERMISSIONS', () => {
  afterEach(() => {
    for (const [id, p] of pendingPermissions) {
      clearTimeout(p.timer)
      pendingPermissions.delete(id)
    }
  })

  it('exports MAX_PENDING_PERMISSIONS as 50', () => {
    expect(MAX_PENDING_PERMISSIONS).toBe(50)
  })

  it('pendingPermissions map enforces no hard limit itself (guard is in handlePermissionRequest)', () => {
    // Fill the map to capacity to verify the constant is usable as a threshold
    for (let i = 0; i < MAX_PENDING_PERMISSIONS; i++) {
      const timer = setTimeout(() => {}, 60_000)
      pendingPermissions.set(`cap-test-${i}`, { resolve: () => {}, timer })
    }
    expect(pendingPermissions.size).toBe(MAX_PENDING_PERMISSIONS)
  })
})
