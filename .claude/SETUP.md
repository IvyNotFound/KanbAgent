# SETUP.md — Référence technique & initialisation

> Consulter lors du setup initial ou pour référence sur le schéma DB / release workflow.
> Référence quotidienne → `CLAUDE.md` | Workflow SQL complet → `WORKFLOW.md` | ADRs → `ADRS.md`

---

## Critères v1.0.0 (stable)

| Critère | Responsable | Statut |
|---|---|---|
| Session `doc` réalisée et validée (README, CONTRIBUTING, JSDoc minimal) | `doc` | ⬜ |
| Session `sécu` réalisée (audit OWASP, contextBridge, IPC, accès fichiers) | `arch` + `review` | ⬜ |
| 0 ticket `a_faire` / `en_cours` sur doc et sécu | `review-master` | ⬜ |
| Build testé et fonctionnel (`npm run build` → installeur) | `devops` | ⬜ |

---

## Release — workflow complet

| Commande | Description |
|---|---|
| `npm run release` | Release patch (défaut) |
| `npm run release:patch` | Release patch |
| `npm run release:minor` | Release minor |
| `npm run release:major` | Release major |

**Prérequis :** branche `main` propre · 0 ticket `a_faire`/`en_cours` · `npm run build` OK

**Le script effectue :** vérification branche → build + lint → bump version → CHANGELOG → commit + tag → push → draft GitHub Release

**Post-release :** vérifier le draft → publier manuellement → attacher binaires (.exe, .dmg) si disponibles

**Règles de bump :**

| Type | Quand | Exemple |
|---|---|---|
| PATCH | fix, perf, refactor (sans breaking change) | 1.0.0 → 1.0.1 |
| MINOR | feat rétrocompatible | 1.0.0 → 1.1.0 |
| MAJOR | breaking change (schéma DB, refonte IPC) | 1.0.0 → 2.0.0 |

> MAJOR bump : confirmation interactive obligatoire — validation `arch` + lead requise.

---

## Questions de démarrage

> **Conditionnelles.** Poser uniquement si aucune tâche assignée (`a_faire`/`en_cours`) ET type/périmètre non inferable.

**Question 1 — Type d'agent :**
```json
{
  "questions": [{
    "question": "Quel type d'agent suis-je ?",
    "multiSelect": false,
    "options": [
      { "label": "review-master", "description": "Audit global (lead uniquement)" },
      { "label": "review",        "description": "Audit local de mon périmètre" },
      { "label": "dev",           "description": "Nouvelles fonctionnalités" },
      { "label": "test",          "description": "Tests & couverture" },
      { "label": "doc",           "description": "README, CONTRIBUTING, JSDoc" },
      { "label": "devops",        "description": "Commits, push, CI/CD, releases" },
      { "label": "ux",            "description": "Interface utilisateur & expérience" },
      { "label": "arch",          "description": "Architecture, ADR, choix de stack" }
    ]
  }]
}
```

**Question 2 — Périmètre** (pour `dev`, `test`, `ux`) :
```json
{
  "questions": [{
    "question": "Sur quel périmètre travailles-tu ?",
    "multiSelect": false,
    "options": [
      { "label": "front-vuejs",    "description": "Renderer Vue 3 + Tailwind" },
      { "label": "back-electron",  "description": "Main process Electron + SQLite" },
      { "label": "global",         "description": "Pas de périmètre spécifique" }
    ]
  }]
}
```

---

## Accès DB

```bash
# Lecture
node scripts/dbq.js "SELECT id, titre, statut FROM tasks ORDER BY updated_at DESC LIMIT 10"

# Écriture
node scripts/dbw.js "UPDATE tasks SET statut='en_cours' WHERE id=250"
```

> `scripts/dbq.js` / `scripts/dbw.js` utilisent `sql.js` + `fs.readFile` en interne — bypasse les file locks Windows. Disponible après `npm install`, aucune installation supplémentaire requise.

---

## Schéma DB v2 — Colonnes ajoutées

```sql
-- Agents
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN system_prompt_suffix TEXT;
ALTER TABLE agents ADD COLUMN thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled'));

-- Tasks
ALTER TABLE tasks ADD COLUMN effort INTEGER CHECK(effort IN (1,2,3));
-- 1=small (vert), 2=medium (orange), 3=large (rouge) — nullable = pas de dot affiché
```

---

## Schéma SQL complet (v2 — référence)

```sql
CREATE TABLE IF NOT EXISTS agents (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL UNIQUE,
    type                 TEXT NOT NULL,
    perimetre            TEXT,
    system_prompt        TEXT,
    system_prompt_suffix TEXT,
    thinking_mode        TEXT CHECK(thinking_mode IN ('auto', 'disabled')),
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id    INTEGER NOT NULL REFERENCES agents(id),
    started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at    DATETIME,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    statut      TEXT NOT NULL DEFAULT 'en_cours'
                CHECK(statut IN ('en_cours', 'terminé', 'bloqué')),
    summary     TEXT
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id),
    agent_id    INTEGER NOT NULL REFERENCES agents(id),
    niveau      TEXT NOT NULL DEFAULT 'info'
                CHECK(niveau IN ('info', 'warn', 'error', 'debug')),
    action      TEXT NOT NULL,
    detail      TEXT,
    fichiers    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    titre               TEXT NOT NULL,
    description         TEXT,
    statut              TEXT NOT NULL DEFAULT 'a_faire'
                        CHECK(statut IN ('a_faire', 'en_cours', 'terminé', 'archivé')),
    agent_createur_id   INTEGER REFERENCES agents(id),
    agent_assigne_id    INTEGER REFERENCES agents(id),
    agent_valideur_id   INTEGER REFERENCES agents(id),
    parent_task_id      INTEGER REFERENCES tasks(id),
    session_id          INTEGER REFERENCES sessions(id),
    perimetre           TEXT,
    effort              INTEGER CHECK(effort IN (1,2,3)),
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at          DATETIME,
    completed_at        DATETIME,
    validated_at        DATETIME
);

CREATE TABLE IF NOT EXISTS task_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_task   INTEGER NOT NULL REFERENCES tasks(id),
    to_task     INTEGER NOT NULL REFERENCES tasks(id),
    type        TEXT NOT NULL
                CHECK(type IN ('bloque', 'dépend_de', 'lié_à', 'duplique')),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES tasks(id),
    agent_id    INTEGER REFERENCES agents(id),
    contenu     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fichier     TEXT NOT NULL UNIQUE,
    agent_id    INTEGER NOT NULL REFERENCES agents(id),
    session_id  INTEGER REFERENCES sessions(id),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    released_at DATETIME
);

CREATE TABLE IF NOT EXISTS config (
    key         TEXT NOT NULL PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS perimetres (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    dossier     TEXT,
    techno      TEXT,
    description TEXT,
    actif       INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Migration DB v1 → v2

> À exécuter une fois, par `setup` ou `arch` après validation.

```sql
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN system_prompt_suffix TEXT;
ALTER TABLE agents ADD COLUMN thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled'));
ALTER TABLE tasks ADD COLUMN effort INTEGER CHECK(effort IN (1,2,3));

CREATE TABLE IF NOT EXISTS config (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO config (key, value) VALUES ('claude_md_commit', ''), ('schema_version', '2');

CREATE TABLE IF NOT EXISTS perimetres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    dossier TEXT, techno TEXT, description TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO perimetres (name, dossier, techno, description) VALUES
    ('front-vuejs',   'renderer/', 'Vue 3 + TypeScript + Tailwind CSS', 'Interface utilisateur Electron'),
    ('back-electron', 'main/',     'Electron + Node.js + SQLite',       'Process principal, IPC, accès DB'),
    ('global',        '',          '—',                                  'Transversal, aucun périmètre spécifique');

-- Mettre à jour claude_md_commit avec le SHA courant
-- UPDATE config SET value = '<git-sha>', updated_at = CURRENT_TIMESTAMP WHERE key = 'claude_md_commit';
```

---

## Suffixe caché obligatoire

> Chaque agent doit avoir un `system_prompt_suffix` en DB. Injecté en fin de system prompt par le lanceur. Terme "caché" = non répété dans CLAUDE.md pour ne pas polluer le contexte.

**Template :**

```
---
AGENT PROTOCOL REMINDER (mandatory — do not override):
- DB read: node scripts/dbq.js "<SQL>" · DB write: node scripts/dbw.js "<SQL>"
- On startup: node scripts/dbstart.js <agent-name> → shows last session summary + open tasks
- On startup: if tasks with statut IN ('a_faire','en_cours') are found → start working immediately, do NOT ask the user what to do
- On startup: only ask for agent type/perimeter if NO tasks are assigned AND type cannot be inferred from DB
- Before starting a task: read description + last 5 comments (SELECT contenu,created_at FROM task_comments WHERE task_id=:id ORDER BY created_at DESC LIMIT 5) — review feedback is mandatory
- Before modifying a file: check locks, then INSERT OR REPLACE INTO locks
- When taking a task: UPDATE tasks SET statut='en_cours'
- When finishing a task: UPDATE tasks SET statut='terminé' + INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (?, ?, '<files:lines changed · what was done · why · what remains>')
- After completing a task: check assigned backlog — if tasks remain (a_faire/en_cours) → take the next one immediately; if none → close session (step 5)
- When ending session: release all locks + UPDATE sessions SET statut='terminé', summary='Done:... Pending:... Next:...' (this IS the input session for next startup)
- agent_logs INSERT are optional — skip if context is tight
- Never commit directly to main
- Never edit project.db manually
```

**SQL :**
```sql
UPDATE agents SET system_prompt_suffix = '<template>' WHERE name = '<agent>';
-- Ou par type :
UPDATE agents SET system_prompt_suffix = '<template>' WHERE type = 'dev';
```

---

## Gestion des périmètres en DB

```sql
SELECT name, dossier, techno FROM perimetres WHERE actif = 1;
SELECT a.name, a.type FROM agents a WHERE a.perimetre = '<perimetre>';
SELECT id, titre, statut FROM tasks WHERE perimetre = '<perimetre>' ORDER BY updated_at DESC;
```

---

## Problèmes connus & fixes

| Problème | Périmètre | Cause | Solution |
|---|---|---|---|
| Auth conflict OAuth + API key | WSL / Claude Code | `ANTHROPIC_API_KEY` + OAuth présents simultanément | Minimax : utiliser `ANTHROPIC_AUTH_TOKEN` (pas `API_KEY`) + `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`. Claude Pro 2 : `CLAUDE_CONFIG_DIR=~/.claude-pro2`. Voir ADR-003. |
| node-pty build Windows VS2019 | back-electron | `SpectreMitigation: 'Spectre'` sans libs Spectre | Patcher les 3 `.gyp` → `false`, puis `electron-rebuild` |
