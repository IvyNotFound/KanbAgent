---
name: migration-creating
description: Create a versioned SQLite migration for agent-viewer. Activates when the DB schema needs to change, when user says "add a column", "create a table", "migration", "alter schema", "ajouter une colonne", "modifier le schéma". Follows the existing migration pattern with idempotency and better-sqlite3 compatibility.
---

# Migration Creating Skill

Creates properly versioned, idempotent SQLite migrations for agent-viewer following the established pattern in `src/main/migrations/`.

## When to Use

- Adding a column to an existing table
- Creating a new table
- Modifying constraints (via table recreation)
- Any schema change that must survive across app versions

## Migration Conventions

### File Naming

```
src/main/migrations/v<N>-<kebab-description>.ts
```

Where `<N>` is the next version number after the highest existing `v*.ts` file.

Check current latest:
```bash
ls src/main/migrations/
```

### File Structure (based on existing pattern)

```typescript
import type { MigrationDb } from '../migration-db-adapter'
type Database = MigrationDb

/**
 * Migration: <one-line description> (T<ticket-id>).
 *
 * <Detailed explanation of what changes and why.>
 * <Note SQLite limitations if relevant (e.g., no inline FK on ALTER TABLE).>
 * <Note integrity enforcement strategy if FK not possible.>
 *
 * Idempotent: returns false if <condition already met>.
 *
 * @returns true if migration applied, false if already present.
 */
export function run<PascalCaseName>Migration(db: Database): boolean {
  // Idempotency check FIRST — always
  // ...

  // Apply migration
  // ...

  return true
}
```

### Idempotency Patterns

**Check column existence (ALTER TABLE):**
```typescript
const colResult = db.exec('PRAGMA table_info(<table_name>)')
if (colResult.length === 0 || colResult[0].values.length === 0) return false
const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
if (cols.has('<column_name>')) return false
db.run('ALTER TABLE <table_name> ADD COLUMN <column_name> <type>')
return true
```

**Check table existence (CREATE TABLE):**
```typescript
const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='<table_name>'")
if (result.length > 0 && result[0].values.length > 0) return false
db.run(`CREATE TABLE <table_name> (...)`)
return true
```

### SQLite Limitations to Know

- `ALTER TABLE` only supports `ADD COLUMN` — no rename column, no drop column, no add constraint
- No inline FK constraints when using `ADD COLUMN` — enforce in application code (IPC handlers)
- To rename/drop/add constraints → table recreation pattern (CREATE new → INSERT SELECT → DROP old → RENAME)
- `NOT NULL` on `ADD COLUMN` requires a DEFAULT value

### Registration

After creating the migration file, register it in `src/main/migration-runner.ts`:

```typescript
import { run<PascalCaseName>Migration } from './migrations/v<N>-<kebab-description>'

// Add to the migrations array in order:
{ version: <N>, run: run<PascalCaseName>Migration },
```

Check the current runner to find the array:
```bash
cat src/main/migration-runner.ts
```

## Testing

Migrations must be tested. Check `src/main/migration.spec.ts` for the existing pattern. Typically:

```typescript
it('adds <column> to <table>', () => {
  const result = runMyMigration(db)
  expect(result).toBe(true)
  // verify column exists
  const info = db.exec('PRAGMA table_info(<table>)')
  const cols = info[0].values.map(r => r[1])
  expect(cols).toContain('<column>')
})

it('is idempotent', () => {
  runMyMigration(db)
  const result = runMyMigration(db) // second call
  expect(result).toBe(false) // should not throw, should return false
})
```

## Checklist

- [ ] File named `v<N>-<description>.ts` with correct next version number
- [ ] Export function named `run<PascalCaseName>Migration`
- [ ] JSDoc with ticket reference (T<id>)
- [ ] Idempotency check at the top
- [ ] SQLite limitations noted in JSDoc if relevant
- [ ] Registered in `migration-runner.ts`
- [ ] Tests written (both apply + idempotency)

