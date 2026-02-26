# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [v0.5.0] - 2026-02-26

### Changes
- feat: auto-launch terminals, review auto-trigger, mandatory assignee, tests & fixes (a98edf7)
- fix(terminal): use \r instead of \n for userPrompt auto-send (f91053e)

## [Unreleased]

## [0.4.0] - 2026-02-26

### Added
- **Token Stats** tab in AgentLogsView — global/today/hour/cache stats, per-agent bars, per-session table (T319)
- **Terminal watchdog** — automatic crash detection and recovery with stored launch params (T279)
- **WSL memory monitoring** — periodic `free -m` checks with 80% usage warning (T279)
- **ConfirmDialog** composable and component (`useConfirmDialog.ts`, `ConfirmDialog.vue`)
- **usePolledData** composable — unified polling lifecycle with visibility guard and cleanup
- **TokenStatsView.vue** component with auto-refresh via `onDbChanged` + 30s polling
- Token tracking columns on sessions table (`tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`) (T314)
- `postinstall` script for automatic native module rebuilding
- ADR-006 (sql.js rationale), ADR-007 (Windows native Claude Code support)
- JSDoc documentation across all types and major modules

### Changed
- **refactor(back):** split monolithic `ipc.ts` into `db.ts`, `ipc-agents.ts`, `ipc-fs.ts`, `ipc-settings.ts` (T322)
- **refactor(front):** restructured Vue components — extracted composables, cleaned up lifecycle (T321)
- AgentLogsView uses `usePolledData` instead of manual `setInterval` polling
- `agentColor.ts` rewritten with memoized hash and improved color palette
- Sidebar sections restructured with improved scroll and layout
- TabBar improved with scroll support and middle-click close (T310)
- ExplorerView refactored with VS Code-style sidebar layout (T308)
- Migration functions now use SAVEPOINT for atomicity (T327)
- `default-agents.ts` system prompts cleaned of backticks (prevents bash substitution)
- Removed `@electron/rebuild` dev dependency (replaced by `postinstall`)

### Fixed
- **Terminal:** PTY readiness detection replaces fixed setTimeout for userPrompt auto-send (T273)
- **Terminal:** use `-- bash -lc` instead of `-i -c` for wsl.exe (T268)
- **i18n:** enable JIT compilation to fix CSP eval violation (T265/T267)
- **Security:** `isPathAllowed` prefix bypass — added path separator check (T318)
- **Security:** `dbPath` validation on IPC write handlers (T282)
- **Security:** `projectPath` validation on `apply-master-md` and `init-new-project` (T283)
- **Security:** `FORBIDDEN_WRITE_KEYWORDS` bypass via non-space whitespace (T284)
- **DB:** concurrent write errors — disk I/O / DB malformed (T313)
- **DB:** COALESCE on all token columns to handle NULL from pre-migration rows (T319 fix)
- **Perf:** double refresh on `db-changed` event (T285)
- **Perf:** `queryLive` instantiates WASM DB per call → cached with TTL eviction (T286)
- **Perf:** write handlers each instantiate WASM DB → shared instance (T287)
- **Perf:** `TaskDetailModal` markdown render not memoized (T288)
- **Perf:** Sidebar `taskCountFor`/`agentCountFor` O(N×P) → optimized (T289)
- **Perf:** AgentLogsView poll 4s without `onDbChanged` → event-driven (T296)
- **Perf:** App.vue static imports → lazy-loaded heavy components (T297)
- SQL queries updated after i18n column migration (T275)
- LaunchSessionModal WSL section uses agent color instead of hardcoded purple (T307)
- TaskCard border-t visible without badges edge case (T300)
- CommandPalette debounce timer cleanup on unmount (T302)
- `will-change: scroll-position` corrected usage (T305)

### Removed
- Monolithic `ipc.ts` (replaced by modular `db.ts` + `ipc-agents.ts` + `ipc-fs.ts` + `ipc-settings.ts`)
- `@electron/rebuild` dev dependency

## [0.3.2] - 2026-02-25

### Fixed
- Terminal: base64-encode system prompt to prevent bash command substitution errors with backticks or special characters in agent prompts
- Scripts: release.sh uses `build:vite` to avoid electron-builder blocking under WSL/Wine

### Changed
- Scripts: refactored `dbq.js` and `dbw.js` helpers

## [0.3.1] - 2026-02-25

### Added
- Internationalisation (i18n) français/anglais via vue-i18n v9 — langue persistée en localStorage
- Locales `fr.json` et `en.json` pour tous les textes UI
- Plugin i18n (`plugins/i18n.ts`) avec fallback `en`
- Content Security Policy sur les headers HTTP Electron (`session.defaultSession`)
- Flags GPU rasterization pour meilleures performances de rendu (`enable-gpu-rasterization`, `enable-zero-copy`)
- `allowedDir` param sur les handlers IPC `fs:listDir` / `fs:readFile` (restriction de chemin)
- DOMPurify pour la sanitisation du rendu Markdown dans TaskDetailModal
- Librairie `marked` pour le rendu Markdown des descriptions et commentaires
- Scripts DB : `scripts/dbq.js` (lecture), `scripts/dbw.js` (écriture), `scripts/dbstart.js`
- `scripts/migrate-drop-commentaire.sql` migration one-shot
- ADR-005 : rationale sql.js vs better-sqlite3 (`.claude/ADRS.md`)
- Documentation agent : `.claude/SETUP.md`, `.claude/WORKFLOW.md`

### Changed
- **Electron 28 → 40** — upgrade majeur (CVE GHSA-vmqv-hx8q-j7mg corrigée)
- **Tailwind CSS v3 → v4** — `@import 'tailwindcss'`, `@tailwindcss/postcss`, tokens `@theme`
- `tailwind.config.ts` supprimé (non nécessaire en v4)
- `postcss.config.js` : plugin `@tailwindcss/postcss` remplace `tailwindcss`
- `tsconfig.node.json` : sql.js ajouté dans `types`
- TitleBar : barre de recherche centrée style VS Code (grid-cols-3, pill)
- Sidebar : sections sessions/locks scrollables (`max-h-40 overflow-y-auto`)
- AgentLogsView : fetch immédiat dès changement pagination/filtre
- migration.ts : `recreateTasksTableWithArchive()` pour compatibilité DB legacy
- terminal.ts : détection UUID session Claude Code, validation profil regex, `promisify(execFile)`
- preload/index.ts : signature `unwatchDb(dbPath?)` optionnelle
- Stores, types et `agentColor.ts` étendus (langue, nouveaux types onglets, `agentBorder()`)

### Fixed
- 19 tests components.spec.ts corrigés (plugin i18n manquant dans test setup)
- `Buffer<ArrayBuffer>` cast pour Electron 40
- `paintWhenInitiallyHidden` supprimé (déprécié depuis Electron 35)
- `fs/promises` import remplace l'API callback dépréciée

### Removed
- `scripts/check-sqlite3.js` (remplacé par `download-sqlite3.js`)

## [0.3.0] - 2026-02-25

### Added
- Badge effort S/M/L sur TaskCard et TaskDetailModal
- Sections Backlog et Logs dans la sidebar (panneau dédié)
- Archive groupée par agent
- Bouton ajouter agent harmonisé
- Activité PTY réelle dans le terminal

### Fixed
- bash -lc login shell + pre-check "claude not found"
- Curseur violet xterm (caret-color transparent)
- Double coller xterm
- Thinking mode buttons - couleur agent
- Labels sidebar Agents / Périmètre
- Animate-pulse retiré sur rond vert sessions ouvertes
- Curseur pointer onglets (cursor-grab → cursor-pointer)
- Icône backlog sidebar harmonisée
- Popup tâche élargie (max-w-5xl)

## [0.2.0] - 2026-02-25

### Added
- Interface desktop Electron avec Vue 3 + Tailwind CSS
- Vue Board (colonnes Kanban : a_faire, en_cours, terminé, archivé)
- Vue Terminal intégrée (node-pty)
- Sidebar avec liste des agents et état des sessions
- Modale de lancement de session Claude Code
- Sélecteur de fichier DB (.claude/project.db)
- Système d'onglets (Board, Terminal, Logs, Explorer)
- Toast notifications
- Command palette (Ctrl+K)
- File explorer视图
- Settings modal (theme, font size)
- Setup wizard

### Changed
- Migration de Tauri vers Electron
- Refonte complète UI en dark mode

### Fixed
- Numerous bug fixes and improvements

### Removed
- Ancienne stack Tauri

---

## [0.1.0] - 2026-02-24

### Added
- Initial prototype with Tauri
- Basic task board view

[Unreleased]: https://github.com/IvyNotFound/agent-viewer/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/IvyNotFound/agent-viewer/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/IvyNotFound/agent-viewer/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/IvyNotFound/agent-viewer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/IvyNotFound/agent-viewer/releases/tag/v0.3.0
[0.2.0]: https://github.com/IvyNotFound/agent-viewer/releases/tag/v0.2.0
[0.1.0]: https://github.com/IvyNotFound/agent-viewer/releases/tag/v0.1.0
