# CLAUDE.md — KanbAgent

> Lecture seule sauf `setup` (init) et `arch` (révisions structurantes). État vivant → `.claude/project.db`. Refs → `.claude/ADRS.md` · `.claude/WORKFLOW.md`

---

## Configuration

MODE: solo · LANG_CONV: français · LANG_CODE: english · Solo: `review` = `review-master`.

---

## Projet

**KanbAgent** — Interface desktop Trello/Jira visualisant les tâches agents Claude (SQLite). Electron, dark mode, pas d'auth.

Périmètres: `front-vuejs` (`renderer/`, Vue 3 + TS + Tailwind, clés: `App.vue`, `vite.config.ts`) · `back-electron` (`main/`, Electron + Node + SQLite, clés: `index.ts`, `ipc.ts`)

Conventions: français (conv) · anglais (code) · tests obligatoires · Conventional Commits

**Version: `0.31.8`** | Lead: IvyNotFound → `main` | `npm run dev/build/test/release` | Bêta: MAJOR → validation `arch` + lead.

---

## Release

`npm run release` (patch) · `npm run release:patch/minor/major`

**Prérequis :** branche `main` propre · 0 ticket `todo`/`in_progress` · `npm run build` OK

**Le script effectue :** vérif branche → build + lint → bump version → CHANGELOG → commit + tag → push → draft GitHub Release

**Post-release :** publier le draft manuellement → attacher binaires (.exe, .dmg) si disponibles

| Type | Quand |
|---|---|
| PATCH | fix, perf, refactor (sans breaking change) |
| MINOR | feat rétrocompatible |
| MAJOR | breaking change (schéma DB, refonte IPC) — validation `arch` + lead obligatoire |

---

## Agents

Globaux: **review-master** (audit global) · **review** (périmètre) · **devops** (CI/CD) · **arch** (ADR, IPC, CLAUDE.md) · **doc** (README/JSDoc) · **setup** (init unique) · **infra-prod** (prod, validation humaine obligatoire)

Scopés: `dev-front-vuejs` (Vue) · `dev-back-electron` (IPC/SQLite) · `test-front-vuejs` · `test-back-electron` · `ux-front-vuejs`

Thinking mode (DB `thinking_mode`, NULL=auto): `test/doc/devops` → disabled · autres → auto. Valeurs: `auto | disabled`. Injection: `--settings '{"alwaysThinkingEnabled":false}'` (ADR-002).

---

## Accès DB

⚠️ **NE JAMAIS modifier le schéma de la DB directement** (`ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`) — uniquement via les migrations versionnées dans `migration-runner.ts`. Les writes data (`INSERT`, `UPDATE`) via `dbw.js` passent par better-sqlite3 (accès fichier direct, WAL mode).

`node scripts/dbq.js "<SQL>"` (lecture) · `node scripts/dbw.js "<SQL>"` (écriture)

SQL simple : argument direct. SQL complexe (quotes, `$()`, multiligne) → **heredoc obligatoire** :
```
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content) VALUES (1, 2, 'texte');
SQL
```
Démarrage session : `node scripts/dbstart.js <agent-name>` — crée session, affiche tâches.

---

## Workflow tickets

`todo` → `in_progress` → `done` → `archived` (rejeté → retour `todo`)

1. **review** crée ticket (titre + description + commentaire risques)
2. Agent démarre immédiatement sur ses tickets assignés
3. Agent écrit commentaire de sortie **EN PREMIER** · puis `done`
4. **review** archive ou rejette (`todo` + motif précis)

---

## Worktree agent

Quand un worktree dédié est actif (`.claude/worktrees/s<sessionId>/`) :

- **Dev (src/)** → travailler exclusivement depuis `primaryWorkingDirectory` (= `.claude/worktrees/s<sessionId>/`)
- **DB (scripts/)** → `cd <repo-principal> && node scripts/dbq.js ...` — toujours depuis le dépôt principal
- Ne jamais modifier les fichiers sources depuis le dépôt principal quand un worktree est actif

**Review** : lors de la validation d'un ticket worktree, ne pas chercher les fichiers sur `main` — ils sont sur la branche agent.

Protocole d'inspection (dans l'ordre) :
1. Hash SHA dans le commentaire de sortie → `git cat-file -t <sha>` pour confirmer l'existence
2. Si la branche agent existe : `git diff --name-only main...agent/<name>/s<session_id>` · `git show <sha>:path`
3. Si le commit est orphelin (worktree supprimé sans push) : `git show <sha>:path` fonctionne directement tant que l'objet n'est pas garbage-collecté. Pour retrouver un sha inconnu : `git fsck --lost-found 2>&1 | grep "dangling commit"` puis filtrer par message.
4. **Ne jamais rejeter "fichier absent" sans avoir vérifié le sha** via `git cat-file -t <sha>`.

Merger vers main **uniquement si** validation OK (voir WORKFLOW.md étape 6).

---

## Règles inter-agents

- Un agent = un périmètre — ne jamais déborder sans signaler
- Interfaces IPC Electron ↔ Vue → passer par `arch` avant d'implémenter
- `infra-prod`: confirmation humaine explicite avant toute action
