# KanbAgent — Référence IPC (v0.37.0)

> Document généré manuellement à partir de `src/preload/index.ts` et des handlers `src/main/ipc-*.ts`.
> **À vérifier après chaque release mineure** — les canaux peuvent évoluer.
>
> Convention : les canaux `invoke` attendent une réponse ; les canaux `on` sont des événements push (renderer ← main).

---

## Sommaire

| Domaine | Fichier handler | Canaux |
|---------|----------------|--------|
| [DB](#db) | `ipc-db.ts` | `query-db`, `watch-db`, `unwatch-db`, `migrate-db` |
| [Project](#project) | `ipc-project.ts` | `select-project-dir`, `select-new-project-dir`, `init-new-project`, `create-project-db`, `find-project-db`, `project:regenerateRulesFiles`, `project:exportZip` |
| [File System](#file-system) | `ipc-fs.ts` | `fs:listDir`, `fs:readFile`, `fs:writeFile`, `fs:saveImage` |
| [Window](#window) | `ipc-window.ts` | `window-minimize`, `window-maximize`, `window-close`, `window-is-maximized`, `show-confirm-dialog`, `shell:openExternal` |
| [Agents — CRUD](#agents--crud) | `ipc-agent-crud.ts` | `rename-agent`, `update-agent-system-prompt`, `get-agent-system-prompt`, `update-agent-thinking-mode`, `update-agent`, `delete-agent`, `create-agent`, `agent:duplicate` |
| [Agents — Perimetres](#agents--perimetres) | `ipc-agent-tasks.ts` | `close-agent-sessions`, `update-perimetre`, `build-agent-prompt`, `add-perimetre`, `task:setAssignees` |
| [Agent Groups](#agent-groups) | `ipc-agent-groups.ts` | `agent-groups:list`, `agent-groups:create`, `agent-groups:rename`, `agent-groups:delete`, `agent-groups:setMember`, `agent-groups:reorder`, `agent-groups:setParent` |
| [Sessions](#sessions) | `ipc-agent-sessions.ts` | `session:setConvId`, `session:collectTokens`, `session:parseTokens`, `session:syncAllTokens` |
| [Session Stats](#session-stats) | `ipc-session-stats.ts` | `session:updateResult`, `sessions:statsCost`, `tasks:getArchived`, `tasks:qualityStats`, `tasks:updateStatus` |
| [Tasks — Queries](#tasks--queries) | `ipc-agent-tasks-query.ts` | `task:getAssignees`, `search-tasks`, `task:getLinks` |
| [Config / Settings](#config--settings) | `ipc-settings.ts` | `get-config-value`, `set-config-value`, `check-for-updates` |
| [Agent Stream](#agent-stream) | `agent-stream.ts` | `agent:create`, `agent:send`, `agent:kill`, `agent:permission-respond` |
| [Git](#git) | `ipc-git.ts` | `git:log`, `git:worktree-create`, `git:worktree-remove` |
| [WSL / CLI](#wsl--cli) | `ipc-wsl.ts`, `ipc-cli-detect.ts` | `wsl:openTerminal`, `wsl:get-cli-instances` |
| [CLI Models](#cli-models) | `ipc-cli-models.ts` | `cli:get-models` |
| [Telemetry](#telemetry) | `ipc-telemetry.ts` | `telemetry:scan` |
| [Auto-Updater](#auto-updater) | `updater.ts` | `updater:check`, `updater:download`, `updater:install` |
| [Push Events](#push-events) | divers | `db-changed`, `session:agents-completed`, `window-state-changed`, `hook:event`, `agent:permission-request`, `agent:stream:{id}`, `agent:convId:{id}`, `agent:exit:{id}`, `update:*` |

---

## DB

**Handler :** `src/main/ipc-db.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `query-db` | invoke | `dbPath: string, query: string, params?: unknown[]` | `Record<string, unknown>[]` | ~63 | Exécute une requête SELECT sur la DB projet. Les requêtes sans `LIMIT` reçoivent automatiquement `LIMIT 1000`. Les mots-clés d'écriture sont bloqués. |
| `watch-db` | invoke | `dbPath: string` | `void` | ~86 | Démarre un `fs.watch` sur le fichier DB. Envoie `db-changed` au renderer à chaque modification (debounced). |
| `unwatch-db` | invoke | `dbPath?: string` | `void` | ~113 | Arrête le watcher. Si `dbPath` omis, unwatche tout. |
| `migrate-db` | invoke | `dbPath: string` | `{ success: boolean; error?: string; migrated?: number }` | ~128 | Exécute les migrations en attente sur la DB. |

---

## Project

**Handler :** `src/main/ipc-project.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `select-project-dir` | invoke | — | `{ projectPath: string; dbPath: string \| null; error: string \| null } \| null` | ~90 | Ouvre un dialog natif de sélection de dossier. Retourne `null` si annulé. |
| `select-new-project-dir` | invoke | — | `string \| null` | ~246 | Sélectionne un nouveau répertoire projet (sans lookup de DB existante). |
| `init-new-project` | invoke | `projectPath: string` | `{ success: boolean; error?: string }` | ~263 | Initialise un nouveau projet KanbAgent dans le dossier sélectionné. |
| `create-project-db` | invoke | `projectPath: string, lang?: string` | `{ success: boolean; dbPath: string; error?: string }` | ~113 | Crée et migre une nouvelle `project.db` dans le répertoire projet. |
| `find-project-db` | invoke | `projectPath: string` | `string \| null` | ~327 | Cherche récursivement une `project.db` dans le dossier projet. |
| `project:regenerateRulesFiles` | invoke | `projectPath: string, detectedClis: string[], lang?: string` | `{ success: boolean; filesCreated?: string[]; error?: string }` | ~358 | Régénère les fichiers de règles CLI-agnostiques pour chaque CLI détecté (ADR-012). Crée `CLAUDE.md`, et optionnellement `GEMINI.md`, `.codex/instructions.md`. |
| `project:exportZip` | invoke | `dbPath: string` | `{ success: boolean; path?: string; error?: string }` | ~406 | Exporte la DB en archive ZIP vers le dossier Téléchargements. |

---

## File System

**Handler :** `src/main/ipc-fs.ts`

> Accès restreint : tous les chemins sont validés contre `allowedDir` (répertoire projet) pour éviter les traversals.

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `fs:listDir` | invoke | `dirPath: string, allowedDir: string` | `FileNode[]` | ~89 | Liste le contenu d'un répertoire. |
| `fs:readFile` | invoke | `filePath: string, allowedDir: string` | `{ success: boolean; content?: string; error?: string }` | ~115 | Lit un fichier texte. |
| `fs:writeFile` | invoke | `filePath: string, content: string, allowedDir: string` | `{ success: boolean; error?: string }` | ~147 | Écrit un fichier texte. |
| `fs:saveImage` | invoke | `base64Data: string, mediaType: string` | `{ success: true; path: string }` | ~74 | Sauvegarde une image (base64) dans un fichier temporaire. Déduit l'extension depuis le MIME type. |

---

## Window

**Handler :** `src/main/ipc-window.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `window-minimize` | invoke | — | `void` | ~15 | Minimise la fenêtre principale. |
| `window-maximize` | invoke | — | `void` | ~20 | Maximise / restaure la fenêtre principale (toggle). |
| `window-close` | invoke | — | `void` | ~27 | Ferme la fenêtre principale. |
| `window-is-maximized` | invoke | — | `boolean` | ~32 | Retourne l'état maximisé courant. |
| `show-confirm-dialog` | invoke | `opts: { title: string; message: string; detail?: string }` | `boolean` | ~41 | Affiche un dialog de confirmation natif (OK/Annuler). |
| `shell:openExternal` | invoke | `url: string` | `void` | ~54 | Ouvre une URL dans le navigateur système. Seuls les protocoles `http`/`https` sont autorisés. |

---

## Agents — CRUD

**Handler :** `src/main/ipc-agent-crud.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `rename-agent` | invoke | `dbPath: string, agentId: number, newName: string` | `{ success: boolean; error?: string }` | ~40 | Renomme un agent (met aussi à jour `CLAUDE.md`). |
| `update-agent-system-prompt` | invoke | `dbPath: string, agentId: number, systemPrompt: string` | `{ success: boolean; error?: string }` | ~60 | Met à jour le `system_prompt` d'un agent. |
| `get-agent-system-prompt` | invoke | `dbPath: string, agentId: number` | `{ success: boolean; systemPrompt: string \| null; systemPromptSuffix: string \| null; thinkingMode: string \| null; permissionMode: string \| null; worktreeEnabled: number \| null; preferredModel: string \| null; preferredCli: string \| null; error?: string }` | ~98 | Retourne la configuration système d'un agent. |
| `update-agent-thinking-mode` | invoke | `dbPath: string, agentId: number, thinkingMode: string \| null` | `{ success: boolean; error?: string }` | ~112 | Met à jour le `thinking_mode` (`auto` \| `disabled` \| `null`). |
| `update-agent` | invoke | `dbPath: string, agentId: number, updates: { name?: string; type?: string; scope?: string \| null; perimetre?: string \| null; thinkingMode?: string \| null; allowedTools?: string \| null; systemPrompt?: string \| null; systemPromptSuffix?: string \| null; autoLaunch?: boolean; permissionMode?: 'default' \| 'auto' \| null; maxSessions?: number; worktreeEnabled?: boolean \| null; preferredModel?: string \| null; preferredCli?: string \| null }` | `{ success: boolean; error?: string }` | ~157 | Met à jour les champs d'un agent (patch partiel). `maxSessions` : entier ≥ 1, ou -1 pour illimité (T534). |
| `delete-agent` | invoke | `dbPath: string, agentId: number` | `{ success: boolean; hasHistory?: boolean; error?: string }` | ~189 | Supprime un agent. `hasHistory: true` si des sessions existaient. |
| `create-agent` | invoke | `dbPath: string, projectPath: string, data: { name: string; type: string; scope: string \| null; perimetre?: string \| null; thinkingMode: string \| null; systemPrompt: string \| null; description: string; preferredModel?: string \| null }` | `{ success: boolean; agentId?: number; claudeMdUpdated?: boolean; error?: string }` | ~262 | Crée un agent et l'inscrit dans `CLAUDE.md` si applicable. `perimetre` est un alias pour `scope`. |
| `agent:duplicate` | invoke | `dbPath: string, agentId: number` | `{ success: boolean; agentId?: number; name?: string; error?: string }` | ~281 | Duplique un agent (copie tous les champs, génère un nom `<name>-copy`). |

---

## Agents — Perimetres

**Handler :** `src/main/ipc-agent-tasks.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `close-agent-sessions` | invoke | `dbPath: string, agentName: string` | `{ success: boolean; error?: string }` | ~27 | Clôt les sessions actives d'un agent. |
| `update-perimetre` | invoke | `dbPath: string, id: number, oldName: string, newName: string, description: string` | `{ success: boolean; error?: string }` | ~54 | Met à jour le nom et la description d'un périmètre. |
| `build-agent-prompt` | invoke | `agentName: string, userPrompt: string, dbPath?: string, agentId?: number` | `string` | ~87 | Construit le prompt complet en injectant le contexte système. |
| `add-perimetre` | invoke | `dbPath: string, name: string` | `{ success: boolean; id?: number; error?: string }` | ~229 | Crée un nouveau périmètre (scope). |
| `task:setAssignees` | invoke | `dbPath: string, taskId: number, assignees: Array<{ agentId: number; role?: string \| null }>` | `{ success: boolean; error?: string }` | ~180 | Définit la liste complète des agents assignés à une tâche (remplace l'existant). |

---

## Agent Groups

**Handler :** `src/main/ipc-agent-groups.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `agent-groups:list` | invoke | `dbPath: string` | `{ success: boolean; groups: Array<{ id: number; name: string; sort_order: number; parent_id: number \| null; created_at: string; members: Array<{ agent_id: number; sort_order: number }> }>; error?: string }` | ~21 | Liste tous les groupes avec leurs membres. |
| `agent-groups:create` | invoke | `dbPath: string, name: string, parentId?: number \| null` | `{ success: boolean; group?: { id: number; name: string; sort_order: number; parent_id: number \| null; created_at: string }; error?: string }` | ~62 | Crée un groupe (optionnellement enfant d'un groupe parent). |
| `agent-groups:rename` | invoke | `dbPath: string, groupId: number, name: string` | `{ success: boolean; error?: string }` | ~96 | Renomme un groupe. |
| `agent-groups:delete` | invoke | `dbPath: string, groupId: number` | `{ success: boolean; error?: string }` | ~121 | Supprime un groupe (les agents membres sont détachés). |
| `agent-groups:setMember` | invoke | `dbPath: string, agentId: number, groupId: number \| null, sortOrder?: number` | `{ success: boolean; error?: string }` | ~147 | Associe un agent à un groupe (`groupId: null` pour détacher). |
| `agent-groups:reorder` | invoke | `dbPath: string, groupIds: number[]` | `{ success: boolean; error?: string }` | ~179 | Réordonne les groupes selon l'ordre du tableau `groupIds`. |
| `agent-groups:setParent` | invoke | `dbPath: string, groupId: number, parentId: number \| null` | `{ success: boolean; error?: string }` | ~205 | Déplace un groupe sous un parent (`parentId: null` pour le mettre à la racine). |

---

## Sessions

**Handler :** `src/main/ipc-agent-sessions.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `session:setConvId` | invoke | `dbPath: string, agentId: number, convId: string` | `{ success: boolean; error?: string }` | ~99 | Persiste le `claude_conv_id` de la session active d'un agent. |
| `session:collectTokens` | invoke | `dbPath: string, agentName: string` | `{ success: boolean; tokens?: { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number }; error?: string }` | ~230 | Collecte les stats de tokens depuis le JSONL de la dernière session complétée. |

> **Note :** `session:parseTokens` (ligne ~134) et `session:syncAllTokens` (ligne ~164) sont des handlers internes non exposés dans le preload.

---

## Session Stats

**Handler :** `src/main/ipc-session-stats.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `session:updateResult` | invoke | `dbPath: string, sessionId: number, data: { cost_usd?: number \| null; duration_ms?: number \| null; num_turns?: number \| null }` | `{ success: boolean; error?: string }` | ~22 | Persiste `cost_usd`, `duration_ms`, `num_turns` depuis l'événement `result` Claude. |
| `sessions:statsCost` | invoke | `dbPath: string, params: { period: 'day' \| 'week' \| 'month'; agentId?: number; limit?: number }` | `{ success: boolean; rows: unknown[]; error?: string }` | ~51 | Agrège les stats coût/durée/tokens par agent et période. |
| `tasks:getArchived` | invoke | `dbPath: string, params: { page: number; pageSize: number; agentId?: number \| null; scope?: string \| null }` | `{ rows: unknown[]; total: number }` | ~105 | Pagination des tâches archivées (chargement lazy, indépendant du refresh principal). |
| `tasks:qualityStats` | invoke | `dbPath: string, params?: { scope?: string \| null }` | `{ success: boolean; rows: unknown[]; error?: string }` | ~150 | Stats qualité par agent : tâches totales, rejections, taux de rejet. |
| `tasks:updateStatus` | invoke | `dbPath: string, taskId: number, status: string` | `{ success: boolean; error?: string }` | ~197 | Met à jour le statut d'une tâche (drag & drop kanban). |

---

## Tasks — Queries

**Handler :** `src/main/ipc-agent-tasks-query.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `task:getAssignees` | invoke | `dbPath: string, taskId: number` | `{ success: boolean; assignees: Array<{ agent_id: number; agent_name: string; role: string \| null; assigned_at: string }>; error?: string }` | ~34 | Retourne les agents assignés à une tâche. |
| `search-tasks` | invoke | `dbPath: string, query: string, filters?: { status?: string; agent_id?: number; scope?: string }` | `{ success: boolean; results: unknown[]; error?: string }` | ~63 | Recherche plein texte sur les tâches (titre + description). |
| `task:getLinks` | invoke | `dbPath: string, taskId: number` | `{ success: boolean; links: Array<{ id: number; type: string; from_task: number; to_task: number; from_title: string; from_status: string; to_title: string; to_status: string }>; error?: string }` | ~185 | Retourne les liens de dépendance d'une tâche. |

---

## Config / Settings

**Handler :** `src/main/ipc-settings.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `get-config-value` | invoke | `dbPath: string, key: string` | `{ success: boolean; value: string \| null; error?: string }` | ~24 | Lit une valeur de configuration depuis la table `config`. |
| `set-config-value` | invoke | `dbPath: string, key: string, value: string` | `{ success: boolean; error?: string }` | ~42 | Écrit une valeur de configuration dans la table `config`. |
| `check-for-updates` | invoke | `dbPath: string, repoUrl: string, currentVersion: string` | `{ hasUpdate: boolean; latestVersion: string; error?: string }` | ~65 | Vérifie la dernière release GitHub (repo public, sans auth). |

---

## Agent Stream

**Handler :** `src/main/agent-stream.ts`

> Implémentation ADR-009 : `child_process.spawn` + `stdio: pipe`. Chaque instance a un `id` unique (UUID).

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `agent:create` | invoke | `opts?: { cli?: string; cols?: number; rows?: number; projectPath?: string; workDir?: string; wslDistro?: string; systemPrompt?: string; thinkingMode?: string; claudeCommand?: string; convId?: string; permissionMode?: string; dbPath?: string; sessionId?: number; claudeBinaryPath?: string; worktree?: boolean; initialMessage?: string; modelId?: string }` | `string` (id) | ~74 | Spawne un processus agent CLI. Retourne l'`id` à utiliser pour `agent:send`/`agent:kill`/`onAgentStream`. Le champ `cli` sélectionne l'adaptateur (`claude`, `codex`, `gemini`, `opencode`, `aider`, `goose`). `modelId` passe `--model` au CLI (T1805). |
| `agent:send` | invoke | `id: string, text: string` | `void` | ~207 | Envoie un message multi-tour à l'agent via stdin JSONL. |
| `agent:kill` | invoke | `id: string` | `void` | ~221 | Tue le processus agent. |
| `agent:permission-respond` | invoke | `permissionId: string, behavior: 'allow' \| 'deny'` | `boolean` | ~228 | Résout une permission CLI en attente (T1816). Retourne `true` si la requête a été trouvée, `false` si expirée/inconnue. |

---

## Git

**Handler :** `src/main/ipc-git.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `git:log` | invoke | `projectPath: string, options?: { limit?: number; since?: string }` | `Array<{ hash: string; date: string; subject: string; author: string; taskIds: number[] }>` | ~76 | Retourne le git log avec extraction des mentions de tâches (`T\d+`). |
| `git:worktree-create` | invoke | `projectPath: string, sessionId: string, agentName: string` | `{ success: boolean; workDir?: string; error?: string }` | ~22 | Crée un git worktree pour l'isolation multi-instance (ADR-006). |
| `git:worktree-remove` | invoke | `projectPath: string, workDir: string` | `{ success: boolean; error?: string }` | ~60 | Supprime un git worktree (appelé à la fermeture d'un onglet — T1205). |

---

## WSL / CLI

**Handlers :** `src/main/ipc-wsl.ts` · `src/main/ipc-cli-detect.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `wsl:openTerminal` | invoke | — | `{ success: boolean; error?: string }` | `ipc-wsl.ts:~141` | Ouvre un terminal WSL externe (`wt.exe → wsl://` avec fallback `wsl.exe`). |
| `wsl:get-cli-instances` | invoke | `{ clis?: string[]; forceRefresh?: boolean }` | `CliInstance[]` | `ipc-cli-detect.ts:~296` | Détecte toutes les instances CLI supportées (local + WSL). Résultat mis en cache. |

---

## CLI Models

**Handler :** `src/main/ipc-cli-models.ts`

> Registre de modèles par CLI (T1802, T1806). OpenCode et Aider détectés dynamiquement ; Claude/Gemini utilisent des listes statiques.

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `cli:get-models` | invoke | `{ cli?: CliType; forceRefresh?: boolean }` | `CliModelDef[]` (si `cli` fourni) ou `Partial<Record<CliType, CliModelDef[]>>` (tous) | ~30 | Retourne les modèles disponibles pour un CLI donné (ou tous les CLIs). CLIs supportés : `claude`, `codex`, `gemini`, `opencode`, `aider`, `goose`. |

---

## Telemetry

**Handler :** `src/main/ipc-telemetry.ts`

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `telemetry:scan` | invoke | `projectPath: string` | `{ languages: Array<{ name: string; files: number; lines: number; percent: number; sourceFiles: number; testFiles: number; sourceLines: number; testLines: number; blankLines: number; commentLines: number; codeLines: number }>; totalFiles: number; totalLines: number; scannedAt: string; totalSourceLines: number; totalTestLines: number; testRatio: number; totalBlankLines: number; totalCommentLines: number; totalCodeLines: number; totalSourceFiles: number; totalTestFiles: number }` | ~207 | Scanne les sources du projet et retourne les stats LOC par langage (source vs test, lignes de code/commentaires/blancs). |

---

## Auto-Updater

**Handler :** `src/main/updater.ts`

> Utilise `electron-updater` avec les GitHub Releases (repo public, sans auth).

| Canal | Type | Args | Retour | Ligne | Description |
|-------|------|------|--------|-------|-------------|
| `updater:check` | invoke | — | `unknown` | ~64 | Déclenche une vérification de mise à jour (no-op en dev). |
| `updater:download` | invoke | — | `unknown` | ~73 | Démarre le téléchargement de la mise à jour disponible. |
| `updater:install` | invoke | — | `void` | ~78 | Quitte et installe la mise à jour téléchargée. |

---

## Push Events

> Événements émis par le processus main vers le renderer via `webContents.send()`. Utilisés avec `ipcRenderer.on()`.

| Canal | Payload | Source | Description |
|-------|---------|--------|-------------|
| `db-changed` | — | `ipc-db.ts:~99` | La DB a été modifiée sur le disque (déclenche un refresh). |
| `session:agents-completed` | `agentIds: number[]` | `ipc-db.ts:~99` | Des sessions agents ont été auto-clôturées par le session-closer. |
| `window-state-changed` | `maximized: boolean` | `ipc-window.ts` | La fenêtre a changé d'état (maximisé/restauré). |
| `hook:event` | `{ event: string; payload: unknown; ts: number }` | `hookServer.ts:~83` | Événement lifecycle Claude Code reçu via le hook server HTTP (T741). |
| `agent:permission-request` | `{ permission_id: string; tool_name: string; tool_input: Record<string, unknown>; session_id: string }` | `hookServer.ts:~281` | Requête de permission CLI en attente — le renderer affiche un dialog et répond via `agent:permission-respond` (T1816). |
| `agent:stream:{id}` | `Record<string, unknown>[]` | `agent-stream.ts` | Événements JSONL streamés depuis le processus agent. |
| `agent:convId:{id}` | `string` | `agent-stream.ts` | `convId` extrait de l'événement `system:init`. |
| `agent:exit:{id}` | `number \| null` | `agent-stream.ts` | Code de sortie du processus agent. |
| `update:available` | `UpdateInfo` | `updater.ts:~35` | Une mise à jour est disponible. |
| `update:not-available` | — | `updater.ts:~39` | Aucune mise à jour disponible. |
| `update:progress` | `DownloadProgressInfo` | `updater.ts:~43` | Progression du téléchargement. |
| `update:downloaded` | `UpdateDownloadedEvent` | `updater.ts:~47` | Mise à jour téléchargée, prête à installer. |
| `update:error` | `string` | `updater.ts:~51` | Erreur du processus de mise à jour. |

---

## Propriété statique

| Propriété | Type | Description |
|-----------|------|-------------|
| `platform` | `string` | Identifiant de plateforme (`win32`, `darwin`, `linux`). Valeur au démarrage, non synchronisée. |
