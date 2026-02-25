# Workflow tickets — SQL complet

> Référence complète des 6 étapes. Résumé rapide → `CLAUDE.md`.
> **Statuts valides :** `todo` → `in_progress` → `done` → `archived` (retour `todo` si rejeté)
> **Input session :** écrit en fin de session (`sessions.summary`), lu au démarrage suivant.

---

## Exécution des requêtes

```bash
# Lecture
node scripts/dbq.js "<VOTRE SQL>"

# Écriture
node scripts/dbw.js "<VOTRE SQL>"
```

> Implémentés via `sql.js` + `fs.readFile` — bypasse les file locks Windows (l'app tient la DB ouverte). Disponible après `npm install`.

---

## Étape 1 — Review crée le ticket

> Acteur : `review` ou `review-master`

```sql
INSERT INTO tasks (
    titre, description,
    statut, agent_createur_id, agent_assigne_id, perimetre
) VALUES (
    '<titre court et explicite>',
    '<description complète : contexte, symptômes, hypothèses, fichiers concernés, critères d''acceptation>',
    'todo',
    (SELECT id FROM agents WHERE name = '<review>'),
    (SELECT id FROM agents WHERE name = '<agent-cible>'),
    '<perimetre>'
);

-- Points d'attention (risques, dépendances, ce que review vérifiera)
INSERT INTO task_comments (task_id, agent_id, contenu)
VALUES (last_insert_rowid(), (SELECT id FROM agents WHERE name = '<review>'), '<commentaire review>');

INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail)
VALUES (:session_id, :agent_id, 'info', 'Task created', 'Task #<id>: <titre>');
```

> **Description max verbeuse.** Un agent reprenant le ticket sans contexte doit pouvoir le réaliser seul.

---

## Étape 2 — L'agent démarre sa session

> Acteur : agent assigné — obligatoire à chaque début de session.

```sql
-- 1. Enregistrement agent (idempotent)
INSERT OR IGNORE INTO agents (name, type, perimetre) VALUES ('<agent>', '<type>', '<perimetre>');

-- 2. Nouvelle session → conserver :session_id et :agent_id
INSERT INTO sessions (agent_id) VALUES ((SELECT id FROM agents WHERE name = '<agent>'));

-- 3. Charger session précédente + tâches en une seule passe
node scripts/dbstart.js <agent>

-- 4. Vérifier les locks actifs (conflits potentiels)
SELECT l.fichier, a.name FROM locks l
JOIN agents a ON a.id = l.agent_id
WHERE l.released_at IS NULL;

-- 5. (optionnel) Log démarrage — omettre si contexte limité
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail)
VALUES (:session_id, :agent_id, 'info', 'Session started', 'Perimetre: <perimetre>.');
```

> **Règle d'autonomie :** tâches trouvées → commencer immédiatement. Questions de démarrage seulement si aucune tâche ET type/périmètre non inférables.

---

## Étape 3 — L'agent prend le ticket

> Acteur : agent assigné.

```sql
-- Lire la description complète
SELECT titre, description FROM tasks WHERE id = :task_id;

-- Lire les 5 derniers commentaires (retours review, corrections)
SELECT tc.contenu, a.name, tc.created_at FROM task_comments tc
JOIN agents a ON a.id = tc.agent_id
WHERE tc.task_id = :task_id ORDER BY tc.created_at DESC LIMIT 5;

-- Passer en cours
UPDATE tasks
SET statut = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE id = :task_id;

-- Locker chaque fichier à modifier (AVANT toute modification)
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id)
VALUES ('<fichier>', :agent_id, :session_id);

-- (optionnel) Log — omettre si contexte limité
-- INSERT INTO agent_logs ... VALUES (:session_id, :agent_id, 'info', 'Task started', 'Task #<id>');
```

> Lock posé **avant** toute modification, jamais après.

---

## Étape 4 — L'agent termine le ticket

> Acteur : agent assigné — une fois le travail terminé et testé.

```sql
UPDATE tasks
SET statut       = 'done',
    completed_at = CURRENT_TIMESTAMP,
    updated_at   = CURRENT_TIMESTAMP
WHERE id = :task_id;

-- Commentaire de sortie OBLIGATOIRE
INSERT INTO task_comments (task_id, agent_id, contenu)
VALUES (:task_id, :agent_id, '<fichiers:lignes · ce qui a été fait · choix techniques · ce qui reste · points à valider>');

UPDATE locks
SET released_at = CURRENT_TIMESTAMP
WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;

-- (optionnel) Log — omettre si contexte limité
-- INSERT INTO agent_logs ... VALUES (:session_id, :agent_id, 'info', 'Task completed', 'Task #<id>');
```

> **Règle de continuité :** après `done`, consulter le backlog. Tâches restantes → prendre la suivante. Backlog vide → étape 5.

---

## Étape 5 — L'agent termine sa session

> Acteur : agent assigné — en fin de session.

```sql
UPDATE locks SET released_at = CURRENT_TIMESTAMP
WHERE agent_id = :agent_id AND released_at IS NULL;

UPDATE sessions
SET statut     = 'terminé',
    ended_at   = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP,
    summary    = 'Done: <accompli>. Pending: <tickets ouverts>. Next: <prochaine action>.'
WHERE id = :session_id;

-- (optionnel) Log — omettre si contexte limité
-- INSERT INTO agent_logs ... VALUES (:session_id, :agent_id, 'info', 'Session ended', '');
```

> `sessions.summary` doit être autosuffisant — un agent reprenant sans contexte doit savoir exactement où il en est.

---

## Étape 6 — Review valide ou rejette

> Acteur : `review` ou `review-master`.

```sql
-- CAS OK : archiver
UPDATE tasks
SET statut            = 'archived',
    agent_valideur_id = (SELECT id FROM agents WHERE name = '<review>'),
    validated_at      = CURRENT_TIMESTAMP,
    updated_at        = CURRENT_TIMESTAMP
WHERE id = :task_id;

INSERT INTO task_comments (task_id, agent_id, contenu)
VALUES (:task_id, (SELECT id FROM agents WHERE name = '<review>'), 'ARCHIVÉ — <observations>');

-- CAS KO : rejeter
UPDATE tasks SET statut = 'todo', updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;

INSERT INTO task_comments (task_id, agent_id, contenu)
VALUES (:task_id, (SELECT id FROM agents WHERE name = '<review>'), 'REJETÉ — <motif précis, corrections attendues, critères de re-validation>');
```
