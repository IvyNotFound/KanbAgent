---
name: zombie-session-hunting
description: Diagnose and clean up zombie sessions and orphan locks in agent-viewer. Activates when sessions are stuck, locks are blocking agents, dbstart returns unexpected errors, or user says "sessions bloquées", "locks orphelins", "nettoyer la DB", "kill zombie sessions", "sessions stuck".
---

# Zombie Session Hunting Skill

Diagnose and manually clean zombie sessions and orphan locks in `project.db`.

## When to Use

- dbstart exits with code 2 (session limit) but sessions look inactive
- An agent can't lock a file because another agent holds the lock
- User suspects stale sessions after a crash or forced kill
- Routine maintenance before a multi-agent parallel session

## Step 1 — Diagnose

### Active sessions (started, never closed)
```bash
node scripts/dbq.js "SELECT s.id, a.name, s.started_at, s.summary FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.statut = 'started' ORDER BY s.started_at DESC"
```

### Zombie sessions (started >60min ago, auto-handled by dbstart but check manually)
```bash
node scripts/dbq.js "SELECT s.id, a.name, s.started_at FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.statut = 'started' AND s.ended_at IS NULL AND s.started_at < datetime('now', '-60 minutes')"
```

### Active locks
```bash
node scripts/dbq.js "SELECT l.fichier, a.name, l.created_at, s.statut as session_statut FROM locks l JOIN agents a ON a.id = l.agent_id JOIN sessions s ON s.id = l.session_id WHERE l.released_at IS NULL ORDER BY l.created_at DESC"
```

### Orphan locks (lock held by a completed/blocked session)
```bash
node scripts/dbq.js "SELECT l.fichier, a.name, l.created_at FROM locks l JOIN agents a ON a.id = l.agent_id JOIN sessions s ON s.id = l.session_id WHERE l.released_at IS NULL AND s.statut IN ('completed', 'blocked')"
```

## Step 2 — Clean

### Release orphan locks (safe, always do this first)
```bash
node scripts/dbw.js "UPDATE locks SET released_at = datetime('now') WHERE released_at IS NULL AND session_id IN (SELECT id FROM sessions WHERE statut IN ('completed', 'blocked'))"
```

### Close a specific zombie session manually
```bash
node scripts/dbw.js <<'SQL'
UPDATE locks SET released_at = datetime('now') WHERE session_id = <id> AND released_at IS NULL;
UPDATE sessions SET statut = 'completed', ended_at = datetime('now'), summary = 'Manually closed: zombie session' WHERE id = <id>;
SQL
```

### Nuke all zombies >60min (nuclear option — use only if dbstart auto-cleanup failed)
```bash
node scripts/dbw.js <<'SQL'
UPDATE locks SET released_at = datetime('now')
WHERE released_at IS NULL
  AND session_id IN (SELECT id FROM sessions WHERE statut = 'started' AND started_at < datetime('now', '-60 minutes'));
UPDATE sessions SET statut = 'completed', ended_at = datetime('now'), summary = 'Force-closed: zombie >60min'
WHERE statut = 'started' AND started_at < datetime('now', '-60 minutes');
SQL
```

## Step 3 — Verify

```bash
node scripts/dbq.js "SELECT COUNT(*) as active_sessions FROM sessions WHERE statut = 'started'"
node scripts/dbq.js "SELECT COUNT(*) as active_locks FROM locks WHERE released_at IS NULL"
```

Both should return reasonable numbers (0 if cleanup was total).

## Decision Tree

```
Lock blocking agent?
├─ Lock from completed/blocked session → Release orphan locks (Step 2, option 1)
├─ Lock from started session >60min → Close zombie + release (Step 2, option 2)
└─ Lock from active session → Real conflict → coordinate with the other agent

dbstart exit code 2?
├─ Check active sessions → some are >60min? → nuclear option
├─ All sessions recent → Real parallel limit → close one voluntarily
└─ max_sessions = -1 in DB? → No limit, shouldn't happen
```

## Prevention

After any forced kill of a Claude Code session:
1. Run the orphan locks query immediately
2. Close the dangling session manually
3. Verify before starting new sessions
