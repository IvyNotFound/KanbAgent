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
SELECT id, titre, statut FROM tasks
WHERE agent_assigne_id = (SELECT id FROM agents WHERE name = 'dev-front-vuejs')
AND statut IN ('todo', 'in_progress');

-- Set a task in progress
UPDATE tasks SET statut = 'in_progress', started_at = CURRENT_TIMESTAMP
WHERE id = 42;

-- Lock a file
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id)
VALUES ('src/renderer/src/App.vue', 1, 10);

-- Complete a task
UPDATE tasks SET statut = 'done', completed_at = CURRENT_TIMESTAMP
WHERE id = 42;

-- Exit comment (mandatory)
INSERT INTO task_comments (task_id, agent_id, contenu)
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
- **GitHub Token**: OS-level encryption via `safeStorage` (DPAPI / Keychain), never stored in plaintext

### IPC Handlers — `src/main/ipc.ts` (core)

| Handler | Description |
|---------|-------------|
| `query-db` | Read-only SQL query on the DB (sql.js, bypasses lock via `readFile`) |
| `watch-db` | Watches DB file changes (fs.watch) |
| `unwatch-db` | Stops watching |
| `select-project-dir` | Project folder selector (Electron dialog) |
| `select-new-project-dir` | Selector for creating a new project |
| `create-project-db` | Creates a blank SQLite DB in `.claude/` |
| `find-project-db` | Finds `project.db` in a folder's `.claude/` |
| `init-new-project` | Initializes a project (creates DB + inserts default agents) |
| `migrate-db` | Migrates the SQLite schema to the current version |
| `get-locks` | Returns active locks |
| `show-confirm-dialog` | Displays a native confirmation dialog |
| `window-minimize` | Minimizes the window |
| `window-maximize` | Maximizes / restores the window |
| `window-close` | Closes the application |
| `window-is-maximized` | Returns the maximized state |
| `tasks:getArchived` | Paginated archived tasks query (page, pageSize, optional filters) |

### IPC Handlers — `src/main/ipc-agents.ts`

| Handler | Description |
|---------|-------------|
| `close-agent-sessions` | Closes an agent's `en_cours` sessions |
| `rename-agent` | Renames an agent in the DB |
| `update-perimetre` | Updates a scope name/description and cascades to tasks/agents |
| `add-perimetre` | Creates a new scope in the `perimetres` table |
| `update-agent-system-prompt` | Updates an agent's system prompt |
| `update-agent-thinking-mode` | Updates an agent's thinking mode |
| `update-agent` | Updates agent fields (name, type, scope, permission_mode, max_sessions…) |
| `agent:duplicate` | Duplicates an agent (copies name, type, scope, prompt, thinking_mode, max_sessions) |
| `get-agent-system-prompt` | Returns system_prompt, suffix, thinking_mode of an agent |
| `build-agent-prompt` | Builds the launch prompt with session summary + task context |
| `create-agent` | Creates an agent + inserts into CLAUDE.md if present |
| `delete-agent` | Deletes an agent and all associated data (sessions, locks, tasks) |
| `task:getAssignees` | Returns all agents assigned to a task (with role) |
| `task:setAssignees` | Replaces a task's assignee list (primary / support / reviewer) |
| `search-tasks` | Full-text search in tasks with filters |
| `session:setConvId` | Stores the `claude_conv_id` of a session for `--resume` |

### IPC Handlers — `src/main/ipc-fs.ts`

| Handler | Description |
|---------|-------------|
| `fs:listDir` | Lists a directory (file explorer, max 4 levels) |
| `fs:readFile` | Reads a text file (restricted to project directory) |
| `fs:writeFile` | Writes a text file (restricted to project directory, sensitive paths blocked) |

### IPC Handlers — `src/main/ipc-settings.ts`

| Handler | Description |
|---------|-------------|
| `get-config-value` | Reads a key from the `config` table (github_token auto-decrypted) |
| `set-config-value` | Writes a key to the `config` table (github_token auto-encrypted) |
| `test-github-connection` | Tests the GitHub connection with the stored token |
| `check-for-updates` | Checks if a new version is available on GitHub |

### IPC Handlers — `src/main/terminal.ts`

| Handler | Description |
|---------|-------------|
| `terminal:getWslUsers` | Lists available WSL users (`/etc/passwd`) |
| `terminal:getClaudeProfiles` | Lists Claude profiles in `~/bin/` (WSL) |
| `terminal:getClaudeInstances` | Detects WSL distributions with Claude Code installed |
| `terminal:create` | Creates a WSL PTY (with agent / resume / plain bash) |
| `terminal:write` | Sends data to the PTY |
| `terminal:resize` | Resizes the PTY |
| `terminal:kill` | Kills the PTY (graceful for agent sessions) |
| `terminal:subscribe` | No-op — kept for re-subscription after hot-reload |
| `terminal:relaunch` | Relaunches a crashed PTY with the same parameters |
| `terminal:dismissCrash` | Clears crash recovery parameters |
| `terminal:getActiveCount` | Returns the number of active PTYs |
| `terminal:isAlive` | Checks if a PTY is still alive |
| `terminal:getMemoryStatus` | Returns WSL memory usage on demand |
| `terminal:releaseMemory` | Releases WSL memory (sync + optional drop_caches) |

### IPC Events (main → renderer)

| Event | Description |
|-------|-------------|
| `db-changed` | DB has changed on disk (triggers refresh) |
| `window-state-changed` | Window maximized/restored |
| `terminal:data:<id>` | PTY data |
| `terminal:exit:<id>` | PTY terminated (includes crash recovery info) |
| `terminal:convId:<id>` | Claude Code session UUID detected at startup |
| `terminal:memoryStatus` | Periodic broadcast of WSL memory usage |

### Adding a New Handler

1. Define the handler in the appropriate IPC file with JSDoc (`@param`, `@returns`, `@throws`):
   - `src/main/ipc.ts` — core (SQL, window, locks)
   - `src/main/ipc-agents.ts` — agents (CRUD, sessions, search)
   - `src/main/ipc-fs.ts` — filesystem (read/write files)
   - `src/main/ipc-settings.ts` — settings (config, GitHub)
   - `src/main/terminal.ts` — WSL terminal (PTY)
2. Expose via `contextBridge` in `src/preload/index.ts`
3. Declare the type in the `Window.electronAPI` interface in `src/renderer/src/stores/tasks.ts`
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
| `src/main/ipc.spec.ts` | IPC handlers (main process) |
| `src/main/ipc-agents.spec.ts` | Agent IPC handlers (CRUD, assignees) |
| `src/main/db.spec.ts` | SQLite utilities (queryLive, writeLive) |
| `src/main/migration.spec.ts` | SQLite migrations |
| `src/main/terminal.spec.ts` | WSL terminal (PTY) |
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

```sql
INSERT INTO tasks (
  titre, description,
  statut, agent_createur_id, agent_assigne_id, perimetre, effort, priority
) VALUES (
  'Task title',
  'Full description with context and acceptance criteria',
  'todo',
  (SELECT id FROM agents WHERE name = 'review'),
  (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
  'front-vuejs',
  2,        -- effort: 1 (small) | 2 (medium) | 3 (large)
  'normal'  -- priority: low | normal | high | critical
);

-- Optional comment (notes for the developer)
INSERT INTO task_comments (task_id, agent_id, contenu)
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
