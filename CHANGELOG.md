# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [0.35.3] - 2026-04-01

### Features
- feat(front-vuejs): update cost display for non-Claude CLI sessions (T1366) (fec625a)
- feat(front-vuejs): add preferred_model field to agent create/edit modals (T1365) (8503107)
- feat(back-electron): token telemetry for non-Claude CLIs (T1364) (070b667)
- feat(front-vuejs): auto-close tab on process exit for non-Claude CLIs (T1373) (4b2e591)
- feat(front-vuejs): set gemini.convResume=true in cliCapabilities (T1372) (9f0a3ef)
- feat(back-electron): inject lifecycle hooks for Gemini CLI and Codex CLI (T1371) (5584d5e)
- feat(back-electron): add session resume support to Gemini CLI adapter (bedd729)
- feat(global): add model selection flag support for Gemini CLI (-m) (edfe6bb)
- feat(front-vuejs): add OpenCode default model field in settings CLI section (25ad58b)

### Bug Fixes
- fix(back-electron): add eslint-disable for no-explicit-any in adapter extractTokenUsage (eba0e62)
- fix(back-electron): rename T1364 migration to v31, fix opencode step_finish test conflict (T1364) (f960077)
- fix(front-vuejs): remove auto-scroll and scroll button from HookEventsView (7e074ad)
- fix(back-electron): handle new opencode text event part-wrapped format (37fe336)

### Tests
- test(back-electron): update opencode spec for v1.3.4+ part-wrapped format (a44f18a)

### Documentation
- docs(back-electron): add JSDoc to extractTokenUsage, TokenCounts, and related types (86d9c94)
- docs(skills): add mandatory session_start log step in agent-session-starting (T1368) (af242ae)

### Chores
- chore(deps): update package-lock.json (832e397)
- chore(back-electron): migration v30 — add preferred_model column to agents (T1354) (18b864f)
- chore(back-electron): upgrade electron to 41.0.3 and better-sqlite3 to 12.8.0 (b5dce82)
- chore(deps): bump dompurify 3.3.2→3.3.3 and @types/dompurify 3.0.5→3.2.0 (#21) (7e27d1e)
- chore(deps-dev): bump the vue group across 1 directory with 3 updates (01d4869)
- chore(deps-dev): bump electron in the electron group (2b1fa5d)
- chore(deps-dev): bump the testing group with 2 updates (d3ab3bd)
- chore(deps): bump slackapi/slack-github-action from 2.1.0 to 3.0.1 (efebb63)
- chore(deps-dev): bump postcss from 8.5.6 to 8.5.8 (cf1f0b0)

### Other
- Merge pull request #22 from IvyNotFound/dependabot/npm_and_yarn/vue-736ede71e4 (aa9030d)
- Merge pull request #17 from IvyNotFound/dependabot/github_actions/slackapi/slack-github-action-3.0.1 (5f46d43)
- Merge pull request #15 from IvyNotFound/dependabot/npm_and_yarn/postcss-8.5.8 (129385d)
- Merge pull request #20 from IvyNotFound/dependabot/npm_and_yarn/testing-dd5d044042 (03a87ea)
- Merge pull request #18 from IvyNotFound/dependabot/npm_and_yarn/electron-89fed64323 (20c3bf8)

## [0.35.2] - 2026-03-31

### Bug Fixes
- fix(migration): skip bootstrap for external DBs missing permission_mode/max_sessions (7f61899)
- fix(front-vuejs): mask zombie started sessions in topology (T1308) (ca0c03e)

### Tests
- test(front-vuejs): kill surviving mutants in staleTask and taskTree (T1330) (fb37649)
- test(front-vuejs): kill surviving mutations in tabs.ts and tasks.ts (T1342) (bb92bb3)
- test(back-electron): raise hookServer.ts mutation score from 64% to ~87% (T1336) (1eb32ba)
- test(front-vuejs): kill agentColor+agents mutants — sat math, hash, sort, FIFO (T1319) (e2893da)
- test(front-vuejs): add mutation-killing specs for tabs, tasks, useTaskRefresh (T1348) (fa221ad)
- test(back-electron): kill surviving mutants in ipc-telemetry (T1324) (f244b7e)
- test(front-vuejs): add whereClause/andOrWhere/fetchStats tests to useTokenStats (T1326, T1332, T1344) (3451072)
- test(back-electron): kill surviving mutants in migration-runner (T1340) (14c21d8)
- test(front-vuejs): kill agentColor mutation survivors — SAT_STEPS, Math.min cap, FIFO, arithmetic (T1349) (6af815c)
- test(front-vuejs): kill surviving mutants in useStreamEvents (T1347) (378b5e9)
- test(front-vuejs): kill surviving mutations in useLaunchSession (T1346) (647fdae)
- test(front-vuejs): kill surviving mutants in useLaunchSession & useAutoLaunch (T1338) (93318f3)
- test(front-vuejs): kill L125/L127 mutants in useAutoLaunch (T1327) (4502440)
- test(front-vuejs): kill surviving mutations in useTaskRefresh and tabs (T1314) (d0627ab)
- test(front-vuejs): kill surviving mutants in utils/parseDate (T1311) (a17082b)
- test(back-electron): kill surviving mutations in migration-runner idempotence guards (T1325) (f8ebb92)
- test(back-electron): add real-DB tests for v2-statuts and v3-relations migrations (T1334) (5b5d12a)
- test(back-electron): add schema-init.ts tests to raise mutation score (T1331) (2e7814c)
- test(front-vuejs): kill ConditionalExpression mutations in useAutoLaunch (T1345) (a929f7c)
- test(front-vuejs): kill surviving mutants L149/L199/L203 in tasks store (T1329) (7027e12)
- test(front-vuejs): add missing branch tests for useArchivedPagination, useConfirmDialog, useToolStats (T1341) (ff5c9dc)
- test(back-electron): kill LogicalOperator L103 & err-reject mutants in worktree-manager (T1320) (b63534e)
- test(front-vuejs): kill P2 mutations in staleTask, renderMarkdown, taskTree (T1339) (e71152a)
- test(front-vuejs): add localStorage initialisation tests for stores/project (T1343) (4ba75a0)
- test(front-vuejs): add useLaunchSession coverage for T1312 (436affb)
- test(back-electron): kill surviving mutants on hookServer auth/routing (T1316) (9789fcf)
- test(front-vuejs): add T1313 mutation coverage for useAutoLaunch (14ddc9b)
- test(renderer): kill surviving mutations in useTabBarGroups + useStreamEvents (T1318) (6b3ebc7)
- test(front-vuejs): add useTokenStats specs — mutation score T1310 (7918061)
- test(back-electron): kill survived mutants in ipc-agent-sessions syncAllTokens (T1321) (ae3e329)
- test(back-electron): add ipc-agent-groups spec covering cycle detection & setParent handler (T1317) (c553fae)
- test(back-electron): kill trusted path mutants L293/L299 in ipc-project (T1322) (9add9a2)
- test(back-electron): add security tests for isPathAllowed & fs handlers (T1315) (a7be005)
- test(back-electron): kill surviving mutations in ipc-wsl (T1323) (1a7d1af)

### Documentation
- docs(readme): add Mutation Testing section (T1350) (f65b9b8)

### Chores
- chore(gitignore): ignore all .stryker-* directories (17a3246)
- chore(global): replace remaining agent-viewer references with KanbAgent (9a835d8)

## [0.35.1] - 2026-03-10

### Bug Fixes
- fix(front-vuejs): appeler setProjectPathOnly depuis useProjectStore (T1300) (b2863be)

### Tests
- test(front-vuejs): update snapshots after aboutDesc/tagline i18n changes (245d976)

### Documentation
- docs(global): migrate all project documentation to English (T1305) (5f127bd)
- docs(contributing): fix module name ipc-wsl.ts -> ipc-cli-detect.ts for wsl:get-cli-instances (9c6dd47)
- docs(global): aligner la documentation sur les versions et API réelles (T1303) (2171d6b)
- docs(claude-md): clarify commit messages must be in English (T1301) (849b3c3)
- docs(front-vuejs): remove generic Claude references from README (T1302) (c0e9efb)

### Other
- i18n(front-vuejs): supprimer les références Claude dans aboutDesc et tagline (18 locales) (6cae197)

## [0.35.0] - 2026-03-10

### Features
- feat(front-vuejs): i18n des chaînes hardcodées dans StreamView (T1291) (ef1a072)

### Bug Fixes
- fix(back-electron): detectManuallyClosed ignore agents with in_progress tasks (T1297) (0b17a32)
- fix(front-vuejs): ne pas auto-fermer StreamView si utilisateur a interagi (T1294) (3fee8cd)
- fix(front-vuejs): mettre à jour snapshots DbSelector post-T1271 (T1292) (58cb3ad)
- fix(front-vuejs)!: intégrer T1271 DbSelector instance unifié + T1274 worktree DB-aware + T1290 JSDoc (5a0892d)

### Chores
- chore(deps): migrer ESLint v9 → v10 (T1287) (3064fe1)

### Other
- Revert "fix(front-vuejs): ne pas auto-fermer StreamView si utilisateur a interagi (T1294)" (c8a47bd)
- i18n(front-vuejs): traduire noInstanceMac et noInstanceWin dans 17 langues (T1296) (96f762b)

## [0.34.0] - 2026-03-10

### Bug Fixes
- fix(front-vuejs): supprimer la mention Claude dans la tagline (T1269) (98f5189)

### Refactoring
- refactor(front-vuejs): migrer composants vers sous-stores directs (T1280) (119f1f6)
- refactor(back-electron): typer le preload avec schemas Zod partagés (T1278) (3016633)

### Tests
- test(front-vuejs): couvrir useStreamEvents et useTaskRefresh — mutation P2 (T1282) (96e984b)
- test(front-vuejs): quick wins mutation — agentColor, sidebar composables + exclude main.ts (T1286) (df20735)
- test(front-vuejs): couvrir gaps mutation stores tabs/settings/agents/hookEvents/tasks (T1285) (eb6ebb9)
- test(front-vuejs): snapshots visuels 10 composants principaux (T1283) (c40726a)
- test(back-electron): add mutation-killing tests for worktree-manager (T1273) (893a593)
- test(back-electron): add mutation-killing tests for spawn-wsl, spawn-windows, stream-handlers (T1273) (0f23ea1)
- test(back-electron): améliorer la couverture mutation des IPC agents T1268 (f4380e7)
- test(back-electron): améliorer couverture mutation hookServer et hookServer-inject (T1267) (08988d3)

### Documentation
- docs: update README for release 0.34.0 (T1290) (3e88eeb)
- docs(global): JSDoc et README pour la release 0.33.0 (T1265) (b5e5f0d)

### Chores
- chore(deps-dev): bump jsdom from 26.1.0 to 28.1.0 (#13) (14e1e4b)
- chore(deps-dev): bump autoprefixer from 10.4.24 to 10.4.27 (#16) (e341d08)

## [0.33.0] - 2026-03-10

### Features
- feat(back-electron): bundle templates locally for init-new-project (T1261) (e91f066)

### Bug Fixes
- fix(front-vuejs): rendre les messages d'onboarding agnostiques au CLI (T1260) (a237904)

### Other
- ux(front-vuejs): déplacer le sélecteur de langue en bas de la card (T1259) (7fb404d)

## [0.32.0] - 2026-03-10

### Features
- feat(back-electron): forwarder stderr en temps réel pour CLIs non-Claude (T1248) (6e13b9b)
- feat(back-electron): validation runtime zod sur handlers IPC critiques (T1227) (915805c)

### Bug Fixes
- fix(back-electron): close stdin immediately for opencode on spawn (T1244) (55994b2)
- fix(back-electron): corriger gemini sans réponse dans streamview (fc640e9)

### Refactoring
- refactor(back-electron): extraire les stratégies spawn de agent-stream.ts (37a2237)

### Tests
- test(back-electron): recover 4 spec files from orphan commit (T1221) (54012ff)
- test(back-electron): kill mutation survivors in agent-stream.ts — StringLiteral/Conditional/Logical (T1218) (23a5e3b)
- test(back-electron): améliorer couverture mutation migration-runner.ts (T1229) (f11eff5)
- test(front-vuejs): améliorer couverture mutation parseDate.ts et créer i18n.spec.ts (T1237) (19c09b2)
- test(front-vuejs): ajouter tests T1220 pour useStreamEvents.ts (44 tests) (2d328fc)

### Documentation
- docs(global): documenter la validation worktree dans agents et WORKFLOW.md (7c69df6)
- docs(global): créer le diagramme ERD du schéma DB v6 (T1238) (c5509c2)
- docs(global): mettre à jour README et JSDoc pour release 0.31.6 (T1252) (22ccd01)

### Chores
- chore(front-vuejs): élever no-explicit-any en error pour le renderer (T1233) (0d3d410)

## [0.31.8] - 2026-03-10

### Bug Fixes
- fix(session-closer): exclure les agents avec session active dans detectManuallyClosed et pollSessionStatus (45f2358)

## [0.31.7] - 2026-03-09

### Bug Fixes
- fix: corriger les fermetures intempestives d'onglets agents (c4ebff1)
- fix(back-electron): cleanup automatique des worktrees orphelins au démarrage (T1232) (c9c276d)

### Refactoring
- refactor(back-electron): migrer hookServer vers l'API better-sqlite3 native (T1224) (f95c44b)

### Tests
- test(back-electron): renforcer assertions ipc-project.ts T1226 (2d39e6f)
- test(back-electron): renforcer tests ipc-cli-detect.ts (T1225) (b2da255)
- test(back-electron): update hookServer-db.spec.ts for writeDbNative migration (T1224) (03519be)
- test(front-vuejs): add mutation-killing tests for utils/cliCapabilities.ts (T1235) (21e6eb9)
- test(back-electron): strengthen worktree-manager mutation coverage (T1228) (4b05b2b)
- test(back-electron): renforcer les tests hookServer + hookServer-inject (T1219) (959bced)
- test(front-vuejs): ajouter couverture useTabBarGroups (T1223) (65f097c)

### Documentation
- docs(back-electron): merge IPC-REFERENCE.md (T1236) (3c40339)
- docs(back-electron): créer la référence IPC centralisée (T1236) (9ceb707)

### Chores
- chore(build): exclure .claude/ du bundle electron-builder (9166a2d)
- chore(back-electron): migrate no-explicit-any from warn to error in main/ (126c557)
- chore(ci): add progressive coverage gate in vitest.config.ts (T1230) (9abe390)
- chore(front-vuejs): élever no-explicit-any en error pour le renderer (T1233) (79cabfd)
- chore(release): sync CLAUDE.md version on release + fix current version to 0.31.4 (11945fd)

## [0.31.6] - 2026-03-09

### Bug Fixes
- fix(front-vuejs): keyer useAutoLaunch par tabId pour supporter le multi-tab (T1249) (5d4c885)
- fix(workflow): instruire review à valider depuis la branche agent worktree (1c587f7)

### Tests
- test(front-vuejs): ajouter tests T1246 pour fermeture onglets no-task + update CLAUDE.md protocole worktree (49386a6)

### Chores
- chore(docs): update CLAUDE.md version to 0.31.5 (58a09a6)

## [0.31.5] - 2026-03-09

### Bug Fixes
- fix(front-vuejs): corriger les fermetures intempestives d'onglets agents (T1242) (d57171b)

## [0.31.4] - 2026-03-09

### Changes
- Initial release

## [0.31.3] - 2026-03-09

### Bug Fixes
- fix(front-vuejs): résoudre la cascade worktree dans launchAgentTerminal (T1240) (b812794)
- fix(e2e): rename agent-viewer temp dir prefix to kanbagent (T1216) (30676e2)

## [0.31.2] - 2026-03-09

### Bug Fixes
- fix(front-vuejs): exempt task-creator from no-task auto-close (d5b2ef0)

### Documentation
- docs(global): rename agent-viewer → KanbAgent in README, CLAUDE.md, ADRs and skills (T1211) (782714f)

### Chores
- chore(global): ignore npm-placeholder directory (dc85c39)
- chore(back-electron): rename agent-viewer → KanbAgent in src/shared/cli-types.ts (T1209) (bba8093)
- chore(back-electron): rename agent-viewer → KanbAgent in src/main and config (T1209) (fea5216)
- chore(global): rename GitHub repo from agent-viewer to KanbAgent (7663e25)

## [0.31.1] - 2026-03-09

### Features
- feat(back-electron): extend pruneOrphanedWorktrees to new-format worktrees (T1207) (85dccbb)
- feat(back-electron): prune orphaned worktrees on project load (T1206) (6144ec0)
- feat(front-vuejs): display text/error events in StreamView for non-Claude CLIs (T1197) (d98c61b)

### Bug Fixes
- fix(back-electron): ensure worktree removal on tab close (T1205) (9178a45)
- fix(front-vuejs): align ProjectPopup style with other modals (T1202) (fa7b014)
- fix(back-electron): session-closer detects manually-closed sessions (T1204) (9f0fb0f)
- fix(front-vuejs): replace anglicisms scope/Scopes with périmètre/Périmètres in fr.json (T1203) (ee06b92)
- fix(back-electron): emit PascalCase hook event names to match renderer expectations (T1200) (5ac8c8a)
- fix(front-vuejs): fix SettingsModal height to be constant across sections (T1201) (bf80dd7)
- fix(back-electron): add formatStdinMessage to gemini adapter (T1198) (0fe349a)
- fix(back-electron): pass settings file path directly to --settings on Windows (T1195) (ea6a07c)

### Documentation
- docs(front-vuejs): add JSDoc to selectProject, openTask and layout functions (T1189) (3ff01b9)
- docs(back-electron): add inline comments in ipc-agent-tasks context builder (T1187) (0bf939c)

### Chores
- chore(global): ignore audit reports and local PS1 scripts in gitignore (107a137)
- chore(deps-dev): bump @pinia/testing 0.1.7→1.0.3 + pinia 2→3 (T1193) (eddc9dc)
- chore(deps-dev): bump electron in the electron group (e7c3064)
- chore(deps-dev): bump the vue group with 2 updates (2779094)
- chore(deps-dev): bump @codemirror/lang-javascript from 6.2.4 to 6.2.5 (5bb6912)
- chore(deps): bump actions/setup-node from 4 to 6 (010c529)
- chore(deps): bump actions/upload-artifact from 4 to 7 (96bcab8)
- chore(deps): bump actions/checkout from 4 to 6 (80ff7c0)
- chore(deps-dev): bump marked from 17.0.3 to 17.0.4 (343d219)
- chore(deps): bump actions/download-artifact from 4 to 8 (7daeea1)

### Other
- Merge pull request #5 from IvyNotFound/dependabot/github_actions/actions/upload-artifact-7 (65566e8)
- Merge pull request #4 from IvyNotFound/dependabot/github_actions/actions/checkout-6 (092dcb9)
- Merge pull request #3 from IvyNotFound/dependabot/github_actions/actions/setup-node-6 (a48393d)
- Merge pull request #2 from IvyNotFound/dependabot/github_actions/actions/download-artifact-8 (33a1ef6)
- Merge pull request #6 from IvyNotFound/dependabot/npm_and_yarn/electron-071b959d73 (77ace7b)
- Merge pull request #9 from IvyNotFound/dependabot/npm_and_yarn/codemirror/lang-javascript-6.2.5 (a1de7b9)
- Merge pull request #7 from IvyNotFound/dependabot/npm_and_yarn/vue-5a201692e0 (12e79e7)
- Merge pull request #8 from IvyNotFound/dependabot/npm_and_yarn/marked-17.0.4 (274c550)

## [0.31.0] - 2026-03-09

### Features
- feat(global): force agents to develop from dedicated worktree (T1179) (5c7e3ad)
- feat(front-vuejs): auto-close agent tab groups on session completion (T1186) (028a1ee)
- feat(back-electron): emit session:agents-completed IPC when session-closer closes sessions (T1184) (57f2408)
- feat(front-vuejs): ajouter le toggle worktree dans CreateAgentModal (mode edit) — T1183 (8190e29)
- feat(front-vuejs): increase stream history limits — MAX_EVENTS 500→2000, MAX_EVENTS_HIDDEN 10→200 (6ada3db)

### Bug Fixes
- fix(front-vuejs): declare onSessionsCompleted in electron.d.ts (T1194) (58a1cc0)
- fix(back-electron): hookServer — validate cwd against allowlist before writeDb (T1175) (335d480)
- fix(back-electron): find-project-db no longer self-registers arbitrary paths — T1173 (0ef89d4)
- fix(back-electron): validate query-db params types before passing to better-sqlite3 (T1178) (709e599)
- fix(back-electron): remove CSP style-src unsafe-inline in production (T1177) (90cd57c)
- fix(back-electron): hookServer bind to 127.0.0.1 instead of 0.0.0.0 (T1172) (223d41e)
- fix(front-vuejs): add allowedDir param to fs API types in electron.d.ts (T1174) (7140865)
- fix(back-electron): watch parent dir for WAL-mode SQLite + reduce poll to 30s (8603ad8)
- fix(back-electron): opencode local Windows — pass initial message as positional arg (fbc4452)
- fix(back-electron): opencode local Windows stdin hang — formatStdinMessage + singleShotStdin (beb4712)
- fix(back-electron): remove -p '' from gemini adapter — crashes with empty prompt value (aa4fbd9)

### Documentation
- docs(global): add screenshot 2026-03-09 (1ec5106)
- docs(front-vuejs): add JSDoc to MAX_EVENTS constants (T1181) (697ade1)

### Chores
- chore(back-electron): move rollup build deps to devDependencies (T1185) (87ce4c0)

### Other
- ux(front-vuejs): unlimited depth sidebar groups — dynamic indent, visual guides, collapse persistence (c9720e5)
- ux(front-vuejs): harmonize dashboard tab styles on telemetry model (f5ff583)

## [0.30.0] - 2026-03-08

### Features
- feat(front-vuejs): add worktree isolation toggle in agent modal and settings (T1143) (788ce78)
- feat(ci): add ESLint gate to release pipeline and script (T1139) (a062d9b)
- feat(back-electron): migrate sql.js to better-sqlite3 + WAL mode (T1157) (4409094)
- feat(back-electron): add worktree_enabled column to agents + worktree_default config (T1142) (92d2ebb)

### Bug Fixes
- fix(front-vuejs): escape HTML entity in SuccessRateChart + update snapshots and comments (e245cec)
- fix(front): repair 4 failing tests — T1162 (abc66a8)
- fix(back-electron): correctifs T1161 — FK sessions ref + readline mocks + telemetry (f88c3c8)
- fix(back-electron): fix step() multi-row iteration + update CLAUDE.md (T1157) (5011e30)
- fix(back-electron): await initial listen() settle in createTestServer() to prevent EADDRINUSE race (T1159) (9143571)
- fix(front-vuejs): handle launch errors and restore maxFileLines in modal (T1152) (4fe323a)
- fix(back-electron): move db.close() to finally + rewrite dbw test for Vitest (T1155) (ab8c6ca)
- fix(back-electron): support multi-statement SQL in dbw.js (T1155) (5211c57)
- fix(back-electron): recycle sql.js WASM module to prevent 9.5 GB memory leak (T1154) (4dea18d)
- fix(back-electron): resolve .cmd wrapper to bypass cmd.exe JSON corruption (T1151) (a7ca445)
- fix(front-vuejs): guard localStorage access for Node 25+ test compat (T1149) (bcd8177)
- fix(back-electron): add worktreeEnabled to getAgentSystemPrompt type contract (T1150) (915d58d)
- fix(front-vuejs): add error rollback in setWorktreeDefault store setter (T1147) (ace34a6)
- fix(back-electron): use .gitignore rules in telemetry scan instead of hardcoded IGNORE_DIRS (T1144) (f2118fe)
- fix(front-vuejs): update StreamView-eviction test assertions for MAX_EVENTS_HIDDEN=10 (T1135) (51bac05)
- fix(deps): upgrade dompurify 3.3.1 → 3.3.2 (GHSA-v2wj-7wpq-c8vv) (T1123) (4874aaa)
- fix(back-electron): add security test for assertProjectPathAllowed in telemetry:scan (T1115) (3af0de5)

### Performance
- perf(front-vuejs): reduce StreamView hidden-tab eviction + clear _html + limit active tasks (T1135) (59fb296)
- perf(front-vuejs): replace Math.min spread with reduce in TimelineView rangeStart (b2e5a7c)
- perf(back-electron): reduce DB cache TTL and add default query LIMIT (T1136) (0151de2)

### Refactoring
- refactor(front-vuejs): unify session launch paths into single composable (T1152) (c1d8177)
- refactor(front-vuejs): uniformiser le style des onglets dashboard sur TelemetryView (2312560)

### Tests
- test(back): add HTTP server coverage for hookServer.ts — 34 new tests (T1101) (b02aa07)

### CI
- ci(release): npm audit critical + slack notify on failure (0880cb0)
- ci: timeouts + concurrency + coverage summary + dependabot + badges (52a207a)
- ci(release): add unit-tests gate + group CHANGELOG by conventional commit type (b820c63)
- ci: remove standalone e2e workflow — E2E now runs in release pipeline only (3fd142c)

### Documentation
- docs(global): update sql.js references to better-sqlite3 (T1158) (b278f37)

### Chores
- chore(deps): update package-lock.json (6eb3c01)
- chore(i18n): add missing worktree keys to 16 non-EN/FR locales (T1143) (bd51431)
- chore: ignore project.db.test_* files in .claude/ (345741c)
- chore(test-back): split spec files > 400 lines into smaller modules (T1132) (a3800fd)
- chore(test-front): split spec files > 400 lines into smaller modules (T1134) (f9db53e)
- chore(front-vuejs): split source files > 400 lines (T1133) (e081480)
- chore(test): move CURRENT_SCHEMA_VERSION test to migration-runner-2 to keep both files under 400 lines (T1129) (d159569)
- chore(back-electron): split source files > 400 lines (T1131) (0dbca45)
- chore(test): split migration-runner-2.spec.ts — v20+ to migration-runner-3.spec.ts (4b42715)
- chore(release): update end message — release is now auto-published (838e99c)

## [0.29.2] - 2026-03-08

### Changes
- ci: run E2E only on release and PR, not on every push to main (fa6fa5e)
- ci(release): add i18n-check gate before E2E in release pipeline (b791912)
- chore(i18n): add missing keys launch.refreshDetection and dashboard.telemetryTab in 16 locales (c849ab9)
- chore: ignore worktrees/, mem-dump files and mem-dump.ps1 (babc15b)
- fix(back-electron): batcher IPC wc.send() dans agent-stream + tronquer payloads hookServer (T1137) (54b33f5)
- test: improve assertion quality across spec files (525203d)
- chore(back-electron): add git worktree instructions in system prompts and WORKFLOW.md (T1125) (5ef6e6a)
- ci(release): E2E gate before builds + auto-publish without draft (b5a72f4)
- fix(back-electron): injecter chemin worktree dans le contexte de lancement agent (T1124) (6c82ee4)
- test(front-vuejs): améliorer couverture mutation useAutoLaunch + useLaunchSession (T1105) (7eebf81)
- fix(front-vuejs): use warmup cache in LaunchSessionModal CLI detection (T1118) (16ea111)
- perf(front-vuejs): éliminer les IPC redondants lastRefresh (T1116) (9200b56)
- test(front-vuejs): couvrir renderMarkdown.ts + useUpdater.ts — score 0% et 8% (T1106) (eeaa571)
- test(back-electron): mock ./db dans ipc-telemetry.spec pour assertProjectPathAllowed (T1119) (e20044e)
- perf(back-electron): paralléliser analyzeFile par batch de 20 dans telemetry:scan (T1119) (5947a2a)
- test(front-vuejs): améliorer couverture mutation tasks.ts — +35 tests NoCoverage (T1104) (2043946)
- perf(front-vuejs): split tooltip ref en 3 refs atomiques sans spread (T1120) (5c49f9d)
- perf(front-vuejs): replace correlated subquery with CTE in TopologyView (T1111) (6c139a6)
- perf(back-electron): skip writeDb export+write when 0 sessions closed (T1110) (e77e7d7)
- perf(db): add missing indexes on critical columns — migration v27 (T1113) (b1183e1)
- perf(stores): replace 4 correlated EXISTS with LEFT JOINs in agent_history CTE (T1112) (a25462e)
- fix(back-electron): bypass cmd.exe JSON corruption for --settings on Windows (T1107) (7d7a72b)
- test(back-electron): améliorer couverture mutation migration-runner.ts (T1103) (e883c0d)
- refactor(front-vuejs): déplacer la télémétrie dans un sous-onglet Dashboard (T1100) (0354db8)
## [0.29.1] - 2026-03-08

### Changes
- fix(front-vuejs): worktree default true + i18n Auto button (T1098) (2a776dc)
- chore(front-vuejs): remove obsolete i18n keys from launch namespace (T1095-cleanup) (b92ad5c)
- docs: mettre à jour README et JSDoc pour v0.29.1 (T1086) (42c5b99)
- fix(front-vuejs): platform-aware noInstance messages — remove WSL bias on macOS/Linux (T1092) (5e61b85)
- fix(front-vuejs): capitalize launch.instance label in 14 locales (T1096) (47d3ce8)
- fix(front-vuejs): store cli:distro instead of distro-only for default CLI (T1090) (8ee459f)
- fix(front-vuejs): SettingsModal availableDistros stale + electron.d.ts forceRefresh (T1091) (49cf7ab)
- fix(back-electron): propagate forceRefresh to enrichWindowsPath (T1093) (b43bc1f)
- fix(back-electron): use buildWindowsEnv() for Windows-native spawns (T1089) (ae40ff2)
- fix(front-vuejs): disable Launch button when no CLI instance detected (T1088) (a6a6cfd)
- fix(back-electron): opencode headless mode via run --format json (T1084) (b3017a6)
- fix(back-electron): WSL CLI detection — include Stopped distros + forceRefresh cache (T1085) (2b44c72)
- fix(back-electron): source ~/.bashrc in WSL CLI detection script (T1083) (85661c2)
- fix(back-electron): correct Gemini CLI non-interactive flag (--headless → -p) (T1082) (98b1c6a)
## [0.29.0] - 2026-03-07

### Changes
- chore(deps): update package-lock.json (bcf3ccc)
- chore: add mutation/ to gitignore (stryker output) (8b13244)
- fix(front-vuejs): translate missing i18n keys in 16 non-EN/FR locales (T1079) (ee1755b)
- fix(front-vuejs): fix obsolete SQL columns niveau/fichiers in AgentLogsView (T1078) (23d8f10)
- docs: mettre à jour README et JSDoc pour v0.28.4 (T1060) (ca1d8eb)
- fix(front-vuejs): add :key on FileView to prevent race condition on tab switch (T1080) (07ef268)
- fix(front-vuejs): remove overflow-y-auto on SettingsModal sidebar nav (T1081) (913cda5)
- test(front-vuejs): kill mutation survivors in useAutoLaunch.ts — cooldown, debounce, prevStatus, hasActiveTasks, filter (T1065) (43437a3)
- fix(front-vuejs): remove T1065 out-of-scope describes from useAutoLaunch.spec (T1062) (acb5120)
- test(front-vuejs): kill mutation survivors in tasks.ts — scope filter, DONE_TASKS_LIMIT, setTaskStatut, projectPath, notifications (T1063) (7941a0e)
- test(back-electron): convId validation, worktree guard, taskkill, sessionId guard (T1068) (5b4404e)
- test(front-vuejs): agentColor + settings mutation-killing tests (T1076) (a9443b7)
- test(front-vuejs): improve tabs store mutation coverage — regex, throttle, params, guards (T1069) (9072cda)
- test(renderer): useLaunchSession — cache TTL, prompt parts, WSL selection (T1067) (f85817e)
- test(front-vuejs): mutation-killing tests for useHookEventDisplay + parseDate (T1074) (617f52a)
- test(front-vuejs): add orgChartLayout.ts coverage — positions, dimensions, dotStatus (T1071) (50f3fa5)
- test(back-electron): add ipc-project ZIP/dialog/agentLang coverage (T1077) (6670ad4)
- test(back-electron): add migration-runner.spec.ts — bootstrap, idempotence, v2/v3/v25 guards (T1064) (f9e4138)
- test(back-electron): kill mutation survivors in hookServer.ts (T1066) (182fd31)
- test(back-electron): UUID_REGEX, buildEnv, getActiveTasksLine (T1075) (28228fe)
- test(back-electron): add parseVersion, cache, parseDetectionOutput tests (T1072) (5003620)
- test(back-electron): add ipc-wsl.spec.ts — getWslExe, enrichWindowsPath, getWslDistros, wsl:openTerminal (T1073) (418672b)
- test(back-electron): deep mutation tests for aider/opencode/gemini/goose adapters (T1070) (6177f36)
- feat(front-vuejs): migrate SettingsModal CLI picker to getCliInstances (T1062) (8101d4c)
- chore(back-electron): remove wsl:getClaudeInstances handler (T1059) (e0440d7)
- perf(back-electron): warm up CLI detection at app startup (T1058) (d219340)
- fix(back-electron): improve CLI spawn on Windows local and WSL for non-Claude adapters (T1057) (52bffc2)
## [0.28.3] - 2026-03-07

### Bug Fixes
- fix: WSL detection + multi-CLI launch reliability (T1056) (f813131)

## [0.28.2] - 2026-03-07

### Changes
- fix: WSL detection + multi-CLI launch reliability (T1056) (4a3ecd0)
## [0.28.1] - 2026-03-07

### Bug Fixes
- fix: CLI launch broken on Windows — WSL detection + spawn fallback (T1055) (4d89670)

## [0.28.0] - 2026-03-07

### Changes
- chore(global): supprimer les références aux file-locks dans skills et WORKFLOW.md (T1049) (7b63e2c)
- docs: mettre à jour README et JSDoc pour v0.28.0 (T1039) (0bd04e0)
- fix(back-electron): cross-process .wlock in writeDb + migrateDb (T1053) (aac80bf)
- fix(tests): migrate renderer specs FR→EN after T1016 schema rename (T1052) (7f624f1)
- fix(back-electron): atomic write in migrateDb — tmp+rename prevents corruption (T1046-followup) (0aed1e9)
- feat(front-vuejs): widget télémétrie code + fix heatmap zones creuses (T1050) (ddb42a7)
- fix(scripts): retirer le guard dbw/dbstart — tmp+rename gère la concurrence (8a01993)
- guard(scripts): bloquer dbw.js et dbstart.js si project.db inaccessible depuis WSL (ed36365)
- fix(front-vuejs): supprimer la sélection de profil CLI (T1034) (b4d8e6b)
- feat(front-vuejs): panneau télémétrie tokens dans DashboardOverview (T1047) (3091b0e)
- refactor(back-electron): supprimer canal IPC get-locks et locks dans dbstart (T1046) (2a5a56f)
- test(front-vuejs): remplacer les anciens termes DB français dans les specs (T1038) (c62e8b5)
- ux(front-vuejs): restructurer SettingsModal avec navigation latérale par thématique (T1042) (7dce392)
- feat(front-vuejs): orgchart — layout hiérarchique groupes de groupes (T1041) (215fd78)
- fix(back-electron): session-closer — use agent_id instead of summary LIKE (T1045) (e527ca3)
- fix(front-vuejs): corriger requête SQL statut→status dans useAutoLaunch (T1043) (bc579e9)
- fix(front-vuejs): remove legacy defaultClaudeInstance on write (T1044) (a882d3c)
- fix(front-vuejs): adapt LaunchSessionModal to settings store rename (T1036) (ab571a2)
- test(back-electron): remplacer termes DB français dans les specs backend (T1037) (51208c6)
- feat(front-vuejs): LaunchSessionModal options dynamiques selon capacités CLI (T1036) (9168ea2)
- fix(front-vuejs): renommer defaultClaudeInstance → defaultCliInstance (T1032) (af59fc1)
- feat(back-electron): worktree isolé par défaut pour tous les CLIs (T1031) (0f82dec)
- fix(back-electron): add HKLM system PATH + claudeBinaryPath setting (T1029) (de650be)
- fix(front-vuejs): uniformiser blocs de fond widgets charts + lisibilité légendes (T1030) (24ce416)
## [0.27.1] - 2026-03-07

### Bug Fixes
- fix: align SQL queries and property accesses with English column names (T1016) (de8f008)

## [0.27.0] - 2026-03-07

### Features
- feat(back-electron): multi-CLI support — ipc-cli-detect detects Claude Code, Codex, Gemini, OpenCode locally + WSL (T1011) (5f0ccb4)
- feat(back-electron): cli-adapters + multi-CLI dispatch in agent:create IPC (T1012) (f5fc3b1)
- feat(front-vuejs): LaunchSessionModal — CLI selector + multi-CLI instance picker (T1014) (adec0ae)
- feat(front-vuejs): multi-instance toggle + worktree creation in LaunchSessionModal (T1007) (c4e24b2)
- feat(back-electron): add optional workDir parameter to agent:create IPC (T1006) (3cd9b11)
- feat(back-electron): git worktree prune on session startup in dbstart.js (T1008) (5debb5f)
- feat(arch): ADR-010 multi-CLI CliAdapter architecture + shared cli-types.ts (T1010) (56b790c)

### Fixes
- fix(back-electron): enrich PATH in detectLocalInstance() for Start Menu launch (T1024) (805884f)
- fix(back-electron): make download-sqlite3.js cross-platform (win/mac/linux) (T1021) (3da4bb4)
- fix(back-electron): fix SQL column names in 12 locale agent files post-migration (T1016) (de0b126)
- fix(back-electron): update agent prompts + v25 migration REPLACE for French→English columns (T1016) (a5c6bb6)
- fix(front-vuejs): rename Perimeters label to Scope across all locales (T1017) (05a9955)
- fix(front-vuejs): make dashboard sub-tabs reactive to locale changes (T1027) (cc35dfd)
- fix(i18n): replace hardcoded strings with t() calls in Vue components (T1022) (1188471)
- fix(i18n): translate missing/untranslated keys across all locale files (T1023) (44d8afb)

### Refactor
- refactor(back-electron): normalize DB column/table names to English — migration v25 (T1016) (64c1b6e)

### Chore
- chore(release): block on any pending CI workflow + warn on mutation failure (a7fe84e)
- chore(devops): migrate code-telemetry.ps1 to cross-platform Node.js (T1019) (d46bf75)
- chore(devops): remove stale temporary scripts (T1020) (b542f6d)
- chore(devops): ignore DB backup/dbb files in .gitignore (957be93)
- chore(docs): update schema refs to English columns + multi-CLI docs (T1009,T1016,T1025) (4c37d09)

## [0.26.0] - 2026-03-06

### Changes
- chore(license): add MIT + Commons Clause — prohibit commercial sale (6308883)
- ci(mutation): add push trigger on main branch (3b08f26)
- fix(ci): add --no-sandbox for Electron launch in CI environment (5a43d60)
- fix(front-vuejs): commit missing it.json and ru.json locale files (T971 T974) (9981efe)
- docs: update README and JSDoc for v0.26.0 (T997) (8cecf1f)
- fix(front-vuejs): file tab — contenu absent + icône/label incorrect dans la TabBar (T1002) (a0ce456)
- feat(front-vuejs): add Turkish (tr) locale — i18n + agent prompts (T979) (e642c91)
- fix(front-vuejs): wire GENERIC_AGENTS_KO in default-agents index (T981) (deddd51)
- fix(front-vuejs): wire GENERIC_AGENTS_ZH_CN in default-agents index (T980) (75c50e7)
- feat(front-vuejs): add Chinese Simplified (zh-CN) locale — i18n + agent prompts (T980) (45292f8)
- test(front-vuejs): add snapshot tests for 5 key UI components (T984) (2a062fa)
- fix(ci): replace libasound2 with libasound2t64 for Ubuntu 24.04 (082d686)
- feat(front-vuejs): add Korean (ko) locale — i18n + agent prompts (T981) (b96d7e4)
- feat(front-vuejs): add Finnish (fi) agent prompts — agents-fi.ts (T977) (496e366)
- fix(devops): block release if E2E CI tests are failing on HEAD (d770407)
- feat(front-vuejs): add Japanese (ja) locale — i18n + agent prompts (T982) (37027af)
- feat(front-vuejs): add Spanish (es) locale — i18n + agent prompts (T964) (e42bf94)
- chore(back-electron): split default-agents.ts into modules ≤400 lines (T999) (4d490b3)
- feat(front-vuejs): add Finnish (fi) locale — i18n + agent prompts (T977) (6f40784)
- feat(front-vuejs): add German (de) locale — i18n + agent prompts (T969) (532a896)
- feat(front-vuejs): add Brazilian Portuguese (pt-BR) locale — i18n + agent prompts (T972) (7c8d652)
- feat(front-vuejs): add Polish (pl) locale — i18n + agent prompts (T975) (9890d4b)
- feat(front-vuejs): add Swedish (sv) locale — i18n + agent prompts (T976) (ba07444)
- feat(front-vuejs): add Arabic (ar) locale — i18n + RTL support (T973) (9594440)
- feat(front-vuejs): add Italian (it) locale — i18n + agent prompts (T971) (2c6a210)
- feat(front-vuejs): add Russian (ru) locale — i18n + agent prompts (T974) (db43e96)
- chore(devops): add i18n completeness check to release script (T1001) (9da50b3)
- feat(front-vuejs): add Norwegian (no) locale — i18n (T970) (1f313d6)
- fix(back-electron): read HKCU registry for full user PATH + readable error (T996/T995) (8ad7eb8)
- fix(front): add heatmap title and reduce gap with activity section (T994) (a6ba441)
## [0.25.0] - 2026-03-06

### Changes
- chore(devops): add project skills config + code-telemetry script + coverage gitignore (7cee450)
- chore(devops): add scoped Stryker npm scripts + CI mutation workflow (T993) (26d6265)
- chore(devops): add stryker background runner scripts for WSL (T992) (cf76c86)
- docs: update README and JSDoc for v0.25.0 (ba3313b)
- fix(front-vuejs): split StreamView.spec.ts to fix 400-line limit (T962) (1ec94de)
- test(back-electron): split ipc-integration.spec.ts into modules ≤400 lines (T985) (4fb4d8a)
- test: configure stryker mutation testing (T987) (440e372)
- test(front-vuejs): add unit tests for SidebarGroupNode, SuccessRateChart, UpdateNotification (T983) (e8ad95c)
- fix(front-vuejs): evict _html events on hidden tabs to free RAM (T962) (0536295)
- fix(front-vuejs): add stubActions:false to StreamView mountStream pinia (T963) (0183b0b)
- test(back-electron): integration tests IPC handlers + SQLite (T985) (5f03011)
- fix(front-vuejs): memoize activeToolForSession() via _activeToolComputeds Map (T967) (a58fc6a)
- fix(front-vuejs): clear debounceId in watch(dbPath) to prevent stale timer on project change (T966) (9056287)
- fix(back-electron): auto-close started sessions when task passes to done (T990) (b236220)
- fix(front-vuejs): pass parentId in createAgentGroup delegate (T959) (cd7d320)
- fix(front-vuejs): clear boardAssignees in closeProject() to prevent inter-project leak (T965) (6c71c99)
- test(front-vuejs): mettre en place les tests E2E avec Playwright + Electron (T986) (31cc844)
- chore(git): document commit 3cda7ee T961/T987 scope anomaly in ADRS.md (T991) (3d1a543)
- chore(devops): move renderer-only deps to devDependencies (T957) (9ac7824)
- docs(global): add screenshots to README and untrack img/ from .gitignore (cb084ff)
- fix(back-electron): bootstrap skips v24 migration on legacy DBs (T958) (64e748c)
- test: configure stryker mutation testing (T987) (3cda7ee)
- fix(front-vuejs): dashboard visual cohesion — fix empty spaces and layout after tab merge (T960) (4b89145)
- fix(back-electron): include stdout context in error:exit for code 1 crashes (T954) (fd53288)
- ux(front-vuejs): improve DashboardOverview readability — larger fonts, better contrast (T956) (6e3d274)
## [0.24.0] - 2026-03-05

### Changes
- fix(front-vuejs): audit global i18n — éliminer chaînes hardcodées françaises (T943) (d2c16f2)
- feat(front-vuejs): hierarchical agent groups in sidebar (T946) (14b5ace)
- docs(global): update README and JSDoc for CostStatsSection period prop (T948) (000b6dc)
- docs(global): translate all French .md files to English (T952) (3ea61de)
- docs(global): update CONTRIBUTING.md with current IPC architecture (T953) (7ce68b1)
- feat(back-electron): add parent_id hierarchy to agent_groups + update IPC (T945) (aacabca)
- feat(front-vuejs): use agent groups hierarchy in OrgChartView (T947) (2ce0831)
- fix(front-vuejs): reduce forced-close fallback delays (T950) (63ebf7c)
- feat(front-vuejs): supprimer les 5 onglets redondants de DashboardView (T942) (aa4eabd)
- fix(front-vuejs): lazy-load dir children on click in SidebarFileTree (T944) (29b50c5)
- fix(back-electron): improve claude.exe discovery in PS1 Windows script (T939) (047b250)
- fix(front-vuejs): supprimer boutons day/week/month redondants de CostStatsSection (T940) (068eb06)
- fix(front-vuejs): translate DashboardOverview strings to English (T938) (37a71a8)
- fix(front-vuejs): translate SessionActivityChart and SuccessRateChart strings to English (T941) (4724107)
- fix(front-vuejs): translate DashboardOverview strings to English (T938) (20a26c6)
## [0.23.0] - 2026-03-05

### Changes
- docs(back-electron): update JSDoc for handleStop — session completed on stop (T935) (5c7f426)
- fix(back-electron): enrich PATH with .local\bin and npm in Windows PS1 script (T933) (68651f2)
- feat(front-vuejs): orgchart interactif des agents avec statut live (T921) (eca0f21)
- feat(front-vuejs): reset button for agent/level filters in logs feed (T925) (3d74200)
- chore(global): supprimer toutes les références à npm run lint (T937) (a745c33)
- feat(front-vuejs): charts 14 jours activité sessions et taux de succès (T924) (23db890)
- test(front-vuejs): ajouter spec DashboardOverview (T923) (62a2f32)
- fix(back-electron): inject WSL hooks via wsl.exe instead of UNC path (T934) (3476693)
- chore(agents): ajouter étapes CI dans workflow release devops (T931) (a06df61)
- feat(front-vuejs): restructurer le dashboard en grid 4-metrics + sections claires (T923) (d051714)
- fix(front-vuejs): masquer scrollbar native sous-onglets dashboard (T932) (1c1fff9)
- fix(front-vuejs): espacer le bouton fermer des onglets vers la droite (T930) (ec98d38)
- feat(front-vuejs): indicateur pulsant cyan sur tâches in_progress (T922) (3cbe6c8)
- fix(front-vuejs): decouple autoReviewEnabled from autoLaunchAgentSessions (T928) (44b663c)
## [0.22.0] - 2026-03-05

### Changes
- docs(readme): update feature list and version refs for T917/T919/T920 (e111e6c)
- fix(back-electron): spawn claude natif Windows via PowerShell (T916) (3f756de)
- fix(back-electron): inject HTTP hook even if event already present in settings.json (T917) (07a0e5d)
- fix(front-vuejs): couleur cohérente sous l'onglet actif dashboard (T918) (9317922)
- ux(sidebar): supprimer la redondance des labels agent/périmètre (T920) (f9f7f81)
- ci(release): add workflow_dispatch trigger for manual re-runs (ab17355)
## [0.21.0] - 2026-03-05

### Changes
- docs(readme): update version badge and JSDoc for v0.21.0 (T901) (d467bc7)
- feat(front-vuejs): option configurable pour limiter la taille maximale des fichiers générés (T899) (cf0c2ab)
- feat(front-vuejs): augmenter padding/min-w des sous-onglets dans TabBar (T913) (30617f3)
- feat(front-vuejs): afficher métriques télémétrie avancées dans TelemetryView (T897) (ff3293a)
- fix(back-electron): séparer TTL buffer/instance DB dans dbCache (T910) (9bc25ff)
- fix(front-vuejs): traduire les statuts updater dans SettingsModal (T892) (a5779f4)
- fix(front-vuejs): corriger overflow horizontal dans StreamView (T893) (d9bc768)
- chore(global): supprimer ESLint du projet (1af79fd)
- fix(front-vuejs): corriger doClose() dans useAutoLaunch — utiliser agentKill/streamId au lieu des APIs PTY supprimées (T909) (b4aafb6)
- fix(back-electron): éviter double instanciation WASM Database dans writeDb (T908) (d1cf7c1)
- fix(front-vuejs): corriger les couleurs hardcodées dark-only (T895) (2acb4e8)
- fix(front-vuejs): restaurer confirmation fermeture onglet terminal actif (T912) (7723c07)
- fix(back-electron): stream JSONL transcript dans parseTokensFromJSONL pour éviter OOM (T907) (7ab96b2)
- chore(global): remove GitHub PAT — repository is now public (T904) (248f5d0)
- fix(front-vuejs): restaurer auto-fermeture onglets — format datetime SQLite (T906) (aadc228)
- fix(front-vuejs): traduire labels Heatmap et Qualité dans DashboardView et AgentQualityPanel (T891) (b3a71f1)
- refactor(front-vuejs): déplacer la bulle thinking vers l'indicateur de streaming (T903) (c7884c0)
- fix(front-vuejs): cleanup mémoire mineurs — _lastNotifTs, onHookEvent, eventsForSession (T911) (02d83fa)
- docs(readme): translate agents and scripts sections to English (T884) (c9d2f01)
- feat(back-electron): enrich ipc-telemetry with advanced metrics (T894) (f8f3aeb)
- refactor(front-vuejs): supprimer la section connexion GitHub des paramètres (T886) (7563b9f)
- feat(front-vuejs): sélecteur FR/EN sur l'écran d'accueil DbSelector (T887) (4931f60)
- fix(back-electron): register projectPath in find-project-db to fix fsListDir allowlist (T896) (25625eb)
- fix(front-vuejs): trigger auto-review on startup when done count >= threshold (T900) (8d23575)
- feat(back-electron): support FR/EN lang for GENERIC_AGENTS (T889) (87b381e)
- fix(back-electron): bootstrap hooks in settings.json if absent (T888) (48a4bd7)
- fix(back-electron): actionable error for WSL exit 4294967295 (T885) (f6b908d)
## [0.20.1] - 2026-03-05

### Changes
- docs(readme): update version badge to 0.20.1 (f362b84)
- chore(back-electron): mettre à jour les prompts release dans default-agents.ts (T883) (c4e031a)
- fix(front-vuejs): UpdateNotification dans flux normal sous TitleBar (T880) (432e77e)
- fix(back-electron): injecter hooks dans settings globaux WSL/Windows (T878) (b6976dc)
- fix(back-electron): afficher message erreur mise à jour, guard token absent (T874) (a27f8d6)
- fix(back-electron): remove disable-software-rasterizer, guard enable-zero-copy to non-win32 (T875) (91999f8)
- fix(front-vuejs): drag-drop todo→in_progress uses settings instance/profile (T879) (d8aed0f)
- fix(front-vuejs): agrandir police sous-onglets dashboard text-[11px] → text-xs (T876) (05f1c52)
- fix(devops): inclure latest.yml dans les assets des GitHub Releases (7ad2592)
- fix(devops): add Linux maintainer email in electron-builder.yml (6eda6a0)
## [0.20.0] - 2026-03-05

### Changes
- docs(front-vuejs,back-electron): update README and JSDoc for v0.20.0 (T869) (fc08532)
- chore(devops): injecter changelog dans les GitHub Releases (T872) (7cd4c5a)
- fix(front-vuejs): git tab — diagnostics erreurs et messages différenciés (T865) (c80c7c6)
- feat(back-electron): bake GH_TOKEN dans le binaire via GitHub Actions (T871) (8d94cf6)
- feat(front-vuejs): UI auto-update (bannière, progression, install) (T864) (beb38a5)
- fix(front-vuejs): remplacer font-mono par typo système dans stats (T860) (7e93deb)
- feat(back-electron): auto-update depuis GitHub (repo privé, token sécurisé) (T862) (9aad467)
- fix(back-electron): mettre à jour GENERIC_AGENTS pour cohérence T867 (pre-injection contexte) (T868) (0349b36)
- feat(front-vuejs): créer DashboardView avec sous-onglets (T859) (90c7756)
- feat(front+back): pre-inject session context into first agent message (T867) (44f4b57)
- fix(back-electron): hooks WSL→Windows — listen 0.0.0.0 + inject WSL gateway IP (T858) (d173159)
- chore(back-electron): supprimer handlers check-master-md et apply-master-md (T861) (b06050b)
- chore(front-vuejs): supprimer la section CLAUDE.md Sync de SettingsModal (T863) (9ac5d26)
- feat(front-vuejs): instance Claude Code par défaut dans les paramètres (T857) (0a24f35)
- chore(devops): migrer le build release vers GitHub Actions (T866) (0c0a405)
- fix(back-electron): robust error handling for db scripts on Windows (T854) (3fd8077)
- test(front-vuejs): ajouter specs pour 6 composants sans couverture (T853) (a7dbd0a)
- fix(front-vuejs): SidebarFileTree — ajouter onMounted pour charger l'arbre (T856) (8b18205)
- feat(front-vuejs): renommer l'onglet 'Stat' en 'Dashboard' (T855) (f9c7247)
## [0.19.0] - 2026-03-05

### Changes
- docs(back-electron,front-vuejs): add JSDoc to ipc-telemetry + 5 composables (T743) (7ccf6b6)
- refactor(test): découper stores.spec.ts en fichiers par store (T850) (7dcb5c5)
- refactor(test): découper components.spec.ts en 41 fichiers par composant (T849) (cff93df)
- refactor(test): éclater ipc.spec.ts en 6 fichiers thématiques (T851) (df7a2f6)
- fix(security): upgrade dompurify 3.2.4→3.3.1 + XSS regression tests (T848/T846) (a55e825)
- test(front-vuejs): 26 tests composables — useToolStats, useToast, useConfirmDialog, useSidebarGroups, useSidebarDragDrop (T840) (2cc80bb)
- test(front-vuejs): composants non couverts — StreamInputBar, StreamToolBlock, TelemetryView, AgentQualityPanel, TimelineView, ToolStatsPanel (T842) (f5dbb83)
- test(front-vuejs): stores agents, project, hookEvents — 35 nouveaux tests (T838) (fdf620e)
- perf(front-vuejs): pré-calculer _isLong/_lineCount dans flushEvents() (T843) (c04ac9a)
- perf(front-vuejs): guard marked.use() — evite stacking renderers sur hot-reload (T845) (3cfde54)
- perf(front-vuejs): remplacer hljs.highlightAuto() par plaintext fallback (T841) (9cee0af)
- test(back-electron): tasks:qualityStats — 10 tests unitaires (T836) (97419ba)
- refactor(front-vuejs): découper StreamView.vue en StreamToolBlock + StreamInputBar (T816) (ba7826f)
- refactor(back-electron): découper ipc-agents.ts en 4 modules cohérents (T812) (61b8c02)
- refactor(back-electron): découper migration.ts en migration-runner + 3 modules (T814) (e2b0766)
- feat(front-vuejs): onglet Telemetry — visualisation LOC et langages projet (T810) (e5ff610)
- test(back-electron): ipc-telemetry — 11 tests unitaires scanner LOC (T811) (a4b2675)
- test(front-vuejs): tests CostStatsSection.vue — 9 scénarios (T824) (e10da25)
- perf(front-vuejs): fix collapsed ref O(N) leak — stable _id keying (T823) (98bf96f)
- perf(back-electron): FTS4 full-text search pour search-tasks (T790) (f683b83)
- feat(front-vuejs): UI export ZIP - bouton, dialog confirmation, toast (T833) (a1e6f79)
- feat(back-electron): ipc-telemetry — scanner LOC et langages du projet (T809) (bb7c1db)
- perf(back-electron): fusionner 2 queries config en 1 dans check-master-md (T795) (4196850)
- fix(back-electron): hookServer — auth secret via Bearer token (T785) (c449d11)
- fix(back-electron): remplacer execSync par execFile sans shell dans git:log (T786) (9b8dc40)
- feat(front-vuejs): panel qualité agents — taux de rejet tâches (T770) (f2a16ea)
- fix(front-vuejs): corriger race condition unmount/timer dans usePolledData (T821) (377327a)
- fix(front-vuejs): corriger race condition auto-close notBefore + test T835 (4a9bdaa)
- fix(back-electron): limiter body HTTP à 1 MB dans hookServer (T783) (26b71d0)
- fix(back-electron): supprimer HIDDEN_SUFFIX redondant dans buildAgentPrompt (T834) (09dab7d)
- fix(front-vuejs): supprimer doublons dans le prompt de lancement de session (T832) (9215181)
- perf(back-electron): index task_links(from_task, to_task) + migration v21 (T789) (3ccc2b5)
- perf(back-electron): parallélise parseConvTokens avec batch de 5 dans syncAllTokens (T788) (a424cc9)
- fix(back-electron): find-project-db ne s'auto-enregistre plus dans allowlist (T782) (078887d)
- perf(front-vuejs): limiter done tasks à 100 + boardAssignees in-place (T819) (011de06)
- fix(back-electron): supprime backgroundThrottling:false + visibilityState check dbWatchInterval (T822) (a95e227)
- fix(back-electron): assertProjectPathAllowed sur allowedDir dans fs handlers — path traversal T776 (b317022)
- feat(front-vuejs): vue Timeline gantt des tâches par agent (T754) (ac77f1b)
- fix(back-electron): assertDbPathAllowed manquant dans check-master-md (T780) (13888ef)
- refactor(front-vuejs): Sidebar 954L→147L — useSidebarDragDrop + useSidebarGroups + SidebarFileTree + SidebarAgentSection + SidebarPerimetreSection (T815) (b18641d)
- fix(back-electron): parseConvTokens — readline stream à la place de readFile (T820) (282d945)
- feat(front-vuejs): analytics coût & tokens — CostStatsSection (T769) (6abf0fe)
- refactor(back-electron): découper ipc.ts (759L) en 5 modules cohérents (T813) (a74b2b2)
- fix(front-vuejs): StreamView — fenêtre glissante MAX_EVENTS=500 + purge collapsed (T817) (2326970)
- perf(back-electron): cap stderrBuffer to 10KB to prevent memory leak (T818) (483fdbb)
- feat(front-vuejs): TopologyView — carte visuelle agents/périmètres/sessions (T750) (22f79fd)
- test(front-vuejs): preload — 7 nouveaux tests nouvelles méthodes API (T781) (0dde570)
- test(front-vuejs): hookEvents store + useHookEventDisplay — 34 nouveaux tests (T779) (3a87ee6)
- fix(front-vuejs): WorkloadView — watch lastRefresh + tests composant (T748) (904d7c1)
- test(front-vuejs): ActivityHeatmap + usePolledData — 16 nouveaux tests (T784) (f96edaf)
- feat(back-electron): multi-platform Claude Code instance detection (T774) (7f74215)
- test(back-electron): shell:openExternal, session:updateResult, git:log (T777) (cb985fb)
- perf(front-vuejs): supprimer alias archivedByAgent + cleanup dbChangeDebounce (T796/T797) (2e90ee3)
- perf(front-vuejs): hookEvents — slice(-N) + mutation directe activeTools (T794) (06b0bd9)
- perf(front-vuejs): HookEventBar computed reversedEvents — éliminer spread+reverse dans template (T793) (6341294)
- fix(security): upgrade DOMPurify 3.3.1→3.2.4 — fix HIGH mXSS (GHSA-gx9m-whjm-85jf) (T778) (b4114c0)
- perf(front-vuejs): HookEventsView itération inverse — éliminer slice+reverse O(N) (T792) (22b81cb)
- perf(front-vuejs): pré-calculer HTML markdown au flush — évite N appels marked (T791) (91cb629)
- feat(front-vuejs): analytics outils depuis hooks dans onglet Stat (T765) (083e14e)
- perf(front-vuejs): batch assignees load — éliminer N IPC par carte (T787) (d9c7424)
- feat(front-vuejs): vue workload balance — distribution effort/tâches par agent (T748) (e824e47)
- feat(front-vuejs): afficher commits git liés aux tâches (T761) (baba9d2)
- feat(front-vuejs): commits git liés aux tâches — GitCommitList + Stat + TaskDetailModal (T761) (435c7aa)
- feat(front-vuejs): adapter LaunchSessionModal instances multi-plateforme (T775) (dbe5e2a)
- feat(front-vuejs): adapter LaunchSessionModal pour instances multi-plateforme (T775) (49693ed)
- feat(back-electron): inject active tasks context at agent spawn (T772) (f26e69c)
- feat(front-vuejs): notifications desktop statut tâche (T755) (c01a68c)
- feat(front-vuejs): heatmap GitHub-like activité agents dans section Stat (T759) (2c14870)
- feat(back-electron): IPC sessions:statsCost + project:exportZip (T768+T771) (943cef6)
- refactor(sidebar): supprimer blocs persistants tâches, sessions, locks (T767) (206b5db)
- feat(front-vuejs): migrer HookEventsView vers composable useHookEventDisplay (T763) (9d74be1)
- feat(front-vuejs): EVENT_ICON+TOOL_COLOR composable + toolUseId extraction (T763+T764) (ca65722)
- fix(front-vuejs): MAX_EVENTS 200→2000 + extraction toolUseId dans hookEvents (T764) (03695eb)
- feat(front-vuejs): vue globale hook events cross-sessions avec filtres (T758) (8f1fece)
- feat(front-vuejs): détection et alerte visuelle tâches stale (T749) (afcca5b)
- feat(back-electron): persister cost_usd, duration_ms, num_turns session depuis event result (T766) (7167a52)
- refactor(front-vuejs): fusionner Log+Metrics en onglet unique Stat (T757) (5b333e6)
- refactor(front-vuejs): fusionner onglets Log + Metrics en onglet unique Stat (T757) (8cd4b9d)
- feat(back-electron): IPC git:log — exposer historique commits avec parsing mentions tâches (T760) (b7a3ef3)
- feat(front-vuejs): modal payload JSON pour hook events (T756) (1b1495c)
- feat(stream-view): rendre les URLs cliquables via openExternal (T753) (ef8ca5c)
- feat(back-electron): expose shell:openExternal IPC handler (T752) (dfabb90)
- feat(stream-view): display live hook events in HookEventBar (T742) (61db708)
- chore(arch): supprimer SETUP.md, migrer release workflow + problèmes connus (T746) (909b879)
- feat(scripts): bootstrap script init-project.js (T745) (ffd8206)
- feat(front-vuejs): graphe de dépendances tâches via task_links (T736) (34d8c8a)
- feat(front-vuejs): dashboard métriques tokens - onglet Métriques dédié (T735) (f2c2093)
- feat(hooks): extend hookServer with lifecycle hooks + IPC renderer push (T741) (096f017)
- feat(front-vuejs): vue arborescente des tâches via parent_task_id (T734) (8adf2be)
- feat(hooks): migrate Stop hook to embedded HTTP server (T737) (70f3790)
- chore(claude-md): bump version to 0.18.0 (1bf6d53)
## [0.19.0] - 2026-03-05

### Features
- feat(front-vuejs): vue arborescente tâches via parent_task_id (T734)
- feat(front-vuejs): dashboard métriques tokens — onglet Métriques dédié (T735)
- feat(hooks): migrer hook Stop vers HTTP embarqué Electron (T737)
- feat(hooks): étendre hookServer lifecycle hooks + IPC renderer push (T741)
- feat(scripts): bootstrap script init-project.js (T745)
- feat(front-vuejs): TopologyView graphe agents/groupes (T750)
- feat(front-vuejs): ActivityHeatmap — heatmap activité agents (T752)
- feat(front-vuejs): WorkloadView — vue charge de travail (T753)
- feat(front-vuejs): vue timeline/gantt tâches par agent (T754)
- feat(front-vuejs): AgentQualityPanel — panel qualité agent (T756)
- feat(front-vuejs): ToolStatsPanel — stats outils (T757)
- feat(front-vuejs): TimelineView (gantt inter-agents) (T758)
- feat(front-vuejs): CommandPalette (Cmd+K) (T760)
- feat(front-vuejs): TelemetryView — vue télémétrie (T762)
- feat(front-vuejs): GitCommitList — liste commits git (T763)
- feat(front-vuejs): HookEventsView — vue hook events live (T764)
- feat(front-vuejs): TokenStatsView complet (T766)
- feat(front-vuejs): ExplorerView — explorateur fichiers projet (T767)
- feat(front-vuejs): FileView — vue contenu fichier (T768)
- feat(back-electron): IPC git:getCommits + git:getDiff (T755)
- feat(back-electron): IPC explorer:listFiles + file:read (T775)
- feat(back-electron): IPC telemetry handlers (T761)
- feat(front-vuejs): HookEventPayloadModal (T765)
- feat(back-electron): hook events persistence SQLite (T787)
- feat(front-vuejs): SetupWizard — assistant configuration initiale (T791)
- feat(front-vuejs): DbSelector — sélecteur de base de données (T792)
- feat(front-vuejs): LaunchSessionModal — modal lancement session (T798)
- feat(front-vuejs): AgentEditModal — édition agent (T799)
- feat(front-vuejs): CreateAgentModal — création agent (T800)
- feat(front-vuejs): SettingsModal — modal paramètres (T801)
- feat(front-vuejs): ProjectPopup — popup projet (T802)
- feat(front-vuejs): ConfirmModal / ConfirmDialog (T803)
- feat(front-vuejs): ContextMenu — menu contextuel (T804)
- feat(front-vuejs): ToggleSwitch — composant switch (T805)
- feat(front-vuejs): ToastContainer — conteneur toasts (T806)
- feat(front-vuejs): TabBar — barre onglets (T807)
- feat(front-vuejs): TitleBar — barre de titre (T808)
- feat(front-vuejs): AgentBadge — badge agent coloré (T748)
- feat(back-electron): IPC agent groups (agentGroupsList etc.) (T769)
- feat(front-vuejs): useSidebarGroups + useSidebarDragDrop (T772)
- feat(front-vuejs): AgentLogsView — vue logs agents (T774)
- feat(front-vuejs): StreamInputBar + StreamToolBlock (T781)
- feat(back-electron): IPC task links get/create/delete (T786)
- feat(back-electron): IPC task assignees get/set (T785)
- feat(front-vuejs): TaskDetailModal — modal détail tâche (T770)
- feat(back-electron): IPC task-agents handlers (T809)
- feat(front-vuejs): affichage task_agents dans TaskDetailModal (T824)
- feat(front-vuejs): export ZIP depuis UI (T833)
- feat(back-electron): export project.db en ZIP (T771)
- feat(front-vuejs): vue arborescente tâches enfants (T821)
- feat(front-vuejs): StreamView amélioré (bulles user, thinking live) (T822)
- feat(back-electron): IPC stream send/create (T828)
- feat(front-vuejs): ConfirmDialog intégré sidebar groupes (T823)

### Bug Fixes
- fix(front-vuejs): onHookEvent déjà déclaré (no-op) (T747)
- fix(front-vuejs): router lazy-load composants lourds (T773)
- fix(security): DOMPurify CVE GHSA-v2wj-7wpq-c8vv (downgrade 3.1.x évaluation) (T777)
- fix(security): DOMPurify CVE GHSA-v2wj-7wpq-c8vv (évaluation override) (T778)
- fix(front-vuejs): AgentLogsView pagination archivés (T779)
- fix(back-electron): assertDbPathAllowed manquant check-master-md (T780)
- fix(back-electron): parseConvTokens readline stream (T820)
- fix(CLAUDE.md): TASK ISOLATION conditionnel (T826)
- fix(CLAUDE.md): template Autonomie agent (T827)
- fix(front-vuejs): doublons prompt lancement session (T831)
- fix(front-vuejs): doublons prompt lancement session (T832)
- fix(security): audit CVE DOMPurify 3.2.4 (analyse) (T837)
- fix(deps): audit deps + npm audit rapport (T839)
- fix(deps): upgrade dompurify 3.2.4→3.3.1 (GHSA-v8jm-5vwx-cfxm) (T846)
- fix(deps): upgrade tar 7.5.9→7.5.10 (GHSA-qffp-2rhf-9h96) (T847)
- fix(security): DOMPurify 3.3.1 + 3 tests XSS regression (T848)
- fix(back-electron): fs path traversal assertProjectPathAllowed (T776)

### Performance
- perf(front-vuejs): hljs.highlightAuto() → plaintext fallback (T841)
- perf(front-vuejs): pré-calculer _isLong/_lineCount dans flushEvents() (T843)
- perf(front-vuejs): guard marked.use() hot-reload (T845)

### Refactor
- refactor(front-vuejs): split composables sidebar (T759)
- refactor(back-electron): split ipc-agents.ts en 4 modules (T784/T812)
- refactor(back-electron): split ipc-tasks.ts (T813)
- refactor(back-electron): split ipc-session.ts (T817)
- refactor(back-electron): split ipc-hooks.ts (T818)
- refactor(front-vuejs): Sidebar.vue 954L→147L (T815)

### Tests
- test(back-electron): ipc-session.ts couverture (T782)
- test(back-electron): ipc-window.ts couverture (T783)
- test(back-electron): ipc-project.ts couverture (T788)
- test(back-electron): ipc-config.ts couverture (T793)
- test(back-electron): ipc-shell.ts couverture (T794)
- test(back-electron): ipc-wsl.ts couverture (T795)
- test(front-vuejs): composants non couverts batch 1 (T796)
- test(front-vuejs): stores agents/project/hookEvents (T797)
- test(back-electron): ipc-git.ts couverture (T819)
- test(back-electron): ipc-db.ts couverture (T834)
- test(back-electron): ipc-hooks.ts couverture (T835)
- test(back-electron): tasks:qualityStats (10 tests) (T836)
- test(front-vuejs): stores agents, project, hookEvents (35 tests) (T838)
- test(front-vuejs): composants non couverts batch 2 (T842)
- test(front-vuejs): composants StreamInputBar, StreamToolBlock, TelemetryView, AgentQualityPanel, TimelineView, ToolStatsPanel (T844)
- test(front-vuejs): 26 tests composables (useToolStats, useToast, useConfirmDialog, useSidebarGroups, useSidebarDragDrop) (T840)
- test: couverture IPC handlers back-electron (T751)

### Chore / Architecture
- chore(arch): plan-mode obligatoire effort=3 dans dev-*/back-electron (T738)
- chore(arch): context-budget rule dans dev-*/test-* system_prompt (T739)
- chore(arch): iterative-retrieval dans dev-*/test-* system_prompt (T740)
- chore(arch): supprimer SETUP.md, migrer release workflow (T746)

## [0.18.0] - 2026-03-04

### Changes
- docs(readme): update badge + features + JSDoc for v0.18.0 (T732) (01e91cf)
- feat(stream-view): display live thinking text in status bar when thinkingMode active (T731) (d780aee)
- feat(tab-store): add streamId tracking + explicit agentKill on closeTab (T730) (424b366)
- feat(stream-view): collapse tool_use/tool_result/thinking by default + ANSI strip + markdown (T727/T729) (eb55b74)
- fix(tab-bar): remove terminalIsAlive call — PTY removed in v0.17 (T728) (ff711d3)
- chore(claude-md): bump version to 0.17.1 (e26336f)
## [0.17.1] - 2026-03-04

### Changes
- docs(readme): update README and JSDoc for v0.17.1 — external terminal, ipc-wsl (T723) (7a87603)
- fix(front-vuejs): repurpose +WSL button to open external terminal (T722) (935a0f9)
- fix(back-electron): restore getClaudeInstances after terminal.ts removal (T721) (fe46286)
## [0.17.0] - 2026-03-04

### Changes
- docs(readme): update structure for v0.17.0 — remove terminal, add utils/wsl, stores split (T716) (6f3ce8d)
- refactor(migration): numbered migrations with version table and SAVEPOINT (T709) (eaf4600)
- refactor(agent-stream): use toWslPath from utils/wsl instead of local copy (T710) (2805f99)
- feat(stream-view): style markdown tables and add agent background color on text blocks (T714, T720) (b067c23)
- refactor(back-electron): remove terminal.ts, IPC PTY handlers and node-pty (T719) (c3a8f25)
- refactor(store): split tasks.ts into useProjectStore, useAgentsStore, useTasksStore (T713) (f701d03)
- refactor(types): move Window.electronAPI to src/renderer/src/types/electron.d.ts (T711) (8406ee8)
- refactor(wsl): extract toWslPath into src/main/utils/wsl.ts (T710) (50babdc)
## [0.16.3] - 2026-03-04

### Changes
- fix(agent-stream): use bash script file instead of -lc to prevent wsl.exe outer-shell expansion (T706) (5d6c4c0)
## [0.16.2] - 2026-03-04

### Changes
- docs(readme): bump version badge to 0.16.2 (T702) (fe68998)
- fix(devtools): add Ctrl+Shift+I shortcut conditioned on !isPackaged (T704) (7f9d140)
- fix(agent-stream): pass system prompt via temp file to fix Windows quoting (T705) (11f8a4d)
- fix(release): bump version before build so artifact name matches new version (T701) (b6b4ece)
## [0.16.1] - 2026-03-04

### Changes
- docs(agent-stream): add JSDoc params to escapeAnsiC and buildClaudeCmd (T699) (71f3067)
- fix(agent-stream): safe system prompt via ANSI-C escaping (T698) (4bc421e)
## [0.16.0] - 2026-03-04

### Changes
- chore(gitignore): ignore img/ screenshots directory (2727b46)
- docs: update README, JSDoc and CLAUDE.md for v0.16.0 (T695) (9df6179)
- fix(agent-stream): buffer stderr, flush only on abnormal exit (T697) (b41e0d5)
- fix(stream-view): display agent errors in StreamView (T694) (ad09b5a)
- feat(back-electron): capture proc.stderr + emit error:exit on abnormal exit (T693) (9f7416b)
- fix(back-electron): resolve wsl.exe absolute path in packaged app (T692) (f669ed4)
## [0.15.0] - 2026-03-03

### Changes
- docs: update README and JSDoc for v0.15.0 (T690) (b9a07a9)
- feat(devops): export agent scripts to project on create-project-db (T688) (c975d13)
- chore(docs): bump version to 0.14.0 in CLAUDE.md (c00a0f6)
## [0.14.0] - 2026-03-03

### Changes
- feat(front-vuejs): render markdown + agent color theme + send button align (T678 T680 T681) (e253f23)
- fix(devops): remove hardcoded machine path in Stop hook and script (24a9bb7)
- test(front-vuejs): add ConfirmModal, ProjectPopup, ToggleSwitch tests + fix LaunchSessionModal tests (T675) (9d450f2)
- perf(front-vuejs): micro-batch StreamView IPC events via nextTick buffer (T676) (1b6ff03)
- fix(back-electron): add AbortSignal.timeout(10s) to test-github-connection fetch (T672) (24977c2)
- test(back-electron): add missing tests for runAddAgentGroupsMigration and task:getLinks (e936163)
## [0.13.0] - 2026-02-27

### Changes
- chore(arch): bump CLAUDE.md version 0.10.0 → 0.13.0 (bc4715e)
- fix(front-vuejs): migrate StreamView to agent:* IPC channels — ADR-009 (T648) (2b60b64)
- fix(back-electron): implement agent-stream IPC handlers via child_process.spawn (T647) (075f85d)
- docs(repo): update README and JSDoc for v0.13.0 (e511381)
- fix(front-vuejs): auto-close agents with no assigned tasks (T646) (9ae00c4)
- fix(back-electron): fix stream-json pipeline — cols=10000 + resume guard (T645) (43cd4ee)
- test(back-electron): add stream-json PTY tests for T645 (cols, output-format, env) (20a4644)
- perf(front-vuejs): remove debug console.log from StreamView hot paths (T640) (b7d6e85)
- perf(front-vuejs): optimize computed in Sidebar and TokenStatsView (T642/T643/T644) (7421400)
- perf(back-electron): batch writeDb in session:syncAllTokens (T641) (9bf0fad)
- perf(back-electron): remove console.log in terminal+preload hot paths (T639) (afc57b2)
- perf(electron): remove debug console.log in terminal onData + preload hot paths (T639) (49333fc)
- feat(front-vuejs): add cost, cache hit rate and sparkline widgets (T635) (4065a31)
- feat(front-vuejs): add period selector to TokenStatsView (T634) (ff3c78b)
- fix(stream-view): T633 fix terminal:data silence — stale event.sender + diagnostic logs (54817ae)
- fix(devops): build full installer and attach .exe to GitHub Release (T636) (6a34706)
## [0.12.0] - 2026-02-27

### Changes
- docs(repo): update README and JSDoc for v0.12.0 (T622) (f3685aa)
- fix(renderer): default useResume to false in LaunchSessionModal (T632) (ca496d9)
- feat(devops): add Stop hook for automatic token capture (T627) (acf6148)
- fix(scripts): normalize backslash-escaped quotes in dbq.js and dbw.js (T629) (7b412ab)
- fix(back-electron): T630+T631 kill chain + auto-release WSL RAM on last PTY close (8d6c9cf)
- fix(settings): extract ToggleSwitch component with ARIA and focus styles (T625) (3dc951d)
- fix(back-electron): T626 race condition setSessionConvId + dbstart UUID pre-assign (5991132)
- fix(timestamps): parse SQLite UTC timestamps correctly in all components (T624) (db487fd)
- fix(stream-view): T621 extend ANSI regex to strip OSC sequences in JSONL (6858c38)
- test(tab-bar): T619 add closeTab same-group selection tests (7fa89e3)
- fix(tab-bar): T619 stay in same group when closing active terminal tab (884abf3)
- feat(scripts): add parameterized query support to dbw.js (T620) (455ef5b)
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

[Unreleased]: https://github.com/IvyNotFound/KanbAgent/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/IvyNotFound/KanbAgent/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/IvyNotFound/KanbAgent/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/IvyNotFound/KanbAgent/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/IvyNotFound/KanbAgent/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/IvyNotFound/KanbAgent/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/IvyNotFound/KanbAgent/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/IvyNotFound/KanbAgent/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/IvyNotFound/KanbAgent/releases/tag/v0.3.0
[0.2.0]: https://github.com/IvyNotFound/KanbAgent/releases/tag/v0.2.0
[0.1.0]: https://github.com/IvyNotFound/KanbAgent/releases/tag/v0.1.0
