# CLAUDE.md — KanbAgent

> Read-only except `setup` (init) and `arch` (structural revisions). Living state → `.claude/project.db`. Refs → `.claude/ADRS.md` · `.claude/WORKFLOW.md`

---

## Configuration

MODE: solo · LANG_CONV: english · LANG_CODE: english · LANG_COMMIT: english · Solo: `review` = `review-master`.

> `LANG_COMMIT: english` — commit messages (subject + body) and auto-generated CHANGELOG are always in English.

---

## Project

**KanbAgent** — Desktop interface Trello/Jira visualizing Claude agent tasks (SQLite). Electron, dark mode, no auth.

Scopes: `front-vuejs` (`renderer/`, Vue 3 + TS + Vuetify 3 (Material Design 3), key files: `App.vue`, `vite.config.ts`) · `back-electron` (`main/`, Electron + Node + SQLite, key files: `index.ts`, `ipc.ts`)

Conventions: english (conv & code) · mandatory tests · Conventional Commits

**Version: `0.36.0`** | Lead: IvyNotFound → `main` | `npm run dev/build/test/release` | Beta: MAJOR → `arch` + lead validation.

---

## Release

`npm run release` (patch) · `npm run release:patch/minor/major`

**Prerequisites:** clean `main` branch · 0 `todo`/`in_progress` tickets · `npm run build` OK

**Script actions:** branch check → build + lint → version bump → CHANGELOG → commit + tag → push → draft GitHub Release

**Post-release:** publish draft manually → attach binaries (.exe, .dmg) if available

| Type | When |
|---|---|
| PATCH | fix, perf, refactor (no breaking change) |
| MINOR | backward-compatible feat |
| MAJOR | breaking change (DB schema, IPC refactor) — `arch` + lead validation mandatory |

---

## Agents

Global: **review-master** (global audit) · **review** (scope) · **devops** (CI/CD) · **arch** (ADR, IPC, CLAUDE.md) · **doc** (README/JSDoc) · **setup** (one-time init) · **infra-prod** (prod, mandatory human validation)

Scoped: `dev-front-vuejs` (Vue) · `dev-back-electron` (IPC/SQLite) · `test-front-vuejs` · `test-back-electron` · `ux-front-vuejs`

Thinking mode (DB `thinking_mode`, NULL=auto): `test/doc/devops` → disabled · others → auto. Values: `auto | disabled`. Injection: `--settings '{"alwaysThinkingEnabled":false}'` (ADR-002).

---

## DB Access

⚠️ **NEVER modify DB schema directly** (`ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`) — only via versioned migrations in `migration-runner.ts`. Data writes (`INSERT`, `UPDATE`) via `dbw.js` use better-sqlite3 (direct file access, WAL mode).

`node scripts/dbq.js "<SQL>"` (read) · `node scripts/dbw.js "<SQL>"` (write)

Simple SQL: direct argument. Complex SQL (quotes, `$()`, multiline) → **heredoc required**:
```
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content) VALUES (1, 2, 'text');
SQL
```
Session start: `node scripts/dbstart.js <agent-name>` — creates session, displays tasks.

---

## Ticket workflow

`todo` → `in_progress` → `done` → `archived` (rejected → back to `todo`)

1. **review** creates ticket (title + description + risk comment)
2. Agent starts immediately on assigned tickets
3. Agent writes exit comment **FIRST** · then `done`
4. **review** archives or rejects (`todo` + precise reason)

---

## Agent worktree

When a dedicated worktree is active (`.claude/worktrees/s<sessionId>/`):

- **Dev (src/)** → work exclusively from `primaryWorkingDirectory` (= `.claude/worktrees/s<sessionId>/`)
- **DB (scripts/)** → `cd <main-repo> && node scripts/dbq.js ...` — always from the main repo
- Never modify source files from the main repo when a worktree is active

**Review**: when validating a worktree ticket, do not look for files on `main` — they are on the agent branch.

Inspection protocol (in order):
1. SHA hash in exit comment → `git cat-file -t <sha>` to confirm existence
2. If agent branch exists: `git diff --name-only main...agent/<name>/s<session_id>` · `git show <sha>:path`
3. If commit is orphaned (worktree removed without push): `git show <sha>:path` works directly as long as the object is not garbage-collected. To find an unknown sha: `git fsck --lost-found 2>&1 | grep "dangling commit"` then filter by message.
4. **Never reject "file absent" without checking the sha** via `git cat-file -t <sha>`.

Merge to main **only if** validation OK (see WORKFLOW.md step 6).

---

## Inter-agent rules

- One agent = one scope — never overflow without signaling
- IPC Electron ↔ Vue interfaces → go through `arch` before implementing
- `infra-prod`: explicit human confirmation before any action
