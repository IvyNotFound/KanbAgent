# Contribution à agent-viewer

Merci de votre intérêt pour agent-viewer ! Ce guide détaille les conventions et procédures pour contribuer au projet.

## Table des matières

1. [Workflow de développement](#workflow-de-développement)
2. [Conventions de code](#conventions-de-code)
3. [Architecture IPC](#architecture-ipc)
4. [Créer une tâche](#créer-une-tâche)
5. [Lancer un agent Claude](#lancer-un-agent-claude)
6. [Versioning](#versioning)

---

## Workflow de développement

agent-viewer utilise un workflow basé sur des tickets stockés dans la base SQLite du projet.

### Cycle de vie d'une tâche

```
a_faire → en_cours → terminé → archivé
                         ↘ (rejet) → a_faire
```

| Statut | Description |
|--------|-------------|
| `a_faire` | Tâche à faire |
| `en_cours` | Tâche en cours de traitement |
| `terminé` | Tâche terminée, en attente de validation |
| `archivé` | Tâche validée et archivée |

### Étapes pour un développeur

1. **Sélectionner une tâche** — Choisir une tâche `a_faire` assignée
2. **Locker les fichiers** — Avant toute modification
3. **Travailler sur la tâche** — Implémenter, tester
4. **Terminer la tâche** — Commentaire de sortie obligatoire
5. **Libérer les locks** — En fin de session

### Requêtes SQL utiles

```sql
-- Voir les tâches assignées
SELECT id, titre, statut FROM tasks
WHERE agent_assigne_id = (SELECT id FROM agents WHERE name = 'dev-front-vuejs')
AND statut IN ('a_faire', 'en_cours');

-- Passer une tâche en cours
UPDATE tasks SET statut = 'en_cours', started_at = CURRENT_TIMESTAMP
WHERE id = 42;

--Locker un fichier
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id)
VALUES ('src/renderer/src/App.vue', 1, 10);

--Terminer une tâche
UPDATE tasks SET statut = 'terminé',
  commentaire = 'App.vue:L1-50 · Added new component · Next: add tests',
  completed_at = CURRENT_TIMESTAMP
WHERE id = 42;
```

---

## Conventions de code

### Langue

- **Documentation utilisateur** : Français
- **Code et commentaires inline** : Anglais
- **Messages de commit** : Français (Conventional Commits)

### Style de code

| Catégorie | Convention |
|-----------|------------|
| TypeScript | Strict, pas de `any` implicite |
| ESLint | Config par défaut (Airbnb optional) |
| Vue | Composition API uniquement |
| CSS | Tailwind CSS classes |
| Tests | À configurer (Vitest recommandé) |

### Conventional Commits

```bash
feat:    # Nouvelle fonctionnalité
fix:     # Bugfix
chore:   # Maintenance, dépendance
docs:    # Documentation
refactor:# Refactoring
test:    # Tests
perf:    # Performance
style:   # Formatage
```

Exemples :
```bash
feat: ajout du mode drag-and-drop sur les cartes
fix: correction du crash lors de la fermeture d'un terminal
docs: mise à jour du README avec les nouvelles commandes
```

---

## Architecture IPC

### Principes de sécurité

- **contextIsolation** : activé
- **nodeIntegration** : désactivé
- **Tous les accès Node.js** : via IPC uniquement
- **Jamais d'accès direct au système de fichiers** depuis le renderer

### Handlers IPC principaux

| Handler | Description |
|---------|-------------|
| `query-db` | Requête SQL sur la DB |
| `watch-db` | Surveiller les changements DB |
| `select-project-dir` | Sélecteur de dossier |
| `terminal-create` | Créer un terminal WSL |
| `fs:writeFile` | Écrire un fichier (main process uniquement) |

### Ajouter un nouveau handler

1. Définir le handler dans `src/main/ipc.ts`
2. Exposer via `contextBridge` dans `src/preload/index.ts`
3. Déclarer le type dans `window.electronAPI` (stores/tasks.ts)
4. Ajouter JSDoc avec `@param`, `@returns`

---

## Créer une tâche

```sql
INSERT INTO tasks (
  titre, description, commentaire,
  statut, agent_createur_id, agent_assigne_id, perimetre
) VALUES (
  'Titre de la tâche',
  'Description complète avec contexte et critères d''acceptation',
  'Notes pour le développeur',
  'a_faire',
  (SELECT id FROM agents WHERE name = 'review'),
  (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
  'front-vuejs'
);
```

---

## Lancer un agent Claude

1. Sélectionnez un agent dans la sidebar
2. Cliquez sur "Lancer la session"
3. Configurez le prompt si nécessaire
4. Un terminal WSL s'ouvre avec l'agent

### Types d'agents disponibles

| Type | Périmètre | Description |
|------|-----------|-------------|
| `dev` | front-vuejs / back-electron | Développement de features |
| `review` | — | Audit et validation |
| `doc` | global | Documentation |
| `devops` | — | CI/CD, releases |

---

## Versioning

agent-viewer utilise [SemVer](https://semver.org/).

### Règles de bump

| Type de changement | Incrément | Exemple |
|--------------------|-----------|----------|
| Bugfix rétrocompatible | PATCH | 0.3.0 → 0.3.1 |
| Feature rétrocompatible | MINOR | 0.3.0 → 0.4.0 |
| Breaking change | MAJOR | 0.3.0 → 1.0.0 |

### Commandes de release

```bash
npm run release       # Patch
npm run release:minor # Minor
npm run release:major # Major
```

> **Note** : Les releases nécessitent une connexion GitHub pour créer le tag et le draft release.

---

## Ressources

- [CLAUDE.md](./CLAUDE.md) — Documentation architecturale complète
- [CHANGELOG.md](./CHANGELOG.md) — Historique des versions
- [Issues GitHub](https://github.com/IvyNotFound/agent-viewer/issues) — Signalement de bugs et demandes de features
