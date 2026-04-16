import { describe, it, expect, vi } from 'vitest'
import type { MigrationDb } from '../migration-db-adapter'
import { runAddSessionsStatusEndedIndexMigration } from './v41-sessions-status-ended-index'

type MockDb = {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    exec: vi.fn().mockReturnValue([]),
    run: vi.fn(),
    getRowsModified: vi.fn().mockReturnValue(0),
    prepare: vi.fn(),
    close: vi.fn(),
    ...overrides,
  }
}

function asDb(db: MockDb): MigrationDb {
  return db as unknown as MigrationDb
}

describe('runAddSessionsStatusEndedIndexMigration', () => {
  it('calls db.run once with CREATE INDEX IF NOT EXISTS', () => {
    const db = makeDb()
    runAddSessionsStatusEndedIndexMigration(asDb(db))
    expect(db.run).toHaveBeenCalledOnce()
  })

  it('creates index idx_sessions_status_ended on sessions(status, ended_at DESC)', () => {
    const db = makeDb()
    runAddSessionsStatusEndedIndexMigration(asDb(db))
    const sql = (db.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS')
    expect(sql).toContain('idx_sessions_status_ended')
    expect(sql).toContain('sessions')
    expect(sql).toContain('status')
    expect(sql).toContain('ended_at')
  })

  it('is idempotent — IF NOT EXISTS prevents duplicate index errors', () => {
    const db = makeDb()
    // Run twice — should not throw
    runAddSessionsStatusEndedIndexMigration(asDb(db))
    runAddSessionsStatusEndedIndexMigration(asDb(db))
    expect(db.run).toHaveBeenCalledTimes(2)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.every(s => s.includes('IF NOT EXISTS'))).toBe(true)
  })
})
