-- Migration: Supprimer colonne commentaire de la table tasks
-- Date: 2026-02-25
-- Contexte: Les commentaires (review, sortie agent, notes) seront portés
--            exclusivement par la table task_comments (plus flexible, auteur tracé)

-- Étape 1: Migrer les commentaires existants vers task_comments
-- On inserts les commentaires existants dans task_comments avec agent_id NULL
-- (car on ne peut pas tracer l'auteur original)
INSERT INTO task_comments (task_id, agent_id, contenu, created_at)
SELECT id, NULL, commentaire, COALESCE(updated_at, created_at)
FROM tasks
WHERE commentaire IS NOT NULL AND commentaire != '';

-- Étape 2: Recréer la table tasks sans la colonne commentaire
-- SQLite ne supporte pas DROP COLUMN directement, on recrée la table

-- Sauvegarder les données
CREATE TABLE tasks_backup AS SELECT * FROM tasks;

-- Supprimer l'ancienne table
DROP TABLE tasks;

-- Recréer la table sans commentaire
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    description TEXT,
    statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','archivé')),
    agent_createur_id INTEGER REFERENCES agents(id),
    agent_assigne_id INTEGER REFERENCES agents(id),
    agent_valideur_id INTEGER REFERENCES agents(id),
    parent_task_id INTEGER REFERENCES tasks(id),
    session_id INTEGER REFERENCES sessions(id),
    perimetre TEXT,
    effort INTEGER CHECK(effort IN (1,2,3)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    validated_at DATETIME
);

-- Restaurer les données (sans commentaire)
INSERT INTO tasks (
    id, titre, description, statut, agent_createur_id, agent_assigne_id,
    agent_valideur_id, parent_task_id, session_id, perimetre, effort,
    created_at, updated_at, started_at, completed_at, validated_at
)
SELECT
    id, titre, description, statut, agent_createur_id, agent_assigne_id,
    agent_valideur_id, parent_task_id, session_id, perimetre, effort,
    created_at, updated_at, started_at, completed_at, validated_at
FROM tasks_backup;

-- Supprimer la table backup
DROP TABLE tasks_backup;

-- Vérification
SELECT 'Migration terminée. Vérification:' as message;
SELECT 'Nombre de tâches:' as label, COUNT(*) as count FROM tasks;
SELECT 'Nombre de commentaires migrés:' as label, COUNT(*) as count FROM task_comments WHERE contenu LIKE '%files changed%' OR contenu LIKE '%what was done%';
