---
name: ticket-completing
description: Complete a task ticket in agent-viewer following the mandatory order. Activates when an agent finishes work on a task, when user says "mark as done", "ticket terminé", "fermer le ticket", "close task". Enforces comment-first then done order, lock release, session closure, and backlog check.
---

# Ticket Completing Skill

Handles the mandatory completion sequence for agent-viewer tickets. Order is critical — deviating from it causes data integrity issues (cf. T430, T437, T438).

## When to Use

- Agent finishes implementing a task
- User says "done", "terminé", "close the ticket", "marquer done"
- Work on a ticket is complete and ready for review

## ⚠ Mandatory Order: Comment FIRST, then `done`

If the session expires between the two calls, the comment is already persisted.
Reversing the order risks `done` with no comment.

## Completion Sequence

### Step 1 — Write the Completion Comment FIRST

Use a single heredoc to atomically write comment + status in one call:

```bash
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, contenu)
  VALUES (:task_id, :agent_id, '<comment — see format below>');
UPDATE tasks SET statut = 'done', completed_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
SQL
```

### Comment Format

```
files:lines · done · choices · remaining · to validate
```

Be specific and self-contained. Example:
```
src/main/ipc-agents.ts:45-67 · Added getAgentGroups handler · Used LEFT JOIN for nullable parent_id · No migration needed · Validate: call from renderer returns nested groups correctly
```

### Step 2 — Release Locks

```bash
node scripts/dbw.js <<'SQL'
UPDATE locks SET released_at = CURRENT_TIMESTAMP
WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;
SQL
```

### Step 3 — Check the Backlog

```sql
SELECT id, titre, priority FROM tasks
WHERE agent_assigne_id = :agent_id AND statut = 'todo'
ORDER BY priority DESC, created_at ASC LIMIT 5;
```

**If remaining tasks exist:**
→ Chain immediately without closing the session
→ `/clear` + PTY reset, then take the next ticket (see agent-session-starting skill for steps 3-5)
→ Do NOT close the session yet

**If no remaining tasks:**
→ Proceed to Step 4

### Step 4 — Close the Session (only if no tasks remain or blocked)

```bash
node scripts/dbw.js <<'SQL'
UPDATE sessions SET
  tokens_in = <X>,
  tokens_out = <Y>,
  tokens_cache_read = <Z>,
  tokens_cache_write = <W>,
  statut = 'completed',
  ended_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP,
  summary = 'Done:<accomplished>. Pending:<tickets>. Next:<action>.'
WHERE id = :session_id;
SQL
```

**Token values:** displayed by Claude Code at end of conversation as:
`Tokens: X in, Y cache_read, Z cache_write, W out`
If unknown (interrupted session) → set to 0.

**Summary format:** max 200 chars, self-contained. Example:
`Done:T912 IPC handler for agent groups. Pending:none. Next:review to validate nested group queries.`

## Edge Cases

### Ticket rejected by review
```sql
-- review sets statut back to 'todo' with a comment
-- agent re-reads the rejection comment, fixes, and re-completes using this skill
SELECT tc.contenu FROM task_comments tc WHERE tc.task_id = :task_id ORDER BY tc.created_at DESC LIMIT 3;
```

### Session blocked (dependency, lock conflict)
```sql
UPDATE sessions SET statut = 'blocked', updated_at = CURRENT_TIMESTAMP,
  summary = 'Blocked:<reason>. Waiting:<what>.' WHERE id = :session_id;
```
Then release locks and stop. Do not mark the task as done.
