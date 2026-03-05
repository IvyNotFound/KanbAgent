# agent-viewer

![Version](https://img.shields.io/badge/version-0.20.1-blue)
![Status](https://img.shields.io/badge/status-beta-orange)

Desktop interface in Trello/Jira style for real-time visualization of Claude agent tasks from a local SQLite database. The application manages agents, launches Claude sessions in external WSL terminals, and monitors activity in real time.

![Board agent-viewer](https://placehold.co/800x400/18181b/white?text=agent-viewer+board)

## Key Features

### Board & Task Management
- **Trello/Jira Board**: Columns by status (`todo`, `in_progress`, `done`, `archived`), task cards with drill-down, S/M/L effort badge and priority
- **Task Tree**: Hierarchical view of tasks via `parent_task_id`, collapsible subtree nodes
- **Task Dependencies**: Dependency graph (`task_links`) visualised in `TaskDependencyGraph`
- **Multi-agent Assignments**: Multiple agents per task (primary / support / reviewer roles), task card avatars
- **Kanban Drag & Drop**: Drag task cards between columns to update status directly in the database
- **Archive Pagination**: Paginated archive view (50 tasks per page), archives excluded from main refresh for better performance
- **Search**: Full-text search in tasks with filters (status, agent, scope)

### Agent Management
- **Agent Management**: Creation, configuration, system prompt editing, thinking mode (auto/disabled), mandatory assignment, right-click delete/duplicate, max sessions limit (including `-1` for unlimited); review agents highlighted with amber accent in a dedicated sidebar section
- **Agent Groups & Drag & Drop**: Sidebar agent groups with drag-and-drop reordering (`useSidebarGroups`, `useSidebarDragDrop`)
- **Multi-instance**: Launch multiple instances of the same agent with git worktree isolation
- **Permission Mode per Agent**: Configure each agent to run Claude with `--dangerously-skip-permissions` (auto mode, opt-in with visible warning)
- **Setup Wizard**: First-run configuration assistant (`SetupWizard`) — guides through WSL detection, project creation and initial agents

### Dashboard & Analytics
- **Dashboard Tab**: `DashboardView` — unified analytics hub with 9 sub-tabs (Token Stats, Git, Hooks, Tools, Heatmap, Quality, Workload, Topology, Logs); active sub-tab persisted in `localStorage`
- **Token Stats**: `TokenStatsView` — period selector (1h / 24h / 7d / 30d / ∞), estimated cost (Sonnet 4.6 pricing), cache hit rate with colour indicator, 7-day activity sparkline, per-agent bars and per-session table
- **Cost Stats**: `CostStatsSection` — grouped cost breakdowns with chart
- **Activity Heatmap**: `ActivityHeatmap` — GitHub-style contribution heatmap of agent activity over time
- **Workload View**: `WorkloadView` — per-agent task load and effort distribution
- **Agent Quality Panel**: `AgentQualityPanel` — quality metrics (done rate, rejection rate, avg effort) per agent
- **Tool Stats Panel**: `ToolStatsPanel` — usage frequency and timing per Claude tool
- **Telemetry View**: `TelemetryView` — system-level metrics (CPU, memory, timings) from Electron hooks
- **Timeline / Gantt**: `TimelineView` — inter-agent Gantt chart of sessions and tasks over time

### Topology & Exploration
- **Topology View**: `TopologyView` — force-directed graph of agents, groups and their relationships (accessible from Dashboard)
- **File Explorer**: `ExplorerView` + `FileView` — project file navigation and syntax-highlighted display with CodeMirror 6
- **Git Commit List**: `GitCommitList` — browse recent commits with diff preview via IPC `git:getCommits` / `git:getDiff` (accessible from Dashboard)
- **Hook Events View**: `HookEventsView` + `HookEventPayloadModal` — live hook events feed with payload inspection; events persisted in SQLite (accessible from Dashboard)

### Stream & Session
- **Improved StreamView**: User message bubbles, live thinking preview, collapsible `tool_use` / `tool_result` / `thinking` blocks (auto-collapse >15 lines), ANSI stripping, markdown rendering
- **Stream Input Bar**: `StreamInputBar` — send messages to active Claude sessions via IPC
- **Stream Tool Block**: `StreamToolBlock` — isolated rendering of individual tool call blocks
- **Thinking Live Preview**: Status bar shows last 120 chars of live thinking text in real time
- **Guaranteed Agent Kill on Tab Close**: `agentKill` called explicitly before tab unmount — eliminates orphan processes
- **Session Resume**: Claude Code sessions resumed via `--resume <conv_id>` to save tokens
- **External WSL Terminal**: Launch Claude sessions in external WSL terminal windows (Windows Terminal → `wsl://` URI → `wsl.exe` fallback chain)
- **Auto-launch Terminals**: Automatic agent session launch on task creation with assignment
- **Auto-trigger Review**: Automatic review session launch when ≥10 tasks reach `done` status (configurable threshold, cooldown)
- **Pre-inject Session Context**: Startup context (agent_id, session_id, assigned tasks, active locks, last session summary) automatically injected into the first agent message via `build-agent-prompt` IPC — agents no longer need to call `dbstart.js` manually

### UI & UX
- **Command Palette**: `CommandPalette` (Cmd+K / Ctrl+K) — fuzzy search across tasks, agents and views
- **Context Menu**: Right-click `ContextMenu` component for task and agent actions
- **Confirm Dialog**: `ConfirmDialog` — unified confirmation modal with keyboard support
- **Toast Notifications**: `ToastContainer` — stacked toast system via `useToast` composable
- **Toggle Switch**: `ToggleSwitch` — accessible boolean toggle component
- **Tab Bar**: `TabBar` — multi-type tab bar with close / reorder support
- **Title Bar**: `TitleBar` — custom Electron frameless title bar with window controls
- **Agent Badge**: `AgentBadge` — colour-coded agent avatar with role indicator
- **DB Selector**: `DbSelector` — graphical project database switcher
- **Project Popup**: Click the project button in the sidebar to open a modal showing active project name, database path, version, and quick actions (switch project, close project)
- **Keyboard Shortcuts**: Press `Escape` to close any modal (standardised via `useModalEscape` composable)
- **Dark / Light Mode**: Dark theme by default, light mode available
- **Internationalization**: Interface available in French and English (vue-i18n)
- **Spell Check**: Native spell check on prompt textareas with right-click context menu suggestions
- **Default Claude Code Profile**: Configure a default Claude Code instance/profile per agent in Settings; stored in `localStorage` via `defaultClaudeProfile`

### Security & Data
- **DOMPurify 3.3.1**: XSS protection upgraded — GHSA-v8jm-5vwx-cfxm patched, regression tests included
- **IPC Path Guard**: All IPC file handlers protected by `assertDbPathAllowed` / `assertProjectPathAllowed` — prevents path traversal to unauthorized paths
- **Secure GitHub Token**: OS-level encryption via Electron `safeStorage` (DPAPI Windows / Keychain macOS)
- **Auto-Update**: In-app updates from GitHub Releases (private repo); token baked at build time by GitHub Actions (`GH_TOKEN_UPDATER` secret) with `safeStorage` fallback; `UpdateNotification` banner with download progress bar and one-click install (`useUpdater` composable)
- **Export ZIP**: Export `project.db` as a ZIP archive from the UI via IPC
- **Multi-distro Detection**: Automatic discovery of WSL distributions with Claude Code installed
- **External File Connection**: Open any `.claude/project.db` file
- **WSL Memory Monitoring**: Real-time WSL RAM monitoring with alerts and memory release
- **Agent Error Visibility**: Spawn failures (`error:spawn`) and abnormal exits (`error:exit`) surfaced directly in StreamView UI — no DevTools needed

## Prerequisites

| Software | Minimum Version |
|----------|-----------------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| WSL2 | For launching Claude sessions in external terminal windows |
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
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # Entry point, BrowserWindow, CSP
│   │   ├── ipc.ts                   # Core IPC (SQL, window, locks, migrations, ZIP export)
│   │   ├── ipc-agents.ts            # Re-exports agent IPC modules (facade)
│   │   ├── ipc-agent-crud.ts        # Agent CRUD (create, update, delete, list)
│   │   ├── ipc-agent-groups.ts      # Agent groups (list, create, reorder, drag-drop)
│   │   ├── ipc-agent-sessions.ts    # Agent sessions (launch, kill, resume, stats)
│   │   ├── ipc-agent-tasks.ts       # Task-agents assignments (get, set roles)
│   │   ├── ipc-tasks.ts             # Tasks IPC (CRUD, links, qualityStats)
│   │   ├── ipc-session-stats.ts     # Session statistics and cost aggregation
│   │   ├── ipc-db.ts                # Database management (open, close, migrate)
│   │   ├── ipc-project.ts           # Project IPC (create-db, init, metadata)
│   │   ├── ipc-git.ts               # Git IPC (getCommits, getDiff)
│   │   ├── ipc-telemetry.ts         # Telemetry IPC (system metrics)
│   │   ├── ipc-fs.ts                # Filesystem IPC (listDir, readFile, writeFile)
│   │   ├── ipc-settings.ts          # Settings IPC (config, GitHub, updates)
│   │   ├── ipc-window.ts            # Window IPC (minimize, maximize, close)
│   │   ├── ipc-wsl.ts               # WSL IPC (getClaudeInstances, openTerminal)
│   │   ├── updater.ts               # Auto-update (electron-updater, token loading, IPC handlers)
│   │   ├── db.ts                    # SQLite utilities (queryLive, writeLive)
│   │   ├── claude-md.ts             # CLAUDE.md manipulation (agent insertion)
│   │   ├── migration.ts             # Numbered SQLite migrations (SAVEPOINT atomicity)
│   │   ├── seed.ts                  # Demo data for project.db
│   │   ├── default-agents.ts        # GENERIC_AGENTS (new projects) + DEFAULT_AGENTS (agent-viewer)
│   │   └── utils/
│   │       └── wsl.ts               # WSL path conversion (toWslPath)
│   ├── preload/
│   │   └── index.ts                 # contextBridge — exposes electronAPI to renderer
│   └── renderer/                    # Vue 3 application
│       └── src/
│           ├── main.ts              # Vue + Pinia + i18n entry point
│           ├── App.vue              # Root component
│           ├── stores/              # Pinia stores
│           │   ├── tasks.ts         # Tasks CRUD, filtering, polling
│           │   ├── agents.ts        # Agents list, locks, agent groups
│           │   ├── project.ts       # Project connection (dbPath, projectPath)
│           │   ├── tabs.ts          # Tab management (multi-type)
│           │   ├── hookEvents.ts    # Hook events feed (live + persisted)
│           │   └── settings.ts      # Theme, language, GitHub, CLAUDE.md
│           ├── components/          # Vue components (~46 components)
│           │   ├── BoardView.vue          # Kanban board
│           │   ├── TimelineView.vue       # Inter-agent Gantt chart
│           │   ├── TopologyView.vue       # Force-directed agent graph
│           │   ├── ExplorerView.vue       # File explorer
│           │   ├── FileView.vue           # Syntax-highlighted file viewer
│           │   ├── GitCommitList.vue      # Git commits + diff
│           │   ├── HookEventsView.vue     # Live hook events feed
│           │   ├── TelemetryView.vue      # System telemetry
│           │   ├── ActivityHeatmap.vue    # Agent activity heatmap
│           │   ├── WorkloadView.vue       # Agent workload chart
│           │   ├── AgentQualityPanel.vue  # Per-agent quality metrics
│           │   ├── ToolStatsPanel.vue     # Claude tool usage stats
│           │   ├── TokenStatsView.vue     # Token / cost dashboard
│           │   ├── CostStatsSection.vue   # Cost breakdown section
│           │   ├── DashboardView.vue      # Analytics hub (9 sub-tabs)
│           │   ├── StreamView.vue         # Claude session streaming
│           │   ├── StreamInputBar.vue     # Send messages to active session
│           │   ├── StreamToolBlock.vue    # Tool call block renderer
│           │   ├── UpdateNotification.vue # Auto-update banner (download progress + install)
│           │   ├── CommandPalette.vue     # Cmd+K fuzzy search
│           │   ├── TaskDetailModal.vue    # Task drill-down modal
│           │   ├── SetupWizard.vue        # First-run setup assistant
│           │   └── …                      # + 25 more UI components
│           ├── composables/         # Vue composables
│           │   ├── useAutoLaunch.ts       # Auto-launch session on task create
│           │   ├── useArchivedPagination.ts # Paginated archive fetch
│           │   ├── useModalEscape.ts      # ESC key to close modals
│           │   ├── useSidebarGroups.ts    # Sidebar group management
│           │   ├── useSidebarDragDrop.ts  # Sidebar drag-and-drop reorder
│           │   ├── useToast.ts            # Toast notification system
│           │   ├── useConfirmDialog.ts    # Confirm dialog (promise-based)
│           │   ├── useToolStats.ts        # Tool usage stats aggregation
│           │   ├── useUpdater.ts          # Auto-update state machine (singleton, IPC events)
│           │   └── useHookEventDisplay.ts # Hook event formatting helpers
│           ├── locales/             # i18n translations (fr.json, en.json)
│           ├── utils/               # Utilities (agentColor, buildTree, renderMarkdown…)
│           └── types/
│               ├── index.ts         # Shared TypeScript types
│               └── electron.d.ts    # Window.electronAPI interface (contextBridge)
├── scripts/                         # CLI scripts (dbq.js, dbw.js, dbstart.js, dblock.js)
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
- `defaultClaudeProfile` — Default Claude Code instance/profile name (defaults to `claude`)
- `dashboard.activeSubTab` — Last active Dashboard sub-tab

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development workflow
- Code conventions
- Submission procedure

## License

MIT
