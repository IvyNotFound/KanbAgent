# CLAUDE.md — agent-viewer

> Lecture seule sauf `setup` (init) et `arch` (révisions structurantes). État vivant → `.claude/project.db`. Refs → `.claude/SETUP.md` · `.claude/ADRS.md` · `.claude/WORKFLOW.md`

---

## Configuration

MODE: solo · LANG_CONV: français · LANG_CODE: english · Solo: `review` = `review-master`.

---

## Projet

**agent-viewer** — Interface desktop Trello/Jira visualisant les tâches agents Claude (SQLite). Electron, dark mode, pas d'auth.

Périmètres: `front-vuejs` (`renderer/`, Vue 3 + TS + Tailwind, clés: `App.vue`, `vite.config.ts`) · `back-electron` (`main/`, Electron + Node + SQLite, clés: `index.ts`, `ipc.ts`)

Conventions: français (conv) · anglais (code) · tests obligatoires · 0 lint · Conventional Commits

**Version: `0.17.1`** | Lead: IvyNotFound → `main` | `npm run dev/build/test/lint/release` | Bêta: MAJOR → validation `arch` + lead.

---

## Agents

Globaux: **review-master** (audit global) · **review** (périmètre) · **devops** (CI/CD) · **arch** (ADR, IPC, CLAUDE.md) · **doc** (README/JSDoc) · **setup** (init unique) · **infra-prod** (prod, validation humaine obligatoire)

Scopés: `dev-front-vuejs` (Vue) · `dev-back-electron` (IPC/SQLite) · `test-front-vuejs` · `test-back-electron` · `ux-front-vuejs`

Thinking mode (DB `thinking_mode`, NULL=auto): `test/doc/devops` → disabled · autres → auto. Valeurs: `auto | disabled`. Injection: `--settings '{"alwaysThinkingEnabled":false}'` (ADR-002).

---

## Workflow tickets

`todo` → `in_progress` → `done` → `archived` (rejeté → retour `todo`)

1. **review** crée ticket (titre + description + commentaire risques)
2. Agent lit input session + tâches → **démarre immédiatement**
3. Agent prend ticket (`in_progress`), lit description + **tous les task_comments**, pose locks
4. Agent écrit commentaire de sortie **EN PREMIER** · puis `done`: `fichiers:lignes · fait · pourquoi · reste`
   → **Clear inter-tâches** : `/clear` contexte + reset terminal PTY si ouvert
5. Agent clôt session (summary ≤200 chars), vérifie backlog → continue ou termine
6. **review** archive ou rejette (`todo` + motif précis)

SQL détaillé → `.claude/WORKFLOW.md`

---

## Protocole agent (mandatory)

- **Startup**: lire `sessions.summary` + tâches `todo/in_progress` → travailler immédiatement; ne demander clarification que si aucune tâche et type non inférable
- **Accès DB**: `node scripts/dbq.js "<SQL>"` (lecture) · `node scripts/dbw.js "<SQL>"` (écriture) — voir `.claude/WORKFLOW.md`
- **Démarrage session** : `node scripts/dbstart.js <agent-name>` — crée session `statut='started'`, affiche tâches, vérifie locks en 1 commande. Si INSERT manuel : `statut='started'` (jamais `'active'`)
- **Avant modification**: vérifier locks → `INSERT OR REPLACE INTO locks (fichier, agent_id, session_id) VALUES (…)`
- **Tâche**: `UPDATE tasks SET statut='in_progress'` au début · commentaire de sortie **EN PREMIER** puis `statut='done'` à la fin (ordre strict — évite perte si session expire)
- **Sessions parallèles** : max **3 sessions actives** par même agent (enforcé par `dbstart.js`, exit code 2 si limite atteinte).
- **Inter-tâche** : après `done`, enchaîner la tâche suivante **sans fermer la session** → `/clear` contexte + reset terminal PTY si ouvert, puis prendre le prochain ticket `todo`. Ne fermer la session **que si** : aucune tâche restante, ou tâche bloquée (dépendance, lock, attente review).
- **Fin de session**: libérer locks + `UPDATE sessions SET statut='completed', summary='Done:T<id>[action]. Pending:T<id>[raison]. Next:T<id> <titre>'` **(max 200 chars)**
- Jamais push direct sur `main` · Jamais éditer `project.db` manuellement

---

## Valeurs valides — création de tâche

- `effort` : `1` (small) · `2` (medium) · `3` (large) — `CHECK(effort IN (1,2,3))`, valeur hors plage rejetée silencieusement par SQLite
- `priority` : `low` · `normal` · `high` · `critical`
- `statut` (tasks) : `todo` → `in_progress` → `done` → `archived`
- `statut` (sessions) : `started` → `completed` | `blocked` — `CHECK(statut IN ('started','completed','blocked'))`, jamais `'active'`

---

## Règles inter-agents

- Un agent = un périmètre — ne jamais déborder sans signaler
- Interfaces IPC Electron ↔ Vue → passer par `arch` avant d'implémenter
- `infra-prod`: confirmation humaine explicite avant toute action
