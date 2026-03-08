# Ticket Workflow — Full SQL Reference

> Statuses: `todo` → `in_progress` → `done` → `archived` (rejected → back to `todo`)
> Quick summary → `CLAUDE.md` · Session input → `sessions.summary`

---

## Schema (project.db)

> **Consult before writing SQL.** Never guess column names.

```
agents          (id PK, name, type, scope, system_prompt, system_prompt_suffix, thinking_mode, allowed_tools, created_at)
sessions        (id PK, agent_id→agents, started_at, ended_at, updated_at, status CHECK(status IN ('started','completed','blocked')), summary, claude_conv_id, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write)
tasks           (id PK, title, description, status, agent_creator_id→agents, agent_assigned_id→agents, agent_validator_id→agents, parent_task_id→tasks, session_id→sessions, scope, effort, priority, created_at, updated_at, started_at, completed_at, validated_at)
task_comments   (id PK, task_id→tasks, agent_id→agents, content, created_at)
task_links      (id PK, from_task→tasks, to_task→tasks, type CHECK(type IN ('blocks','depends_on','related_to','duplicates')), created_at)
locks           (id PK, file, agent_id→agents, session_id→sessions, created_at, released_at)
agent_logs      (id PK, session_id→sessions, agent_id→agents, level, action, detail, files, created_at)
scopes          (id PK, name, folder, techno, description, active, created_at)
config          (key PK, value, updated_at)
```

> **Pitfalls:** `tasks` does **not** have `agent_id` → use `agent_assigned_id`. `task_comments.agent_id` (not `auteur_agent_id`).

---

## Execution

```bash
node scripts/dbq.js "<SQL>"   # read (better-sqlite3, WAL mode)
node scripts/dbw.js "<SQL>"   # write
```

> **⚠ SQL containing backticks, `$()` or quotes**: do NOT pass as a positional argument.
> Use **stdin mode (heredoc)** to prevent bash from interpreting special characters:
>
> ```bash
> node scripts/dbw.js <<'SQL'
> INSERT INTO tasks (title, description, status, agent_creator_id, scope, effort, priority)
> VALUES ('fix(terminal): my title', 'Description with backticks `code` and $(variables) and ''single quotes''', 'todo', (SELECT id FROM agents WHERE name = 'review'), 'back-electron', 1, 'normal');
> SQL
> ```
>
> The `<<'SQL'` heredoc (quotes around delimiter) disables **all** shell interpretation.
> Same syntax for `dbq.js` reads.

---

## Reusable SQL Primitives

```sql
-- Add a comment to a ticket
INSERT INTO task_comments (task_id, agent_id, content) VALUES (:task_id, :agent_id, '<content>');

-- Lock a file (BEFORE modification)
INSERT OR REPLACE INTO locks (file, agent_id, session_id) VALUES ('<file>', :agent_id, :session_id);

-- Release all locks
UPDATE locks SET released_at = CURRENT_TIMESTAMP WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;

-- Log (optional, omit if context is limited)
INSERT INTO agent_logs (session_id, agent_id, level, action, detail) VALUES (:session_id, :agent_id, 'info', '<action>', '<detail>');
```

---

## Steps

### 1. Review creates the ticket

```sql
INSERT INTO tasks (title, description, status, agent_creator_id, agent_assigned_id, scope)
VALUES ('<title>', '<full description: context, symptoms, acceptance criteria>', 'todo',
  (SELECT id FROM agents WHERE name = '<review>'),
  (SELECT id FROM agents WHERE name = '<target-agent>'), '<scope>');
-- + comment (risks, dependencies) via primitive
```

> Description should be as verbose as possible — an agent with no context must be able to complete the ticket alone.

### 2. Agent starts their session

```bash
node scripts/dbstart.js <agent> [type] [scope]
```

> Does everything in one call: registers the agent, creates the session, displays `agent_id` + `session_id`, previous session, assigned tasks, active locks.
> Tasks found → start immediately. Questions only if no tasks AND type cannot be inferred.

> **⚠ Parallel session limit**: max 3 active sessions per agent — enforced by `dbstart.js` (exit code 2 if limit reached).

### 3. Agent takes the ticket

```sql
SELECT title, description FROM tasks WHERE id = :task_id;
SELECT tc.content, a.name, tc.created_at FROM task_comments tc
  JOIN agents a ON a.id = tc.agent_id WHERE tc.task_id = :task_id ORDER BY tc.created_at DESC LIMIT 5;
UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + lock files via primitive
```

> Lock must be placed **before** any modification.

### 4. Agent completes the ticket

> **⚠ Mandatory order: comment FIRST, then `done`.**
> If the session expires between the two calls, the comment is already persisted. Reversing the order risks `done` with no comment (cf. T430, T437, T438).

```bash
# Recommended: a single heredoc to reduce required turns
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content)
  VALUES (:task_id, :agent_id, 'files:lines · done · choices · remaining · to validate');
UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
SQL
# + release locks via primitive
```

> After `done` → check backlog. Remaining tasks → **chain without closing the session** (`/clear` + PTY reset, then take the next one). Only close the session (step 5) **if**: no remaining tasks, or task is blocked (dependency, lock, waiting for review).

### 5. Agent closes their session

```sql
-- 1. Record consumed tokens (REQUIRED before closing)
--    Source: summary displayed by Claude Code at end of conversation
--    Line "Tokens: X in, Y cache_read, Z cache_write, W out"
UPDATE sessions SET tokens_in=X, tokens_out=Y, tokens_cache_read=Z, tokens_cache_write=W WHERE id=:session_id;

-- 2. Release locks via primitive
-- 3. Close the session
UPDATE sessions SET status = 'completed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
  summary = 'Done:<accomplished>. Pending:<tickets>. Next:<action>.' WHERE id = :session_id;
```

> `summary` must be self-contained (max 200 chars) — an agent resuming without context must know where things stand.
>
> **⚠ Tokens required**: record tokens BEFORE closing (`tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`). Values are displayed by Claude Code at the end of each conversation. If the value is unknown (interrupted session), set to 0.
>
> **⚠ Locks required**: release **all** locks before ending the session. `dbstart.js` automatically releases orphaned locks from completed sessions at startup, but agents must release their own locks in step 5.

### 6. Review validates or rejects

```sql
-- OK: archive
UPDATE tasks SET status = 'archived', agent_validator_id = (SELECT id FROM agents WHERE name = '<review>'),
  validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + comment 'ARCHIVED — <observations>'

-- KO: reject
UPDATE tasks SET status = 'todo', updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + comment 'REJECTED — <precise reason, expected corrections, re-validation criteria>'
```
