# CLAUDE.md — Contexte du projet agent-viewer

> **IMPORTANT :** Ce fichier est en **lecture seule** sauf pour `setup` (initialisation) et `arch` (révisions structurantes validées par review-master).
> État vivant (tâches, locks, sessions, logs) → **`.claude/project.db`** uniquement. Jamais dans ce fichier.

---

# PARTIE I — Référence quotidienne

## Configuration

```
MODE        : solo
LANG_CONV   : français
LANG_CODE   : english
```

Solo : pas de préfixe, `review` = `review-master`.

---

## Projet

**agent-viewer** — Interface desktop style Trello/Jira pour visualiser en temps réel les tâches des agents Claude depuis une base SQLite. L'utilisateur branche l'app sur un fichier `.claude/project.db` existant et obtient une vue board, dark mode. Déploiement : app desktop locale (Electron). Auth : aucune.

### Utilisateurs

| Identifiant | Rôle | Branche |
|---|---|---|
| IvyNotFound | lead | `main` |

### Périmètres

| Périmètre | Dossier | Techno | Fichiers clés | Conventions |
|---|---|---|---|---|
| `front-vuejs` | `renderer/` | Vue 3 + TypeScript + Tailwind CSS | `renderer/src/main.ts`, `renderer/src/App.vue`, `vite.config.ts` | ESLint Airbnb, Vitest, dark mode Tailwind |
| `back-electron` | `main/` | Electron + Node.js + better-sqlite3 | `main/index.ts`, `main/ipc.ts`, `electron-builder.config.ts` | ESLint, tests Jest, IPC typé |
| `.claude/` | `.claude/` | — | `settings.json`, `project.db` | ne jamais éditer `project.db` manuellement |

Conventions partagées : conversations **français** · code/logs **anglais** · tests obligatoires · 0 lint · Conventional Commits (`feat|fix|chore|docs|refactor|test|perf|style`)

**back-electron** — IPC handlers typés, accès SQLite en read-only sur le fichier cible, sécurité contextBridge obligatoire.
**front-vuejs** — Dark mode Tailwind, composants Trello/Jira (colonnes par statut, cartes tâches), pas de dépendances CSS lourdes, Tailwind suffit.

### État — 2026-02-25

| Version | Périmètres actifs | Tests | Lint | Build | Branche | Remote |
|---|---|---|---|---|---|---|
| `0.2.0` | front-vuejs, back-electron | 0 | non conf. | non conf. | `main` | non conf. |

> Tâches live : `SELECT statut, COUNT(*) FROM tasks GROUP BY statut;`

### Commandes

```bash
# install
npm install

# dev (Electron + Vite hot-reload)
npm run dev

# build desktop app
npm run build

# tests
npm test

# lint
npm run lint
```

### Versioning

Schéma : **MAJOR.MINOR.PATCH[-LABEL]** — SemVer standard.

**Phase bêta (MAJOR = 0) :**

| Incrément | Quand | Exemple |
|---|---|---|
| `0.x.0` | Nouvelle version bêta mineure — features groupées, livrable cohérent | `0.2.0` |
| `0.x.y` | Patch bêta — fix critique sur une `0.x.0` | `0.2.1` |
| `-beta.N` | Label optionnel pour itérations intermédiaires | `0.2.0-beta.1` |

> En phase bêta, le schéma DB et les interfaces IPC peuvent changer sans garantie de rétrocompatibilité.

**Critères bloquants pour v1.0.0 (stable) :**

| Critère | Responsable | Statut |
|---|---|---|
| Session `doc` réalisée et validée (README, CONTRIBUTING, JSDoc minimal) | `doc` | ⬜ |
| Session `sécu` réalisée et validée (audit OWASP, contextBridge, IPC, accès fichiers) | `arch` + `review` | ⬜ |
| 0 ticket `a_faire` / `en_cours` sur doc et sécu | `review-master` | ⬜ |
| Build testé et fonctionnel (`npm run build` → installeur) | `devops` | ⬜ |

**Post-stable (MAJOR ≥ 1) :**

| Incrément | Quand |
|---|---|
| `1.x.0` | Nouvelle feature mineure rétrocompatible |
| `1.x.y` | Bugfix |
| `2.0.0` | Breaking change (schéma DB non rétrocompatible, refonte majeure) |

> Si une release GitHub est publiée avant la stable, utiliser le tag `0.x.0` avec la mention *pre-release* sur GitHub Releases.

### Release

**Commandes :**

| Command | Description |
|---|---|
| `npm run release` | Release patch (défaut) |
| `npm run release:patch` | Release patch |
| `npm run release:minor` | Release minor |
| `npm run release:major` | Release major |

**Workflow de release :**

1. **Prérequis**
   - Être sur branche `main` avec working tree propre
   - 0 ticket `a_faire` / `en_cours` sur main
   - `npm run build` OK

2. **Exécution**
   ```bash
   npm run release        # patch
   npm run release:minor  # minor
   npm run release:major  # major
   ```

3. **Le script effectue**
   - Vérification branche main propre
   - Build + lint
   - Bump version dans package.json
   - Génération CHANGELOG.md
   - Commit + tag git
   - Push vers origin
   - Création draft GitHub Release

4. **Post-release**
   - Vérifier le draft release sur GitHub
   - Publier manuellement si tout est OK
   - Attacher les binaires electron-builder (.exe, .dmg) si disponibles

**Règles de bump :**

| Type | Quand | Exemple |
|---|---|---|
| PATCH | fix, perf, refactor (sans breaking change) | 1.0.0 → 1.0.1 |
| MINOR | feat rétrocompatible | 1.0.0 → 1.1.0 |
| MAJOR | breaking change (schéma DB, refonte IPC) | 1.0.0 → 2.0.0 |

> **MAJOR bump** : confirmation interactive obligatoire. Ne peut pas être décidé par devops seul — validation `arch` + lead requise.

### Variables d'environnement

| Variable | Périmètre | Requis | Exemple | Secret |
|---|---|---|---|---|
| aucune pour l'instant | — | Non | — | non |

### Fichiers protégés

`dist/` `dist-electron/` (générés) · `node_modules/` · `CLAUDE.md` (config stable) · `.claude/project.db` (jamais éditer manuellement)

---

## Agents

### Globaux

| Agent | Responsabilités |
|---|---|
| **review-master** | Audit global, arbitrage inter-périmètres, création tickets, validation finale. Solo = `review`. |
| **review** | Audit périmètre. Crée tickets, passe tâches à `archivé` ou les rejette à `a_faire`. |
| **devops** | Commits, branches, CI/CD, releases, déploiements applicatifs, scripts |
| **infra** | Infrastructure : serveurs, Docker, IaC, monitoring, configuration |
| **infra-prod** | Production uniquement — accès restreint, **validation humaine obligatoire** avant chaque action |
| **arch** | ADR, interfaces IPC Electron ↔ Vue, révisions CLAUDE.md structurantes |
| **doc** | README, CONTRIBUTING, JSDoc |
| **setup** | Initialisation uniquement. Usage unique. |

### Scopés par périmètre

| Type | Exemple solo | Rôle |
|---|---|---|
| **dev** | `dev-front-vuejs` | Implémentation Vue / composants |
| **dev** | `dev-back-electron` | IPC handlers, accès SQLite |
| **test** | `test-front-vuejs` | Tests Vitest composants |
| **test** | `test-back-electron` | Tests Jest main process |
| **ux** | `ux-front-vuejs` | UX/UI dark mode, board |

### Thinking mode par type d'agent

La colonne `thinking_mode` sur la table `agents` contrôle le mode de raisonnement injecté lors du lancement d'une session via la CLI Claude. Valeur `NULL` en DB = `auto` par défaut.

| Type d'agent | `thinking_mode` recommandé | Justification |
|---|---|---|
| `review-master` | `auto` | Audit global complexe — Claude adapte le niveau |
| `review` | `auto` | Audit périmètre — complexité variable |
| `arch` | `auto` | ADR et choix structurants — réflexion utile |
| `dev` | `auto` | Implémentation — tâches variées en complexité |
| `ux` | `auto` | Conception UI — créativité bénéficie du thinking |
| `test` | `disabled` | Tests répétitifs, schéma fixe — thinking superflu |
| `doc` | `disabled` | Documentation — tâches simples et répétitives |
| `devops` | `disabled` | Commits, scripts — opérations directes sans ambiguïté |
| `infra` | `auto` | Infrastructure — complexité variable |
| `infra-prod` | `auto` | Production — réflexion recommandée avant toute action |

**Valeurs disponibles :**

| Valeur | Flag CLI injecté | Statut |
|---|---|---|
| `auto` | *(aucun flag)* | Actif — Claude choisit le niveau |
| `disabled` | `--thinking disabled` | Actif — thinking étendu désactivé |
| `budget_tokens` | *(à définir)* | Réservé — supporté quand le flag CLI sera disponible |

> Ces defaults sont des recommandations. La valeur effective est celle stockée en DB pour chaque agent — elle peut être surchargée manuellement via l'UI (LaunchSessionModal) avant chaque lancement.

---

## Workflow tickets

Cycle de vie complet d'un ticket — **6 étapes strictes**. Chaque étape liste les SQL obligatoires.

> **Statuts valides :** `a_faire` → `en_cours` → `terminé` → `archivé` (ou retour à `a_faire` si rejeté)
> **Input session :** contexte écrit en fin de session (`sessions.summary`), lu en début de session suivante. Doit être autosuffisant.

---

### Étape 1 — Review crée le ticket

> Acteur : `review` ou `review-master`

```sql
INSERT INTO tasks (
    titre, description, commentaire,
    statut, agent_createur_id, agent_assigne_id, perimetre
) VALUES (
    '<titre court et explicite>',
    '<description complète : contexte, symptômes, hypothèses, fichiers concernés, critères d''acceptation>',
    '<commentaire review : points d''attention, risques, dépendances, ce que review vérifiera>',
    'a_faire',
    (SELECT id FROM agents WHERE name = '<review>'),
    (SELECT id FROM agents WHERE name = '<agent-cible>'),
    '<perimetre>'
);

INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail)
VALUES (:session_id, :agent_id, 'info', 'Task created', 'Task #<id>: <titre>');
```

> **Description et commentaire max verbeux.** Un agent reprenant le ticket sans contexte doit pouvoir le comprendre et le réaliser seul, sans poser de questions.

---

### Étape 2 — L'agent démarre sa session

> Acteur : agent assigné — **obligatoire** à chaque début de session, avant tout travail.

```sql
-- 1. Enregistrement agent (idempotent)
INSERT OR IGNORE INTO agents (name, type, perimetre) VALUES ('<agent>', '<type>', '<perimetre>');

-- 2. Nouvelle session → conserver :session_id et :agent_id
INSERT INTO sessions (agent_id) VALUES ((SELECT id FROM agents WHERE name = '<agent>'));

-- 3. Log démarrage
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail)
VALUES (:session_id, :agent_id, 'info', 'Session started', 'Perimetre: <perimetre>.');

-- 4. Lire l'input session précédente (contexte de la dernière session terminée)
SELECT summary FROM sessions s
JOIN agents a ON a.id = s.agent_id
WHERE a.name = '<agent>' AND s.statut = 'terminé'
ORDER BY s.ended_at DESC LIMIT 1;

-- 5. Vérifier les locks actifs (conflits potentiels)
SELECT l.fichier, a.name FROM locks l
JOIN agents a ON a.id = l.agent_id
WHERE l.released_at IS NULL;

-- 6. Charger les tâches ouvertes assignées à cet agent
SELECT id, titre, statut, description, commentaire FROM tasks
WHERE agent_assigne_id = (SELECT id FROM agents WHERE name = '<agent>')
AND statut IN ('a_faire', 'en_cours')
ORDER BY updated_at DESC;
```

> **Règle d'autonomie :** Si des tâches `en_cours` ou `a_faire` sont trouvées à l'étape 6, l'agent **doit commencer à travailler immédiatement**, sans solliciter l'utilisateur. Reprendre le ticket `en_cours` s'il en existe un, sinon prendre le premier `a_faire` assigné. Les questions de démarrage (Partie II) ne sont posées **que si aucune tâche n'est assignée** ET que le type/périmètre ne peut pas être inféré de la DB.

---

### Étape 3 — L'agent prend le ticket

> Acteur : agent assigné — dès qu'il commence à travailler sur un ticket.

> **Lecture obligatoire avant tout travail.** Lire intégralement la description et le commentaire de la tâche, puis tous ses commentaires de review. Les commentaires contiennent des instructions de correction obligatoires — ne pas commencer sans les avoir lus.

```sql
-- Lire la description complète + commentaire de la tâche
SELECT titre, description, commentaire FROM tasks WHERE id = :task_id;

-- Lire tous les commentaires (retours review, corrections attendues)
SELECT tc.contenu, a.name, tc.created_at FROM task_comments tc
JOIN agents a ON a.id = tc.agent_id
WHERE tc.task_id = :task_id ORDER BY tc.created_at ASC;

-- Passer le ticket en cours
UPDATE tasks
SET statut = 'en_cours', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE id = :task_id;

-- Locker chaque fichier à modifier (un lock par fichier, AVANT toute modification)
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id)
VALUES ('<fichier>', :agent_id, :session_id);

-- Log
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, fichiers)
VALUES (:session_id, :agent_id, 'info', 'Task started', 'Task #<id>: <titre>', '["<fichier1>", "<fichier2>"]');
```

> **Règle absolue :** vérifier l'absence de lock concurrent avant de poser le sien. Lock posé **avant** toute modification, jamais après.

---

### Étape 4 — L'agent termine le ticket

> Acteur : agent assigné — une fois le travail terminé et testé.

```sql
-- Fermer le ticket avec commentaire de sortie obligatoire
UPDATE tasks
SET statut       = 'terminé',
    commentaire  = '<fichiers modifiés avec numéros de ligne (ex: Sidebar.vue:L319, ipc.ts:L87-L102) · ce qui a été fait · choix techniques · ce qui reste ou est hors scope · points à valider par review>',
    completed_at = CURRENT_TIMESTAMP,
    updated_at   = CURRENT_TIMESTAMP
WHERE id = :task_id;

-- Libérer les locks du ticket
UPDATE locks
SET released_at = CURRENT_TIMESTAMP
WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;

-- Log
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail)
VALUES (:session_id, :agent_id, 'info', 'Task completed', 'Task #<id>: <titre>');
```

> **Commentaire de sortie obligatoire.** Doit permettre à `review` de valider sans relire tout le code.

> **Règle de continuité :** Après avoir passé le ticket à `terminé`, consulter immédiatement le backlog (requête Étape 2, point 6). Si des tâches `en_cours` ou `a_faire` sont encore assignées → prendre la suivante sans attendre l'utilisateur. Si le backlog est vide → passer à l'Étape 5 (fin de session).

---

### Étape 5 — L'agent termine sa session

> Acteur : agent assigné — en fin de session (même si des tickets restent ouverts).

```sql
-- Libérer tous les locks restants
UPDATE locks SET released_at = CURRENT_TIMESTAMP
WHERE agent_id = :agent_id AND released_at IS NULL;

-- Clore la session + écrire l'input session (sera lu à la prochaine session, étape 2)
UPDATE sessions
SET statut     = 'terminé',
    ended_at   = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP,
    summary    = 'Done: <ce qui a été accompli>. Pending: <tickets encore ouverts et leur état>. Next: <prochaine action recommandée>.'
WHERE id = :session_id;

-- Log
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail)
VALUES (:session_id, :agent_id, 'info', 'Session ended', 'Input session written.');
```

> **L'input session** (`sessions.summary`) est lu automatiquement à la prochaine session (étape 2, point 4). Il doit être autosuffisant : un agent qui reprend sans contexte doit savoir exactement où il en est.

---

### Étape 6 — Review valide ou rejette

> Acteur : `review` ou `review-master` — après lecture du commentaire de sortie du ticket (étape 4).

```sql
-- CAS OK : ticket archivé
UPDATE tasks
SET statut            = 'archivé',
    agent_valideur_id = (SELECT id FROM agents WHERE name = '<review>'),
    validated_at      = CURRENT_TIMESTAMP,
    updated_at        = CURRENT_TIMESTAMP
WHERE id = :task_id;

INSERT INTO task_comments (task_id, agent_id, contenu)
VALUES (:task_id, (SELECT id FROM agents WHERE name = '<review>'), 'ARCHIVÉ — <observations, points notables>');

-- CAS KO : ticket rejeté, remis à faire
UPDATE tasks
SET statut     = 'a_faire',
    updated_at = CURRENT_TIMESTAMP
WHERE id = :task_id;

INSERT INTO task_comments (task_id, agent_id, contenu)
VALUES (:task_id, (SELECT id FROM agents WHERE name = '<review>'), 'REJETÉ — <motif précis, corrections attendues, critères de re-validation>');
```

> En cas de rejet, le commentaire doit être suffisamment précis pour que l'agent puisse corriger sans échange supplémentaire.

---

## Règles inter-agents

- Un agent = un périmètre — ne jamais déborder sans le signaler
- Vérifier les locks avant de modifier · Poser un lock immédiatement
- Interfaces IPC Electron ↔ Vue → passer par `arch` avant d'implémenter
- Jamais de push direct sur `main` en multi-user
- Actions production : validation humaine obligatoire
- **`infra-prod`** : confirmation humaine explicite requise avant **toute** action (création, suppression, modification) — ne jamais agir de façon autonome en production

## SQL utiles (pendant le travail)

```sql
-- Locker un fichier supplémentaire
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id) VALUES ('<fichier>', :agent_id, :session_id);

-- Créer une sous-tâche ou tâche dérivée
INSERT INTO tasks (titre, description, statut, agent_createur_id, agent_assigne_id, perimetre, session_id)
VALUES ('<titre>', '<desc>', 'a_faire', :agent_id, :agent_id, '<perimetre>', :session_id);

-- Lier des tâches
INSERT INTO task_links (from_task, to_task, type) VALUES (:a, :b, 'bloque');

-- Ajouter un commentaire intermédiaire
INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (:task_id, :agent_id, '<texte>');

-- Logger une action significative
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, fichiers)
VALUES (:session_id, :agent_id, 'info', '<titre>', '<détail>', '["fichier1"]');
```

---

## Informations critiques

| Problème | Périmètre | Cause | Solution |
|---|---|---|---|
| *(à compléter au fil du projet)* | | | |

---

# PARTIE II — Setup & référence technique

> Consulter uniquement lors de l'initialisation ou pour référence sur l'infrastructure.

---

## Questions de démarrage

> **Conditionnelles.** Ne poser ces questions que si **aucune tâche assignée** n'existe en DB (`a_faire` ou `en_cours`) ET que le type/périmètre ne peut pas être inféré. Si des tâches sont assignées → démarrer directement, sans poser ces questions.

À poser via `AskUserQuestion` si le type ou le périmètre n'est pas précisé.

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
      { "label": "git",           "description": "Commits, push, CI/CD" },
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

## ADRs — Architecture Decision Records

### ADR-001 — Nomenclature des agents opérationnels

**Date :** 2026-02-24 | **Statut :** accepté | **Auteur :** arch

#### Contexte

L'agent `git` couvrait un périmètre plus large que les opérations git pures (CI/CD, releases, déploiements, scripts). Le nom induisait une ambiguïté sur le scope réel. Par ailleurs, des projets d'envergure nécessitent une séparation claire entre les opérations infra et les accès production.

#### Décision

Renommer `git` → `devops` et définir trois niveaux d'agents opérationnels :

| Agent | Périmètre | Autonomie |
|---|---|---|
| `devops` | Commits, branches, CI/CD, releases, déploiements applicatifs, scripts | Autonome |
| `infra` | Serveurs, Docker, IaC, monitoring, configuration infrastructure | Autonome |
| `infra-prod` | Production uniquement — actions irréversibles ou à risque | Validation humaine obligatoire |

`infra` et `infra-prod` sont optionnels et créés à la demande du projet.

#### Conséquences

- CLAUDE.md mis à jour : `git` → `devops`, ajout `infra` et `infra-prod`
- DB : `UPDATE agents SET name='devops', type='devops' WHERE name='git';`
- Règle ajoutée : `infra-prod` ne peut jamais agir sans confirmation humaine explicite dans la session

---

### ADR-002 — Thinking mode par agent

**Date :** 2026-02-25 | **Statut :** accepté | **Auteur :** arch

#### Contexte

L'API Claude supporte plusieurs modes de raisonnement étendu (`extended thinking`) : désactivé, automatique, ou avec un budget de tokens explicite. Chaque type d'agent a un profil de complexité différent. Un mode unique pour tous les agents est soit trop coûteux (thinking inutile sur des tâches simples) soit insuffisant (absence de réflexion sur des décisions critiques).

La CLI `claude` expose le flag `--thinking disabled` pour désactiver le thinking étendu. Le mode `budget_tokens` (budget explicite via l'API) n'a pas encore de flag CLI documenté.

#### Décision

Ajouter une colonne `thinking_mode TEXT` sur la table `agents` avec les valeurs `auto | disabled | budget_tokens`. La valeur effective est lue par le lanceur (LaunchSessionModal / terminal.ts) et injectée comme flag CLI au lancement de la session.

**Valeurs et mapping CLI :**

| Valeur DB | Flag CLI | Comportement |
|---|---|---|
| `NULL` ou `'auto'` | *(aucun)* | Mode par défaut — Claude décide |
| `'disabled'` | `--thinking disabled` | Thinking étendu désactivé |
| `'budget_tokens'` | *(réservé)* | Budget explicite — implémenté quand le flag CLI sera disponible |

**Defaults recommandés par type** → voir § *Thinking mode par type d'agent* (Partie I).

**Règle de surcharge :** la valeur en DB est le default de l'agent. L'utilisateur peut la modifier par session via l'UI LaunchSessionModal avant le lancement — sans modifier la DB.

#### Conséquences

- Colonne `thinking_mode` ajoutée à la table `agents` (migration `ipc.ts` + `create-project-db`)
- `terminal.ts` : injection du flag `--thinking disabled` quand `thinkingMode === 'disabled'`
- `LaunchSessionModal.vue` : UI avec boutons Auto / Désactivé — valeur lue depuis la DB, modifiable avant lancement
- `types/index.ts` : type `'auto' | 'disabled' | null` (budget_tokens ajouté à la migration SQL, implémentation CLI à venir)
- La valeur `budget_tokens` est **réservée** en DB mais non encore injectée côté terminal

---

## Base de données

> `.claude/project.db` — source de vérité pour tâches, locks, sessions, logs.
> Accès direct via `sqlite3` CLI — plus rapide et plus fiable que le MCP server sqlite.

### Accès DB

```bash
# Requête ponctuelle
sqlite3 .claude/project.db "SELECT id, titre, statut FROM tasks ORDER BY updated_at DESC LIMIT 10;"

# Mode interactif
sqlite3 .claude/project.db
```

> Le MCP server sqlite (`@modelcontextprotocol/server-sqlite`) a été retiré : il n'est pas directement accessible aux agents et nécessitait le spawn de sous-agents coûteux. `sqlite3` via Bash est l'approche standard.

---

## Schéma DB v2

> Évolutions par rapport au schéma initial. À appliquer via migration SQL ou setup.

### Nouvelles colonnes

```sql
-- Ajout system_prompt sur agents (prompt système propre à chaque agent/type)
ALTER TABLE agents ADD COLUMN system_prompt TEXT;

-- Ajout du suffixe injecté automatiquement (voir § Suffixe caché)
ALTER TABLE agents ADD COLUMN system_prompt_suffix TEXT;

-- Ajout du mode de raisonnement par agent (voir § Thinking mode par type d'agent)
-- Valeurs : 'auto' | 'disabled' | 'budget_tokens' — NULL = auto par défaut
ALTER TABLE agents ADD COLUMN thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens'));
```

### Nouvelle table : config

```sql
-- Stockage des valeurs de configuration globale du projet
CREATE TABLE IF NOT EXISTS config (
    key         TEXT NOT NULL PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Valeurs initiales
INSERT OR IGNORE INTO config (key, value) VALUES
    ('claude_md_commit', ''),        -- SHA du dernier commit CLAUDE.md validé
    ('schema_version',   '2');       -- version du schéma DB
```

> `claude_md_commit` est mis à jour par l'agent `git` à chaque commit touchant `CLAUDE.md`. Les agents peuvent comparer avec `git rev-parse HEAD -- CLAUDE.md` pour détecter une version désynchronisée.

### Nouvelle table : perimetres

```sql
-- Périmètres déclarés du projet (source de vérité en DB)
CREATE TABLE IF NOT EXISTS perimetres (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,   -- ex: 'front-vuejs'
    dossier     TEXT,                   -- ex: 'renderer/'
    techno      TEXT,                   -- ex: 'Vue 3 + TypeScript'
    description TEXT,
    actif       INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Données initiales
INSERT OR IGNORE INTO perimetres (name, dossier, techno, description) VALUES
    ('front-vuejs',   'renderer/', 'Vue 3 + TypeScript + Tailwind CSS', 'Interface utilisateur Electron'),
    ('back-electron', 'main/',     'Electron + Node.js + SQLite',       'Process principal, IPC, accès DB'),
    ('global',        '',          '—',                                  'Transversal, aucun périmètre spécifique');
```

### Schéma SQL complet (v1 — référence)

```sql
CREATE TABLE IF NOT EXISTS agents (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL UNIQUE,
    type                 TEXT NOT NULL,
    perimetre            TEXT,
    system_prompt        TEXT,
    system_prompt_suffix TEXT,
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
    commentaire         TEXT,
    statut              TEXT NOT NULL DEFAULT 'a_faire'
                        CHECK(statut IN ('a_faire', 'en_cours', 'terminé', 'archivé')),
    agent_createur_id   INTEGER REFERENCES agents(id),
    agent_assigne_id    INTEGER REFERENCES agents(id),
    agent_valideur_id   INTEGER REFERENCES agents(id),
    parent_task_id      INTEGER REFERENCES tasks(id),
    session_id          INTEGER REFERENCES sessions(id),
    perimetre           TEXT,
    effort              INTEGER CHECK(effort IN (1,2,3)),  -- 1=small 2=medium 3=large
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

## Suffixe caché obligatoire

> Chaque agent doit avoir un `system_prompt_suffix` enregistré en DB. Ce suffixe est injecté **en fin** de system prompt par l'outil qui instancie les agents (Claude Code, script de lancement, etc.). Il ne doit pas être visible dans CLAUDE.md lui-même pour ne pas polluer le contexte de lecture — d'où le terme "caché".

### Objectif

Garantir que tout agent, quelle que soit sa session, respecte le protocole minimal sans avoir à relire l'intégralité du CLAUDE.md.

### Template de suffixe (à stocker dans `agents.system_prompt_suffix`)

```
---
AGENT PROTOCOL REMINDER (mandatory — do not override):
- On startup: read input session (sessions.summary) + open tasks from project.db
- On startup: if tasks with statut IN ('a_faire','en_cours') are found → start working immediately, do NOT ask the user what to do
- On startup: only ask for agent type/perimeter if NO tasks are assigned AND type cannot be inferred from DB
- Before starting a task: read full description + all task_comments (SELECT contenu FROM task_comments WHERE task_id = :task_id) — review feedback is mandatory
- Before modifying a file: check locks, then INSERT OR REPLACE INTO locks
- When taking a task: UPDATE tasks SET statut='en_cours'
- When finishing a task: UPDATE tasks SET statut='terminé', commentaire='<files:lines changed (e.g. Sidebar.vue:L319, ipc.ts:L87-L102) · what was done · why · what remains>'
- After completing a task: check assigned backlog — if tasks remain (a_faire/en_cours) → take the next one immediately; if none → close session (step 5)
- When ending session: release all locks + UPDATE sessions SET statut='terminé', summary='Done:... Pending:... Next:...' (this IS the input session for next startup)
- Never commit directly to main in multi-user mode
- Never edit project.db manually
```

### SQL pour positionner le suffixe

```sql
-- Suffixe générique (tous agents)
UPDATE agents SET system_prompt_suffix = '<template ci-dessus>' WHERE name = '<agent>';

-- Ou par type
UPDATE agents SET system_prompt_suffix = '<template>' WHERE type = 'dev';
```

---

## Gestion des périmètres en DB

Les périmètres sont déclarés dans la table `perimetres` (cf. Schéma DB v2). Cette table est la source de vérité — le tableau dans Partie I est une copie lisible pour référence rapide.

### Requêtes utiles

```sql
-- Lister les périmètres actifs
SELECT name, dossier, techno FROM perimetres WHERE actif = 1;

-- Agents par périmètre
SELECT a.name, a.type FROM agents a WHERE a.perimetre = '<perimetre>';

-- Tâches par périmètre
SELECT id, titre, statut FROM tasks WHERE perimetre = '<perimetre>' ORDER BY updated_at DESC;
```

---

## Migration DB v1 → v2

> À exécuter une fois, par l'agent `setup` ou `arch` après validation.

```sql
-- 1. Nouvelles colonnes agents
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN system_prompt_suffix TEXT;
ALTER TABLE agents ADD COLUMN thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens'));

-- 1b. Colonne effort sur tasks
ALTER TABLE tasks ADD COLUMN effort INTEGER CHECK(effort IN (1,2,3));
-- 1=small (vert), 2=medium (orange), 3=large (rouge) — nullable = pas de dot affiché

-- 2. Table config
CREATE TABLE IF NOT EXISTS config (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO config (key, value) VALUES ('claude_md_commit', ''), ('schema_version', '2');

-- 3. Table perimetres
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

-- 4. Mettre à jour claude_md_commit avec le SHA courant
-- UPDATE config SET value = '<git-sha>', updated_at = CURRENT_TIMESTAMP WHERE key = 'claude_md_commit';
```

