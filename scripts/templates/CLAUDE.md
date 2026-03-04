# CLAUDE.md — [nom-du-projet]

> Lecture seule sauf `setup` (init) et `arch` (révisions structurantes). État vivant → `.claude/project.db`. Refs → `.claude/ADRS.md` · `.claude/WORKFLOW.md`

---

## Configuration

MODE: solo · LANG_CONV: français · LANG_CODE: english · Solo: `review` = `review-master`.

---

## Projet

**[nom-du-projet]** — [Description courte du projet.]

Périmètres: `front-vuejs` (`renderer/`, Vue 3 + TS + Tailwind) · `back-electron` (`main/`, Electron + Node + SQLite)

Conventions: français (conv) · anglais (code) · tests obligatoires · 0 lint · Conventional Commits

**Version: `0.1.0`** | Lead: [github-username] → `main` | `npm run dev/build/test/lint/release`

---

## Agents

Globaux: **review-master** (audit global) · **review** (périmètre) · **devops** (CI/CD) · **arch** (ADR, IPC, CLAUDE.md) · **doc** (README/JSDoc) · **setup** (init unique)

Scopés: `dev-front-vuejs` (Vue) · `dev-back-electron` (IPC/SQLite)

---

## Accès DB

`node scripts/dbq.js "<SQL>"` (lecture) · `node scripts/dbw.js "<SQL>"` (écriture)

SQL complexe → **heredoc obligatoire** :
```
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, 2, 'texte');
SQL
```
Démarrage session : `node scripts/dbstart.js <agent-name>`

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
