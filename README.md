# agent-viewer

![Version](https://img.shields.io/badge/version-0.16.2-blue)
![Status](https://img.shields.io/badge/status-beta-orange)

Desktop interface in Trello/Jira style for real-time visualization of Claude agent tasks from a local SQLite database. The application manages agents, launches sessions, and includes an embedded WSL terminal.

![Board agent-viewer](https://placehold.co/800x400/18181b/white?text=agent-viewer+board)

## Key Features

- **Trello/Jira Board**: Columns by status (`todo`, `in_progress`, `done`, `archived`), task cards with drill-down, S/M/L effort badge and priority
- **Agent Management**: Creation, configuration, system prompt editing, thinking mode (auto/disabled), mandatory assignment, right-click delete/duplicate, max sessions limit (including `-1` for unlimited); review agents highlighted with amber accent in a dedicated sidebar section
- **Keyboard Shortcuts**: Press `Escape` to close any modal (standardised via `useModalEscape` composable)
- **Multi-agent Assignments**: Multiple agents per task (primary / support / reviewer roles), task card avatars
- **Permission Mode per Agent**: Configure each agent to run Claude with `--dangerously-skip-permissions` (auto mode, opt-in with visible warning)
- **Project Popup**: Click the project button in the sidebar to open a modal showing active project name, database path, version, and quick actions (switch project, close project)
- **Kanban Drag & Drop**: Drag task cards between columns to update status directly in the database
- **Integrated WSL Terminal**: Multiple sessions, tabs grouped by agent with collapsible parent tab, node-pty + xterm.js, crash recovery with `--resume`
- **Auto-launch Terminals**: Automatic agent session launch on task creation with assignment
- **Auto-trigger Review**: Automatic review session launch when ≥10 tasks reach `done` status (configurable threshold, cooldown)
- **Archive Pagination**: Paginated archive view (50 tasks per page), archives excluded from main refresh for better performance
- **Token Stats**: Period selector (1h / 24h / 7d / 30d / ∞), estimated cost (Sonnet 4.6 pricing), cache hit rate with colour indicator, 7-day activity sparkline, per-agent bars and per-session table
- **Terminal Watchdog**: Automatic crash detection and recovery with stored launch parameters
- **Multi-instance**: Launch multiple instances of the same agent with git worktree isolation
- **Session Resume**: Claude Code sessions resumed via `--resume <conv_id>` to save tokens
- **Multi-distro Detection**: Automatic discovery of WSL distributions with Claude Code installed
- **External File Connection**: Open any `.claude/project.db` file
- **File Explorer**: Project file navigation and editing with CodeMirror 6
- **Search**: Full-text search in tasks with filters (status, agent, scope)
- **CLAUDE.md Sync**: Compare and update from a GitHub master repository
- **Spell Check**: Native spell check on prompt textareas with right-click context menu suggestions
- **Dark / Light Mode**: Dark theme by default, light mode available
- **Internationalization**: Interface available in French and English (vue-i18n)
- **Secure GitHub Token**: OS-level encryption via Electron `safeStorage` (DPAPI Windows / Keychain macOS)
- **IPC Path Guard**: All read-only IPC handlers protected by `assertDbPathAllowed` — prevents path traversal to unauthorized databases
- **WSL Memory Monitoring**: Real-time WSL RAM monitoring with alerts and memory release
- **Agent Error Visibility**: Spawn failures (`error:spawn`) and abnormal exits (`error:exit`) are surfaced directly in the StreamView UI — no DevTools needed; full stderr output included when available

## Prerequisites

| Software | Minimum Version |
|----------|-----------------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| WSL2 | For the integrated terminal |
| sql.js | ≥ 1.14 (included via `npm install`) |

## Installation

```bash
# Clone the project
git clone https://github.com/IvyNotFound/agent-viewer.git
cd agent-viewer

# Install dependencies
npm install
```

## Usage

### Development

```bash
npm run dev
```

Launches the application in development mode with hot-reload:
- Main Electron process
- Preload scripts
- Vue 3 renderer at http://localhost:5173

### Desktop Build (Windows)

```bash
npm run build
```

Outputs:
- `dist/win-unpacked/` — Unpacked application
- `dist/*.exe` — Installer (NSIS, multi-language)

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode |
| `npm run build` | Windows production build |
| `npm run build:dir` | Build without packaging |
| `npm run lint` | ESLint check |
| `npm run test` | Run tests (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run release` | Patch release (SemVer) |
| `npm run release:minor` | Minor release |
| `npm run release:major` | Major release |

## Architecture

```
agent-viewer/
├── src/
│   ├── main/                   # Electron main process
│   │   ├── index.ts            # Entry point, BrowserWindow, CSP
│   │   ├── ipc.ts              # Core IPC handlers (SQL, window, locks, migrations)
│   │   ├── ipc-agents.ts       # Agent IPC handlers (CRUD, sessions, search, assignees)
│   │   ├── ipc-fs.ts           # Filesystem IPC handlers (listDir, readFile, writeFile)
│   │   ├── ipc-settings.ts     # Settings IPC handlers (config, GitHub, updates)
│   │   ├── db.ts               # SQLite utilities (queryLive, writeLive)
│   │   ├── terminal.ts         # node-pty + WSL management (spawn, resize, kill, memory)
│   │   ├── claude-md.ts        # CLAUDE.md manipulation (agent insertion)
│   │   ├── migration.ts        # Incremental SQLite migrations (schema v2+)
│   │   ├── seed.ts             # Demo data for project.db
│   │   └── default-agents.ts   # Agent definitions: GENERIC_AGENTS (new projects) + DEFAULT_AGENTS (agent-viewer)
│   ├── preload/
│   │   └── index.ts            # contextBridge — exposes electronAPI to renderer
│   └── renderer/               # Vue 3 application
│       └── src/
│           ├── main.ts         # Vue + Pinia + i18n entry point
│           ├── App.vue         # Root component
│           ├── stores/         # Pinia stores
│           │   ├── tasks.ts    # Tasks, agents, locks, project
│           │   ├── tabs.ts     # Tab management (multi-type)
│           │   └── settings.ts # Theme, language, GitHub, CLAUDE.md
│           ├── components/     # Vue components (~20 components)
│           ├── composables/    # Vue composables (useAutoLaunch, useArchivedPagination, useModalEscape…)
│           ├── locales/        # i18n translations (fr.json, en.json)
│           ├── utils/          # Utilities (agentColor…)
│           └── types/
│               └── index.ts    # Shared TypeScript types
├── scripts/                    # CLI scripts (dbq.js, dbw.js, dbstart.js, dblock.js)
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

### Agents par défaut (`default-agents.ts`)

Le fichier `src/main/default-agents.ts` exporte deux collections d'agents :

| Export | Usage |
|--------|-------|
| `GENERIC_AGENTS` | Agents génériques insérés dans **tout nouveau projet** créé via `create-project-db`. Aucune référence spécifique à agent-viewer — ils sont conçus pour fonctionner sur n'importe quel projet utilisant le workflow agent. |
| `DEFAULT_AGENTS` | Agents propres au projet **agent-viewer** (dev-front-vuejs, dev-back-electron, arch, secu, perf, etc.). Insérés uniquement lors de l'initialisation de ce projet. |

Lors de la création d'un nouveau projet via le script `create-project-db`, seuls les `GENERIC_AGENTS` sont seedés : `dev`, `review`, `test`, `doc`, `task-creator`. Cela donne un projet fonctionnel immédiatement, sans agents liés au périmètre d'agent-viewer.

### Scripts CLI

Les scripts dans `scripts/` permettent aux agents d'interagir avec la base de données sans ouvrir l'application :

| Script | Description |
|--------|-------------|
| `node scripts/dbq.js "<SQL>"` | Lecture en mémoire (sql.js, bypass lock SQLite) |
| `node scripts/dbw.js "<SQL>"` | Écriture atomique avec advisory lock (`.wlock`) |
| `node scripts/dbstart.js <agent>` | Démarre une session agent, affiche tâches et locks |
| `bash scripts/release.sh [patch\|minor\|major]` | Build + bump de version + tag Git + GitHub Release (draft) |

**Mode JSON (dbw.js)** — pour les valeurs contenant des apostrophes ou caractères spéciaux, utilisez le mode JSON via stdin :

```sh
echo '{"sql":"INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (?,?,?)","params":[42,3,"O'\''Brien"]}' | node scripts/dbw.js
```

**Mode heredoc** — pour le SQL multiligne ou contenant des backticks / `$()` :

```sh
node scripts/dbw.js <<'SQL'
UPDATE tasks SET statut='done', updated_at=CURRENT_TIMESTAMP WHERE id=42;
SQL
```

### Data Flow

```
┌─────────────────┐     IPC (contextBridge)     ┌─────────────────┐
│  Vue Renderer   │ ◄────────────────────────► │  Electron Main  │
│   (Pinia)       │                             │  (sql.js + pty) │
└─────────────────┘                             └────────┬────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │  SQLite DB      │
                                                  │  (project.db)   │
                                                  └─────────────────┘
```

### Tech Stack

| Category | Technology |
|----------|------------|
| Desktop framework | Electron 40 |
| Build tool | electron-vite 5 |
| Frontend | Vue 3 + TypeScript 5 |
| State management | Pinia 2 |
| CSS | Tailwind CSS v4 (`@tailwindcss/postcss`) |
| i18n | vue-i18n 9 (FR/EN) |
| Terminal | node-pty 1 + @xterm/xterm 5 |
| Database | sql.js 1.14 (SQLite WASM, bypasses file locks) |
| Tests | Vitest 4 |
| Code editor | CodeMirror 6 |
| Markdown | marked + DOMPurify |

## Configuration

### Environment Variables

No environment variables required for basic operation.

### Recommended WSL 2 Configuration (heavy agent usage)

WSL 2 runs in a Hyper-V VM that allocates RAM dynamically but does not automatically return it to Windows. By default, WSL 2 can use up to 50% of system RAM. After several hours of active Claude agents, the VM accumulates RAM (Node.js heap, kernel buffers, etc.) even after processes end.

**Create or edit** `C:\Users\<your-user>\.wslconfig`:

```ini
[wsl2]
memory=4GB            # Max RAM allocated to WSL (adjust based on available RAM)
processors=4          # Optional: limit vCPUs

[experimental]
autoMemoryReclaim=gradual   # Recommended for heavy multi-agent sessions (see below)
```

**`autoMemoryReclaim` modes** (WSL 2.0+, requires `[experimental]` section):

| Mode | Behaviour | When to use |
|------|-----------|-------------|
| `gradual` | Progressively reclaims unused pages when WSL is less active — low impact, transparent | **Recommended** for sustained agent workloads (multiple Claude sessions running in parallel) |
| `dropcache` | Aggressively drops kernel page cache — equivalent to running `sync && echo 3 > /proc/sys/vm/drop_caches` automatically | Use when WSL RAM usage climbs rapidly and `gradual` is not sufficient |
| `disabled` | Default — WSL never returns RAM to Windows; heap and kernel buffers accumulate indefinitely | Avoid for long-running agent sessions |

> **Note**: After editing, run `wsl --shutdown` in PowerShell to apply changes. The setting takes effect at the next WSL boot.

References: [WSL Documentation](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

### Local Storage

The application uses `localStorage` for:
- `projectPath` — Path to the connected project
- `dbPath` — Path to the SQLite database
- `theme` — Theme (`dark` or `light`)
- `language` — Language (`fr` or `en`)
- `github_token` — GitHub token (if configured, encrypted via `safeStorage` on main side)
- `github_repo_url` — GitHub repository URL
- `github_last_check` — Timestamp of the last GitHub connection check

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development workflow
- Code conventions
- Submission procedure

## License

MIT
