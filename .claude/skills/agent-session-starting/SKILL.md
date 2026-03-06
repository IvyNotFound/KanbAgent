---
name: agent-session-starting
description: Start an agent session correctly in agent-viewer. Activates when an agent needs to begin work, when user says "start a session", "launch agent X", "démarrer une session", or when an agent role is invoked and no active session exists. Ensures correct startup sequence: dbstart → read tasks → lock files → begin work.
---

# Agent Session Starting Skill

Handles the full startup sequence for any agent in the agent-viewer multi-agent workflow.

## When to Use

- An agent is about to begin work on a task
- User says "start session", "démarrer session", "lance l'agent X"
- A new Claude Code session opens and the context references an agent role
- After a session interruption that needs to be resumed

## Startup Sequence

### Step 1 — Run dbstart

  node scripts/dbstart.js <agent-name> [type] [scope]

This single call:
- Registers the agent if not yet in DB
- Creates a new session row (status: started)
- Displays agent_id + session_id — save both for all subsequent SQL
- Shows assigned tasks (status: todo) and active locks
- Releases orphaned locks from completed sessions automatically
- Exits with code 2 if the 3-session parallel limit is reached

If exit code is 2: stop. Do not start work. Report the limit to the user.
The limit is configurable per agent via agents.max_sessions in the DB (default 3, -1 = unlimited).
To check or change: node scripts/dbq.js "SELECT name, max_sessions FROM agents WHERE name = '<agent>'"
To raise the limit: node scripts/dbw.js "UPDATE agents SET max_sessions = <N> WHERE name = '<agent>'" (or -1 for unlimited)

### Step 2 — Read Your Assigned Tasks

  SELECT id, title, description, priority, effort FROM tasks
  WHERE agent_assigned_id = :agent_id AND status = 'todo'
  ORDER BY priority DESC, created_at ASC;

If tasks exist → proceed to Step 3 immediately (no questions).
If no tasks → ask the user what to work on, or wait for review to create tickets.

### Step 3 — Read Task Details + Comments

  SELECT title, description FROM tasks WHERE id = :task_id;

  SELECT tc.content, a.name, tc.created_at
  FROM task_comments tc JOIN agents a ON a.id = tc.agent_id
  WHERE tc.task_id = :task_id ORDER BY tc.created_at DESC LIMIT 5;

### Step 4 — Take the Ticket

  UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;

### Step 5 — Lock Files Before Touching Them

  INSERT OR REPLACE INTO locks (file, agent_id, session_id)
  VALUES ('<file>', :agent_id, :session_id);

Lock MUST be placed before any modification. One row per file.

## Agent Roles Reference

| Name | Scope |
|---|---|
| dev-front-vuejs | renderer/ — Vue 3 + TS + Tailwind |
| dev-back-electron | main/ — Electron + Node + SQLite |
| test-front-vuejs | tests renderer |
| test-back-electron | tests main |
| ux-front-vuejs | UX/design renderer |
| review / review-master | global audit + ticket creation |
| arch | ADR, IPC contracts, CLAUDE.md changes |
| doc | README, JSDoc |
| devops | CI/CD, GitHub Actions |

## Rules

- Parallel session limit per agent — enforced by dbstart (exit 2). Default is 3, configurable via agents.max_sessions (-1 = unlimited)
- Always use node scripts/dbq.js for reads, node scripts/dbw.js for writes
- SQL with backticks, $(), or quotes → use heredoc syntax (see WORKFLOW.md)
- Never modify files outside your declared scope
