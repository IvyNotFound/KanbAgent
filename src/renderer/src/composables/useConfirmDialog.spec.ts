/**
 * Tests for useConfirmDialog composable — defensive branches (T1341).
 *
 * Covers: accept/cancel when pending is null, multiple accept() on same pending.
 * Framework: Vitest
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useConfirmDialog } from './useConfirmDialog'

// Reset module-level singleton between tests by calling cancel() if pending
beforeEach(() => {
  const { cancel } = useConfirmDialog()
  cancel()
})

describe('composables/useConfirmDialog', () => {
  it('accept() when pending is null — no exception, pending stays null', () => {
    const { accept, pending } = useConfirmDialog()

    // pending is null at start
    expect(pending.value).toBeNull()

    expect(() => accept()).not.toThrow()
    expect(pending.value).toBeNull()
  })

  it('cancel() when pending is null — no exception, pending stays null', () => {
    const { cancel, pending } = useConfirmDialog()

    expect(pending.value).toBeNull()

    expect(() => cancel()).not.toThrow()
    expect(pending.value).toBeNull()
  })

  it('confirm() → accept() resolves with true', async () => {
    const { confirm, accept } = useConfirmDialog()

    const promise = confirm({ title: 'Are you sure?', message: 'This is permanent.' })
    accept()

    await expect(promise).resolves.toBe(true)
  })

  it('confirm() → cancel() resolves with false', async () => {
    const { confirm, cancel } = useConfirmDialog()

    const promise = confirm({ title: 'Are you sure?', message: 'This is permanent.' })
    cancel()

    await expect(promise).resolves.toBe(false)
  })

  it('pending.value reflects current dialog options', () => {
    const { confirm, pending } = useConfirmDialog()

    const opts = { title: 'Delete?', message: 'Cannot undo.' }
    confirm(opts)

    expect(pending.value).not.toBeNull()
    expect(pending.value?.options).toMatchObject(opts)
  })

  it('second confirm() supersedes first — first resolves with false', async () => {
    const { confirm, accept } = useConfirmDialog()

    const first = confirm({ title: 'First', message: 'First dialog' })
    const second = confirm({ title: 'Second', message: 'Second dialog' })

    // Accept the active (second) dialog
    accept()

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
  })

  it('multiple accept() calls — only first resolves, subsequent are no-ops', async () => {
    const { confirm, accept } = useConfirmDialog()

    const promise = confirm({ title: 'Test', message: 'Test' })
    accept()

    const result = await promise
    expect(result).toBe(true)

    // Second accept() when pending is already null — should not throw
    expect(() => accept()).not.toThrow()
  })

  it('pending is null after accept()', () => {
    const { confirm, accept, pending } = useConfirmDialog()

    confirm({ title: 'T', message: 'M' })
    expect(pending.value).not.toBeNull()

    accept()
    expect(pending.value).toBeNull()
  })

  it('pending is null after cancel()', () => {
    const { confirm, cancel, pending } = useConfirmDialog()

    confirm({ title: 'T', message: 'M' })
    expect(pending.value).not.toBeNull()

    cancel()
    expect(pending.value).toBeNull()
  })
})
