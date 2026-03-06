# Contributing to agent-viewer

Thank you for your interest in agent-viewer! This guide details the conventions and procedures for contributing to the project.

## Table of Contents

1. [Development Workflow](#development-workflow)
2. [Code Conventions](#code-conventions)
3. [IPC Architecture](#ipc-architecture)
4. [Tests](#tests)
5. [Creating a Task](#creating-a-task)
6. [Launching a Claude Agent](#launching-a-claude-agent)
7. [Versioning](#versioning)

---

## Development Workflow

agent-viewer uses a ticket-based workflow stored in the project's SQLite database.

### Task Lifecycle

```
todo → in_progress → done → archived
                       ↘ (rejected) → todo
```

| Status | Description |
|--------|-------------|
| `todo` | Task to be done |
| `in_progress` | Task currently being processed |
| `done` | Task completed, awaiting validation |
| `archived` | Task validated and archived |

### Steps for a Developer

1. **Select a task** — Pick an assigned `todo` task
2. **Lock files** — Before any modification
3. **Work on the task** — Implement, test
4. **Complete the task** — Mandatory exit comment (via `task_comments`)
5. **Release locks** — At end of session

### Useful SQL Queries

```sql
-- View assigned tasks
SELECT id, title, status FROM tasks
WHERE agent_assigned_id = (SELECT id FROM agents WHERE name = 'dev-front-vuejs')
AND status IN ('todo', 'in_progress');

-- Set a task in progress
UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
WHERE id = 42;

-- Lock a file
INSERT OR REPLACE INTO locks (file, agent_id, session_id)
VALUES ('src/renderer/src/App.vue', 1, 10);

-- Complete a task
UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP
WHERE id = 42;

-- Exit comment (mandatory)
INSERT INTO task_comments (task_id, agent_id, content)
VALUES (42, 1, 'App.vue:L1-50 · Added new component · Next: add tests');
```

---

## Code Conventions

### Language

- **User documentation**: English
- **Code and inline comments**: English
- **Commit messages**: English (Conventional Commits)

### Code Style

| Category | Convention |
|----------|------------|
| TypeScript | Strict, no implicit `any` |
| ESLint | v9 config (flat config) — `eslint.config.mjs` |
| Vue | Composition API only |
| CSS | Tailwind CSS v4 (utility classes) |
| Tests | Vitest (configured — `vitest.config.ts`) |

### Conventional Commits

```bash
feat:     # New feature
fix:      # Bug fix
chore:    # Maintenance, dependency
docs:     # Documentation
refactor: # Refactoring
test:     # Tests
perf:     # Performance
style:    # Formatting
build:    # Build system, CI
```

Examples:

```bash
feat: add drag-and-drop mode on task cards
fix: fix crash on terminal close
docs: update README with new commands
```

---

## IPC Architecture

### Security Principles

- **contextIsolation**: enabled
- **nodeIntegration**: disabled
- **sandbox**: enabled
- **All Node.js access**: via IPC only
- **No direct filesystem access** from the renderer

### IPC Handlers — `src/main/ipc-db.ts`

| Handler | Description |
|---------|-------------|
| `query-db` | Read-only SQL query on the DB (write keywords blocked) |
| `watch-db` | Watch DB file changes — emits `db-changed` to all windows |
| `unwatch-db` | Stop watching, clear DB cache entry |
| `migrate-db` | Run all pending schema migrations |
| `get-locks` | Return active (unreleased) locks with agent names |

### IPC Handlers — `src/main/ipc-project.ts`

| Handler | Description |
|---------|-------------|
| `select-project-dir` | Native directory picker — registers path and finds DB |
| `select-new-project-dir` | Directory picker for a new project (with create option) |
| `create-project-db` | Create a blank SQLite DB in `.claude/` with default agents |
| `find-project-db` | Locate `project.db` inside `.claude/` |
| `init-new-project` | Create `.claude/` dir and download `CLAUDE.md` from GitHub |
| `project:exportZip` | Export `project.db` as a ZIP archive to Downloads |

### IPC Handlers — `src/main/ipc-window.ts`

| Handler | Description |
|---------|-------------|
| `window-minimize` | Minimize the focused window |
| `window-maximize` | Toggle maximize/restore |
| `window-close` | Close the focused window |
| `window-is-maximized` | Return maximized state |
| `show-confirm-dialog` | Show a native confirmation dialog |
| `shell:openExternal` | Open a URL in the default browser (https only) |

### IPC Handlers — `src/main/ipc-fs.ts`

| Handler | Description |
|---------|-------------|
| `fs:listDir` | List a directory (max 4 levels, restricted to project) |
| `fs:readFile` | Read a text file (restricted to project directory) |
| `fs:writeFile` | Write a text file (sensitive paths blocked) |

### IPC Handlers — `src/main/ipc-settings.ts`

| Handler | Description |
|---------|-------------|
| `get-config-value` | Read a key from the `config` table |
| `set-config-value` | Write a key to the `config` table |
| `check-for-updates` | Check GitHub releases for a newer version |

### IPC Handlers — `src/main/ipc-agents.ts` (facade → sub-modules)

#### `ipc-agent-crud.ts` — Agent CRUD

| Handler | Description |
|---------|-------------|
| `create-agent` | Create agent + insert into CLAUDE.md |
| `delete-agent` | Delete agent if it has no history |
| `rename-agent` | Rename an agent |
| `update-agent` | Bulk update agent fields (name, type, scope, prompt…) |
| `agent:duplicate` | Duplicate an agent with a unique name |
| `get-agent-system-prompt` | Fetch prompt, suffix, thinking_mode, permission_mode |
| `update-agent-system-prompt` | Update system_prompt for an agent |
| `update-agent-thinking-mode` | Set thinking_mode (`auto`\|`disabled`\|null) |

#### `ipc-agent-groups.ts` — Agent groups

| Handler | Description |
|---------|-------------|
| `agent-groups:list` | List all groups with members |
| `agent-groups:create` | Create a group (supports parent_id for nesting) |
| `agent-groups:rename` | Rename a group |
| `agent-groups:delete` | Delete a group and its members |
| `agent-groups:setMember` | Assign/remove an agent from a group |
| `agent-groups:reorder` | Reorder groups by sort_order |
| `agent-groups:setParent` | Move a group in the hierarchy (cycle detection) |

#### `ipc-agent-sessions.ts` — Sessions & tokens

| Handler | Description |
|---------|-------------|
| `session:setConvId` | Store Claude Code conv UUID for `--resume` support |
| `session:parseTokens` | Parse JSONL file and persist token counts for a session |
| `session:syncAllTokens` | Retroactively sync tokens for all sessions with a conv_id |
| `session:collectTokens` | Collect tokens for the latest session of an agent |

#### `ipc-agent-tasks.ts` — Tasks, perimeters & prompts

| Handler | Description |
|---------|-------------|
| `close-agent-sessions` | Mark all started sessions as completed for an agent |
| `update-perimetre` | Update perimeter name/description with cascade |
| `add-perimetre` | Insert a new perimeter |
| `build-agent-prompt` | Build launch prompt with session context + task list |
| `task:getAssignees` | Get all agents assigned to a task (with role) |
| `task:setAssignees` | Atomically replace a task's assignee list |
| `task:getLinks` | Get dependency links for a task |
| `search-tasks` | Full-text search tasks with FTS4 / LIKE fallback |

### IPC Handlers — `src/main/ipc-session-stats.ts`

| Handler | Description |
|---------|-------------|
| `session:updateResult` | Persist cost_usd, duration_ms, num_turns from Claude result event |
| `sessions:statsCost` | Aggregate cost/token stats per agent and period |
| `tasks:getArchived` | Paginated archived tasks query (page, pageSize, optional filters) |
| `tasks:qualityStats` | Rejection rate per agent (heuristic-based) |
| `tasks:updateStatus` | Update a task status (drag & drop) with blocker check |

### IPC Handlers — Utility modules

| Module | Handler | Description |
|--------|---------|-------------|
| `ipc-git.ts` | `git:log` | Run `git log` and return parsed commits (limit 1–500) |
| `ipc-telemetry.ts` | `telemetry:scan` | Recursively scan project directory for per-language statistics |
| `ipc-wsl.ts` | `wsl:getClaudeInstances` | Detect Claude Code instances (local + WSL distros) |
| `ipc-wsl.ts` | `wsl:openTerminal` | Open an external WSL terminal window |
| `updater.ts` | `updater:check` | Trigger an update check via electron-updater |
| `updater.ts` | `updater:download` | Start downloading the available update |
| `updater.ts` | `updater:install` | Quit and install the downloaded update |

### IPC Events (main → renderer)

| Event | Description |
|-------|-------------|
| `db-changed` | DB changed on disk (triggers store refresh) |
| `window-state-changed` | Window maximized/restored |
| `update:available` | New version available (includes release info) |
| `update:not-available` | No update found |
| `update:progress` | Download progress |
| `update:downloaded` | Update downloaded — ready to install |
| `update:error` | Auto-updater error |

### Adding a New Handler

1. Add the handler in the domain-specific file (see sections above for which file covers which domain). Include JSDoc: `@param`, `@returns`, `@throws`.
2. Expose via `contextBridge` in `src/preload/index.ts`
3. Declare the type in `Window.electronAPI` in `src/renderer/src/types/electron.d.ts`
4. Update the handlers table in `CONTRIBUTING.md`

---

## Tests

agent-viewer uses **Vitest** for unit and integration tests.

```bash
npm run test            # Run once
npm run test:watch      # Watch mode (development)
npm run test:coverage   # Istanbul coverage report
```

### Test Organization

| File | Scope |
|------|-------|
| `src/main/ipc-agents.spec.ts` | Agent IPC handlers (CRUD, assignees, groups) |
| `src/main/ipc-tasks.spec.ts` | Task status handlers (getArchived, updateStatus) |
| `src/main/ipc-db.spec.ts` | DB query and watch handlers |
| `src/main/ipc-settings.spec.ts` | Config and update-check handlers |
| `src/main/ipc-git.spec.ts` | Git log handler |
| `src/main/ipc-wsl.spec.ts` | WSL instance detection |
| `src/main/ipc-telemetry.spec.ts` | Telemetry scan handler |
| `src/main/ipc-window.spec.ts` | Window control handlers |
| `src/main/ipc-fs.spec.ts` | Filesystem read/write handlers |
| `src/main/ipc-project.spec.ts` | Project management handlers |
| `src/main/ipc-session-stats.spec.ts` | Session stats and cost handlers |
| `src/main/db.spec.ts` | SQLite utilities (queryLive, writeDb) |
| `src/main/migration.spec.ts` | SQLite migrations |
| `src/main/claude-md.spec.ts` | CLAUDE.md manipulation |
| `src/preload/preload.spec.ts` | contextBridge / preload |
| `src/renderer/src/stores/stores.spec.ts` | Pinia stores |
| `src/renderer/src/components/components.spec.ts` | Vue components |
| `src/renderer/src/composables/useAutoLaunch.spec.ts` | Auto-launch composable |
| `src/renderer/src/utils/agentColor.spec.ts` | Agent color utility |

### Conventions

- Test files are named `*.spec.ts` alongside the tested file
- Electron mocks: `vi.mock('electron', ...)` at the top of the file
- Each critical IPC handler must have at least one nominal test and one error test

---

## Creating a Task

Preferred: use `node scripts/dbstart.js <agent-name>` — it creates the session and displays assigned tasks automatically.

To create a task manually:

```sql
INSERT INTO tasks (
  title, description,
  status, agent_creator_id, agent_assigned_id, agent_validator_id, scope, effort, priority
) VALUES (
  'Task title',
  'Full description with context and acceptance criteria',
  'todo',
  (SELECT id FROM agents WHERE name = 'review'),
  (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
  (SELECT id FROM agents WHERE name = 'review'),
  'front-vuejs',
  2,        -- effort: 1 (small) | 2 (medium) | 3 (large)
  'normal'  -- priority: low | normal | high | critical
);

-- Optional comment (notes for the developer)
INSERT INTO task_comments (task_id, agent_id, content)
VALUES (last_insert_rowid(), (SELECT id FROM agents WHERE name = 'review'), 'Notes for the developer');
```

---

## Launching a Claude Agent

1. Select an agent in the sidebar
2. Click "Launch session"
3. Configure the prompt and options if needed
4. A WSL terminal opens with the agent

The application automatically attempts to **resume** the previous session via `--resume <conv_id>` if a valid Claude Code session exists in the DB (saves ~2500 context tokens).

### Available Agent Types

| Type | Scope | Description |
|------|-------|-------------|
| `dev` | front-vuejs / back-electron | Feature development |
| `test` | front-vuejs / back-electron | Unit and integration tests |
| `review` | global | Audit and validation |
| `doc` | global | Documentation |
| `devops` | global | CI/CD, releases |
| `arch` | global | Architecture, ADR, IPC |
| `ux` | front-vuejs | Interface and user experience |
| `secu` | global | Security |
| `perf` | global | Performance |
| `data` | global | Database, schema |
| `task-creator` | global | Automatic ticket creation |
| `infra` | global | Infrastructure, deployment |
| `infra-prod` | global | Production infrastructure (human validation required) |

### Permission Mode

Each agent can be configured with a **permission mode**:
- `default` — Standard mode: Claude Code prompts for tool approval
- `auto` — Automatic mode: adds `--dangerously-skip-permissions` to bypass all approvals

The auto mode is opt-in and displays a visible warning in the UI. Use only in supervised environments.

---

## Versioning

agent-viewer follows [SemVer](https://semver.org/).

### Bump Rules

| Change type | Increment | Example |
|-------------|-----------|---------|
| Backward-compatible bugfix | PATCH | 0.3.0 → 0.3.1 |
| Backward-compatible feature | MINOR | 0.3.0 → 0.4.0 |
| Breaking change | MAJOR | 0.3.0 → 1.0.0 |

### Release Commands

```bash
npm run release        # Patch
npm run release:minor  # Minor
npm run release:major  # Major
```

> **Note**: Releases require a GitHub connection to create the tag and draft release. The token must be configured in the application settings.

---

## Resources

- [CLAUDE.md](./CLAUDE.md) — Complete architectural documentation
- [CHANGELOG.md](./CHANGELOG.md) — Version history
- [GitHub Issues](https://github.com/IvyNotFound/agent-viewer/issues) — Bug reports and feature requests
