# CLAUDE.md — [project-name]

> Read-only except `setup` (init) and `arch` (structural revisions). Live state → `.claude/project.db`. Refs → `.claude/ADRS.md` · `.claude/WORKFLOW.md`

---

## Configuration

MODE: solo · LANG_CONV: français · LANG_CODE: english · Solo: `review` = `review-master`.

---

## Project

**[project-name]** — [Short project description.]

Scopes: `front-vuejs` (`renderer/`, Vue 3 + TS + Tailwind) · `back-electron` (`main/`, Electron + Node + SQLite)

Conventions: français (conv) · english (code) · mandatory tests · 0 lint · Conventional Commits

**Version: `0.1.0`** | Lead: [github-username] → `main` | `npm run dev/build/test/lint/release`

---

## Agents

Global: **review-master** (global audit) · **review** (scope) · **devops** (CI/CD) · **arch** (ADR, IPC, CLAUDE.md) · **doc** (README/JSDoc) · **setup** (one-time init)

Scoped: `dev-front-vuejs` (Vue) · `dev-back-electron` (IPC/SQLite)

---

## DB Access

`node scripts/dbq.js "<SQL>"` (read) · `node scripts/dbw.js "<SQL>"` (write)

Complex SQL → **heredoc required**:
```
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, 2, 'text');
SQL
```
Start session: `node scripts/dbstart.js <agent-name>`

---

## Ticket Workflow

`todo` → `in_progress` → `done` → `archived` (rejected → back to `todo`)

1. **review** creates ticket (title + description + risk comment)
2. Agent starts immediately on assigned tickets
3. Agent writes exit comment **FIRST** · then `done`
4. **review** archives or rejects (`todo` + precise reason)

---

## Inter-Agent Rules

- One agent = one scope — never overflow without signaling
- IPC Electron ↔ Vue interfaces → go through `arch` before implementing
