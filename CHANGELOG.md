# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [0.11.0] - 2026-02-27

### Changes
- feat(tab-bar): right-click on group header to close all tabs (76fd31c)
- fix(stream-view): suppress ANSI codes in stream-json PTY sessions (f7c0ab4)
- fix(back-electron): T615 allow find-project-db to register path on cold start (4d4e706)
- fix(scripts): normalize typographic quotes in dbq/dbw (17540df)
- fix(stream-view): T606 switch stream-json to respawn-per-message mode (cbe6027)
- fix(agents): T608 T609 document sessions.statut CHECK and dbstart.js startup (61feb95)
- fix(stream-view): T607 display autoSend bubble without system:init dependency (b057614)
- fix(dbw): normalize NOW() to CURRENT_TIMESTAMP before SQL execution (6210270)
- feat(stream-view): T605 display autoSend and textarea msgs as user bubbles (7d6db10)
- docs(front): T596 add JSDoc to ProjectPopup.vue and update README feature list (338373d)
- fix(terminal): T604 fix stream-json multi-turn by launching Claude in interactive mode (5389033)
- feat(stream-view): T603 render user messages as right-aligned bubbles (98bae53)
- fix(agents): T600 document valid task_links.type values in agent prompts (0777b83)
- feat(stream-view): T597 câbler StreamView dans LaunchSessionModal et App.vue (6a61ffa)
- fix(front): T596 align ProjectPopup.vue with design tokens (9d1cb1b)
- fix(terminal): T593 restore CONV_ID_REGEX colon + update relaunch test (cda408e)
- fix(terminal): T592 inject --session-id for new sessions to fix claude_conv_id=NULL (370ce66)
- fix(dbstart): T590 intercept --help/-h flags before DB INSERT (f034726)
- feat(stream-view): T578 POC StreamView — structured stream-json display without xterm.js (b16545a)
- fix(terminal): T589 strip ANSI codes before CONV_ID_REGEX match (78c97fc)
- docs(arch): T577 amend ADR-009 — CLI stream-json approach and spike results (18cc160)
- fix(launch): T586 respect agent.max_sessions in canLaunchSession and launchAgentTerminal (d0ad0cb)
- chore(spike): T576 validate claude CLI stream-json for xterm.js replacement (ba8c0a5)
- test(ipc): T580/T581/T582 — agent-groups, session tokens, apply-master-md behavioral tests (7dee545)
- test(ipc): T580/T581/T582 add behavioural tests for agent-groups, session tokens, ipc-settings handlers (8fb68e3)
- fix(sidebar): T579 correct drag & drop dragleave on children (c9a1aa1)
## [0.10.0] - 2026-02-26

### Changes
- chore(gitignore): ignore .claude/*.db.bak backup files (cf3b21c)
- feat(tasks): T575 right-click context menu on in_progress cards to relaunch agent (d2904f6)
- feat(backlog): T575 right-click context menu on in_progress tasks to relaunch agent (1dd0c26)
- feat(sidebar): T567 add generic ConfirmModal component (8eac425)
- refactor(task-detail): T571 make agents section read-only in TaskDetailModal (791ff71)
- feat(tabbar): T572 replier sous-onglets inactifs en pastilles compactes (05d9469)
- chore(tabbar): T573 améliorer couleur icône terminal dans header groupe (54092bb)
- feat(sidebar): T557 T566 add i18n keys for agent groups (46081bc)
- feat(sidebar): T557 agent groups — editable groups + drag & drop (9a4d573)
- fix(terminal): T564 remove anonymous event listeners to prevent PerformanceEventTiming leak (7738739)
- fix(back-electron): T563 dispose onData listener on PTY natural exit (8b34ab2)
- docs(release): update README and JSDoc for v0.10.0 (ebe7ebc)
- docs(release): update README and JSDoc for v0.10.0 (7753821)
- perf(terminal): T559 réduire RAM xterm.js — scrollback 150 + WebGL dispose/recreate (0dffaba)
- feat(board): T553 afficher et bloquer les tâches avec dépendances non résolues (aeaac46)
- perf(terminal): T561 libérer systemPrompt/userPrompt après capture convId (2b218fc)
- feat(security): T547/T550 migrate github_token from build-time to DB runtime (fbe16e1)
- feat(back-electron): T552/T556 blocker check + agent_groups IPC (4fbfdb9)
- test(store): T558 add agent groupings unit tests + AgentGroup type (3d4caca)
- feat(terminal): T518 call collectSessionTokens on session close (a42f0f8)
- perf(store): T521 batch openTask IPC calls — add taskAssignees (90db6fc)
- feat(agents): T541 add secu/perf/data to CreateAgentModal type list (03edbcf)
- test(ipc): T552 add tests for TASK_BLOCKED blocker check in updateStatus (5908033)
- feat(ipc): T552 block in_progress transition when unresolved dependencies exist (5d44925)
- fix(task-detail): T520 add missing valideurAgent tests in TaskDetailModal (04e9bf8)
- feat(tokens): T518 add session:collectTokens IPC handler to persist token counts on session close (8c7ef05)
- fix(scripts): T539 move zombie cleanup before session limit check (0a08f6e)
- refactor(sidebar): T554 supprimer section logs et simplifier backlog en navigation directe (7c7d3d5)
- test(security): fix ipc.spec.ts for T527/T528/T531 security fixes (1a40535)
- fix(security): T532-fix PTY ownership check in write/resize/kill/relaunch handlers (5f00b84)
- fix(security): T531-fix fs:writeFile use extension whitelist instead of path blacklist (dbbe976)
- fix(security): T527-fix T528-fix assertProjectPathAllowed in find-project-db and create-project-db (9c6a93d)
- fix(board): T537 pagination archives visible — BoardView flex-1 min-h-0 (13028e1)
- perf(front): T519/T521/T523/T525/T526/T533 réductions allocations computed (078edea)
- feat(agents): support max_sessions=-1 for unlimited parallel sessions (T534) (50db792)
- fix(security): T529 add assertDbPathAllowed to 5 unprotected IPC read handlers (73af3eb)
- test(ipc-fs,useModalEscape): add unit tests for buildTree and useModalEscape composable (63c6414)
## [0.8.0] - 2026-02-26

### Changes
- chore(git): ignore accidental tilde-expansion artefact directory (e85076c)
- feat(agents): add maxSessions + permissionMode to updateAgent IPC type declaration (d7cba25)
- feat(agents): add max_sessions field — AgentEditModal UI (4d1b2a8)
- fix(back): handle missing max_sessions column gracefully in dbstart.js (ccb2d69)
- feat(agents): add duplicate via context menu (ed5ab4e)
- feat(kanban): persist task status to DB on drag & drop (95332f5)
- test(agentColor): update assertions for variable saturation (T464) (421330a)
- test(components): remove 40 implementation-detail tests (4078→3439 lines) (2122bcc)
- feat(ux): add spell check context menu (146c6c1)
- feat(agents): add max_sessions field — DB migration + IPC + dbstart (59a7c58)
- fix(arch): update session close instruction to statut=completed (1605f81)
- feat(ux): expand agent color palette with saturation variation (47c1655)
- fix(scripts): use English session status values (started/completed) (aed8da9)
- feat(ux): always show task ID in agent tab when task is active (0540096)
- fix(auto-close): poll for statut=completed (was terminé) (2897cd5)
- feat(ux): enable spellcheck on prompt textareas (96219b2)
- feat(ux): enable spellcheck on prompt textareas (3a8d353)
- fix(board): skip launch when task already in_progress (50515c0)
- fix(ux): document onNameInput and move shortcut hint near Save button (4844f9c)
- fix(ux): remove system prompt display block from LaunchSessionModal (d3aa592)
- fix(ux): move delete button to left side of CreateAgentModal footer (0a786cd)
- feat(build): embed GitHub token at build time (69a956a)
- fix(agentColor): make tag colors reactive on theme switch (0d7d3e2)
- fix(sidebar): remove redundant "edit system prompt" context menu item (3b61b73)
- fix(tabs): do not steal focus when auto-launching agent terminal (e69c98f)
- fix(ui): move assigned agent to right column in ticket detail view (9fda96e)
- feat(agents): add delete button to CreateAgentModal edit mode (18cad0f)
- fix(store): re-register dbPath on cold start to fix DB_PATH_NOT_ALLOWED (1c0ec79)
## [Unreleased]

## [0.7.0] - 2026-02-26

### Added
- **Multi-agent assignments:** Multiple agents per task with primary/support/reviewer roles — schema migration v4, IPC `task:getAssignees`/`task:setAssignees`, TaskCard avatars (T412, T414, T415)
- **Delete agent:** Right-click delete with full cascade (sessions, locks, tasks) + confirmation dialog (T422, T437)
- **Permission mode per agent:** `--dangerously-skip-permissions` opt-in per agent with visible warning in UI (T426)
- **Scope selector in AgentEditModal:** Dropdown to assign/change agent scope from the edit modal (T423)
- **Add scope from AgentEditModal:** Create new perimetres inline without leaving the modal (T438)
- **Auto-launch terminals:** Parameterizable per agent — configurable per-agent auto-launch behavior (T411)
- **Archive pagination:** Paginated archive view (50 tasks/page), excluded from main refresh for perf (T429)

### UX
- **Archive cards:** Visual redesign of archive task cards (T427)
- **AgentLogsView:** Full visual redesign of the agent logs view (T430)

### Fixed
- **dbstart:** Reject purely numeric agent names (exit 3) (T444)
- **dbstart:** Auto-release zombie session locks on startup (T442)
- **dbstart:** Use `en_cours` status for parallel session limit check (T441)
- **auto-close:** DB polling for terminal close — give agents time to write exit comment (T443)
- **workflow:** Invert exit comment / done order — comment written before `statut=done` (T440)
- **store:** Re-register dbPath allowlist on app restart (T421)

### Tests
- `task:getAssignees` / `task:setAssignees` IPC handlers (T416)
- Multi-agent UI components (T417)
- `task:setAssignees` in-memory DB tests (T418)
- `add-perimetre` IPC handler (T424)

### Build
- **electron-builder.yml:** Windows build configuration (NSIS installer, icon, compression) (T428)
- **App icon:** New iconcraft icon (741706 bytes, build/icon.png) (T432)
- **installer.nsh:** NSIS custom hooks — add/remove `resources\bin` from system PATH (sqlite3.exe)

### Docs
- CONTRIBUTING.md: translated to English, updated IPC handlers table for v0.7 (T431)
- README.md: translated to English, updated features list and version badge to 0.7.0

## [0.6.0] - 2026-02-26

### Security
- **safeStorage:** Token GitHub chiffré via Electron safeStorage avec fallback documenté (T356)
- **CSP:** Suppression de `unsafe-inline` pour les styles (T357)
- **SSRF:** Mitigation sur `test-github-connection` / `check-for-updates` (T359)
- **Locks:** Fix libération des locks en fin de session agent — 15 locks non libérés corrigés (T401)

### Performance
- **CommandPalette:** `toLowerCase` sur descriptions O(N) par keystroke déplacé en cache (T378)
- **TokenStatsView:** Refetch évité via `v-show` au lieu de `v-if` (T380)
- **CodeMirror 6:** Lazy-load des parsers de langages (~200-300 KB économisés) (T381)
- **Terminal:** Suppression création/destroy `setTimeout` par chunk PTY dans `markTabActive` (T386)
- **Polling:** Double polling 30s+60s remplacé par file watcher (T387)
- **FTS:** Recherche LIKE sur titre/description remplacée par Full-Text Search (T388)
- **WSL:** Appels `wsl.exe` parallèles limités en concurrence dans `getClaudeInstances` (T389)
- **Cache:** `getClaudeInstances()` — latence 0.5-2s éliminée (T365)

### Added
- **Multi-agents:** Migration schema v4 + IPC `task:getAssignees` / `task:setAssignees` (T414)

### Fixed
- **Tabs:** Onglets dupliqués quand le premier tab agent est fermé (T408)

### Tests
- Tests `src/main/terminal.ts` (T350)
- Tests stores Pinia + composables (T352)
- Tests composants Vue critiques (T353)

### Docs
- README Vitest version + JSDoc `writeDb` + CONTRIBUTING stale fixes (T406)
- Protocole tracking tokens documenté (T407)

## [0.5.1] - 2026-02-26

### Fixed
- **Terminal:** user prompt passé en argument CLI (`claude <prompt>`) au lieu d'écriture PTY avec détection de readiness — corrige la perte silencieuse du prompt au lancement (T344)

### Removed
- Dépendance `node-sqlite3-wasm` inutilisée (~3-4 MB de poids mort)

## [0.5.0] - 2026-02-26

### Added
- **Auto-launch terminals** — agent terminal sessions auto-start when task is created with assignee (`useAutoLaunch` composable, 18 tests)
- **Auto-trigger review** — review session launches automatically when 10+ tasks reach done status (configurable threshold, cooldown)
- **Mandatory assignee** — `agent_assigne_id` required on tasks (DB migration + UI validation + agent suggestion by scope)
- **CLAUDE.md injection** — `insertAgentIntoClaudeMd` exported for unit testing (10 tests)
- `src/main/claude-md.ts` + `claude-md.spec.ts` — CLAUDE.md manipulation module
- `src/main/db.spec.ts` — DB utility tests (7 tests)
- `src/renderer/src/composables/useAutoLaunch.ts` + spec

### Changed
- Massive test expansion: 491 tests across 10 suites (components, stores, IPC, migration, utils)
- `agentColor.ts` reactive to dark/light mode switching (24 tests)
- IPC agents restructured (`ipc-agents.ts`)
- Default agents system prompts expanded
- Settings store extended with auto-launch toggle
- WORKFLOW.md updated with heredoc stdin reminder + system_prompt_suffix docs

### Fixed
- Light/dark mode agent colors now reactive to theme changes
- Visual bugs in light mode (agent colors, terminal tabs, log tags)
- Conditional WSL cleanup — only when WSL sessions actually exist

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

[Unreleased]: https://github.com/IvyNotFound/agent-viewer/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/IvyNotFound/agent-viewer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/IvyNotFound/agent-viewer/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/IvyNotFound/agent-viewer/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/IvyNotFound/agent-viewer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/IvyNotFound/agent-viewer/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/IvyNotFound/agent-viewer/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/IvyNotFound/agent-viewer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/IvyNotFound/agent-viewer/releases/tag/v0.3.0
[0.2.0]: https://github.com/IvyNotFound/agent-viewer/releases/tag/v0.2.0
[0.1.0]: https://github.com/IvyNotFound/agent-viewer/releases/tag/v0.1.0
