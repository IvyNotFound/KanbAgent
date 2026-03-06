# CLAUDE.md — agent-viewer

> Lecture seule sauf `setup` (init) et `arch` (révisions structurantes). État vivant → `.claude/project.db`. Refs → `.claude/ADRS.md` · `.claude/WORKFLOW.md`

---

## Configuration

MODE: solo · LANG_CONV: français · LANG_CODE: english · Solo: `review` = `review-master`.

---

## Projet

**agent-viewer** — Interface desktop Trello/Jira visualisant les tâches agents Claude (SQLite). Electron, dark mode, pas d'auth.

Périmètres: `front-vuejs` (`renderer/`, Vue 3 + TS + Tailwind, clés: `App.vue`, `vite.config.ts`) · `back-electron` (`main/`, Electron + Node + SQLite, clés: `index.ts`, `ipc.ts`)

Conventions: français (conv) · anglais (code) · tests obligatoires · Conventional Commits

**Version: `0.22.0`** | Lead: IvyNotFound → `main` | `npm run dev/build/test/release` | Bêta: MAJOR → validation `arch` + lead.

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

`node scripts/dbq.js "<SQL>"` (lecture) · `node scripts/dbw.js "<SQL>"` (écriture)

SQL simple : argument direct. SQL complexe (quotes, `$()`, multiligne) → **heredoc obligatoire** :
```
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content) VALUES (1, 2, 'texte');
SQL
```
Démarrage session : `node scripts/dbstart.js <agent-name>` — crée session, affiche tâches, vérifie locks.

---

## Workflow tickets

`todo` → `in_progress` → `done` → `archived` (rejeté → retour `todo`)

1. **review** crée ticket (titre + description + commentaire risques)
2. Agent démarre immédiatement sur ses tickets assignés
3. Agent écrit commentaire de sortie **EN PREMIER** · puis `done`
4. **review** archive ou rejette (`todo` + motif précis)

---

## Règles inter-agents

- Un agent = un périmètre — ne jamais déborder sans signaler
- Interfaces IPC Electron ↔ Vue → passer par `arch` avant d'implémenter
- `infra-prod`: confirmation humaine explicite avant toute action
