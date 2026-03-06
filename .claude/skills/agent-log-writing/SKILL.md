---
name: agent-log-writing
description: Write agent_logs entries correctly in agent-viewer. Activates when an agent needs to log an action, when completing a task, starting a session, or when agent_logs entries are missing. Triggers on "log this", "insert agent_log", "ajouter un log", or any task_started/task_done/session_end event.
---

# Agent Log Writing Skill

Correct insertion of `agent_logs` entries for agent-viewer. Mandatory at minimum for 2 events per task.

## Mandatory Events (minimum per task)

| Event | When | niveau |
|---|---|---|
| `task_started` | Right after `UPDATE tasks SET statut='in_progress'` | `info` |
| `task_done` | Right before `UPDATE tasks SET statut='done'` | `info` |

## Additional Events (situational)

| Event | When | niveau |
|---|---|---|
| `session_start` | review/devops: start of session | `info` |
| `task_archived` | review: after archiving a ticket | `info` |
| `task_rejected` | review: after rejecting a ticket | `warn` |
| `task_created` | review/task-creator: after creating a ticket | `info` |
| `session_end` | review/devops: just before closing session | `info` |

## SQL Pattern

```bash
node scripts/dbw.js <<'SQL'
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at)
VALUES (<session_id>, <agent_id>, '<niveau>', '<action>', '<detail>', CURRENT_TIMESTAMP);
SQL
```

## Concrete Examples

```sql
-- task_started
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at)
VALUES (42, 3, 'info', 'task_started', 'T912: feat(ipc): add agent-groups handler', CURRENT_TIMESTAMP);

-- task_done
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at)
VALUES (42, 3, 'info', 'task_done', 'T912: feat(ipc): add agent-groups handler', CURRENT_TIMESTAMP);

-- review: task_archived
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at)
VALUES (55, 4, 'info', 'task_archived', 'T912 archived: implementation correct', CURRENT_TIMESTAMP);

-- review: task_rejected
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at)
VALUES (55, 4, 'warn', 'task_rejected', 'T912 rejected: missing input validation in handler', CURRENT_TIMESTAMP);

-- review: session_end
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at)
VALUES (55, 4, 'info', 'session_end', 'Session done. Archived:2 Rejected:1', CURRENT_TIMESTAMP);
```

## Hard Rules

- `session_id` and `agent_id` are **NOT NULL** — always populate them
- `fichiers` = NULL unless the action is specifically about a file
- Never omit `task_started` + `task_done` — review will flag missing logs
- For chained tasks (multiple tickets in one session): one pair per ticket
- Use heredoc syntax for detail strings containing backticks or quotes

## Chained Task Pattern

When chaining multiple tasks in one session without `/clear`:

```sql
-- End of task 1
INSERT INTO agent_logs (...) VALUES (<sid>, <aid>, 'info', 'task_done', 'T910: ...', CURRENT_TIMESTAMP);
UPDATE tasks SET statut='done' ... WHERE id=910;

-- Start of task 2 (immediately after)
INSERT INTO agent_logs (...) VALUES (<sid>, <aid>, 'info', 'task_started', 'T911: ...', CURRENT_TIMESTAMP);
UPDATE tasks SET statut='in_progress' ... WHERE id=911;
```

Same `session_id` throughout — only `task_id` changes.
