# Contribution à agent-viewer

Merci de votre intérêt pour agent-viewer ! Ce guide détaille les conventions et procédures pour contribuer au projet.

## Table des matières

1. [Workflow de développement](#workflow-de-développement)
2. [Conventions de code](#conventions-de-code)
3. [Architecture IPC](#architecture-ipc)
4. [Tests](#tests)
5. [Créer une tâche](#créer-une-tâche)
6. [Lancer un agent Claude](#lancer-un-agent-claude)
7. [Versioning](#versioning)

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

-- Locker un fichier
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id)
VALUES ('src/renderer/src/App.vue', 1, 10);

-- Terminer une tâche
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
| ESLint | Config v9 (flat config) — `eslint.config.mjs` |
| Vue | Composition API uniquement |
| CSS | Tailwind CSS v4 (classes utilitaires) |
| Tests | Vitest (configuré — `vitest.config.ts`) |

### Conventional Commits

```bash
feat:     # Nouvelle fonctionnalité
fix:      # Bugfix
chore:    # Maintenance, dépendance
docs:     # Documentation
refactor: # Refactoring
test:     # Tests
perf:     # Performance
style:    # Formatage
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
- **sandbox** : activé
- **Tous les accès Node.js** : via IPC uniquement
- **Jamais d'accès direct au système de fichiers** depuis le renderer
- **Token GitHub** : chiffré OS-level via `safeStorage` (DPAPI / Keychain), jamais stocké en clair

### Handlers IPC — `src/main/ipc.ts`

| Handler | Description |
|---------|-------------|
| `query-db` | Requête SQL en lecture sur la DB (sql.js, bypass lock via `readFile`) |
| `watch-db` | Surveille les changements du fichier DB (fs.watch) |
| `unwatch-db` | Arrête la surveillance |
| `select-project-dir` | Sélecteur de dossier projet (dialog Electron) |
| `select-new-project-dir` | Sélecteur pour créer un nouveau projet |
| `create-project-db` | Crée une DB SQLite vierge dans `.claude/` |
| `find-project-db` | Cherche `project.db` dans `.claude/` d'un dossier |
| `init-new-project` | Initialise un projet (crée DB + insère agents par défaut) |
| `migrate-db` | Migre le schéma SQLite vers la version courante |
| `get-locks` | Retourne les locks actifs |
| `get-locks-count` | Retourne le nombre de locks actifs |
| `show-confirm-dialog` | Affiche une boîte de confirmation native |
| `fs:listDir` | Liste un répertoire (explorateur de fichiers, 4 niveaux max) |
| `fs:readFile` | Lit un fichier texte (restreint au répertoire projet) |
| `fs:writeFile` | Écrit un fichier texte (restreint au répertoire projet) |
| `window-minimize` | Réduit la fenêtre |
| `window-maximize` | Maximise / restaure la fenêtre |
| `window-close` | Ferme l'application |
| `window-is-maximized` | Retourne l'état maximisé |
| `close-agent-sessions` | Clôture les sessions `en_cours` d'un agent |
| `rename-agent` | Renomme un agent dans la DB |
| `update-perimetre` | Met à jour le nom/description d'un périmètre |
| `update-agent-system-prompt` | Met à jour le system prompt d'un agent |
| `update-agent-thinking-mode` | Met à jour le mode de pensée d'un agent |
| `update-agent` | Met à jour les champs d'un agent (nom, type, périmètre…) |
| `get-agent-system-prompt` | Retourne system_prompt, suffix, thinking_mode d'un agent |
| `build-agent-prompt` | Construit le prompt de lancement Claude Code d'un agent |
| `create-agent` | Crée un agent + insère dans CLAUDE.md si présent |
| `get-config-value` | Lit une clé de la table `config` |
| `set-config-value` | Écrit une clé dans la table `config` |
| `check-master-md` | Vérifie CLAUDE.md master sur GitHub (via token chiffré) |
| `apply-master-md` | Applique le CLAUDE.md master dans le projet |
| `test-github-connection` | Teste la connexion GitHub avec le token stocké |
| `check-for-updates` | Vérifie si une nouvelle version est disponible sur GitHub |
| `search-tasks` | Recherche plein texte dans les tâches avec filtres |
| `session:setConvId` | Stocke le `claude_conv_id` d'une session pour `--resume` |

### Handlers IPC — `src/main/terminal.ts`

| Handler | Description |
|---------|-------------|
| `terminal:getWslUsers` | Liste les utilisateurs WSL disponibles (`/etc/passwd`) |
| `terminal:getClaudeProfiles` | Liste les profils Claude dans `~/bin/` (WSL) |
| `terminal:create` | Crée un PTY WSL (avec agent/resume/simple bash) |
| `terminal:write` | Envoie des données au PTY |
| `terminal:resize` | Redimensionne le PTY |
| `terminal:kill` | Tue le PTY (graceful pour les sessions agents) |
| `terminal:subscribe` | No-op — conservé pour re-souscription après hot-reload |

### Événements IPC (main → renderer)

| Événement | Description |
|-----------|-------------|
| `db-changed` | La DB a changé sur le disque (déclenche refresh) |
| `window-state-changed` | Fenêtre maximisée/restaurée |
| `terminal:data:<id>` | Données du PTY |
| `terminal:exit:<id>` | PTY terminé |
| `terminal:convId:<id>` | UUID de session Claude Code détecté au démarrage |

### Ajouter un nouveau handler

1. Définir le handler dans `src/main/ipc.ts` avec JSDoc (`@param`, `@returns`, `@throws`)
2. Exposer via `contextBridge` dans `src/preload/index.ts`
3. Déclarer le type dans l'interface `Window.electronAPI` dans `src/renderer/src/stores/tasks.ts`
4. Mettre à jour la table handlers dans `CONTRIBUTING.md`

---

## Tests

agent-viewer utilise **Vitest** pour les tests unitaires et d'intégration.

```bash
npm run test            # Exécution une fois
npm run test:watch      # Mode watch (développement)
npm run test:coverage   # Rapport de couverture Istanbul
```

### Organisation des tests

| Fichier | Périmètre |
|---------|-----------|
| `src/main/ipc.spec.ts` | IPC handlers (main process) |
| `src/main/migration.spec.ts` | Migrations SQLite |
| `src/renderer/src/stores/stores.spec.ts` | Stores Pinia |
| `src/renderer/src/components/components.spec.ts` | Composants Vue |

### Conventions

- Les fichiers de tests se nomment `*.spec.ts` à côté du fichier testé
- Mocks Electron : `vi.mock('electron', ...)` en tête de fichier
- Chaque handler IPC critique doit avoir au moins un test nominal et un test d'erreur

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
3. Configurez le prompt et les options si nécessaire
4. Un terminal WSL s'ouvre avec l'agent

L'application tente automatiquement de **reprendre** la session précédente via `--resume <conv_id>` si une session Claude Code valide existe en DB (économise ~2500 tokens de contexte).

### Types d'agents disponibles

| Type | Périmètre | Description |
|------|-----------|-------------|
| `dev` | front-vuejs / back-electron | Développement de features |
| `test` | front-vuejs / back-electron | Tests unitaires et intégration |
| `review` | global | Audit et validation |
| `doc` | global | Documentation |
| `devops` | global | CI/CD, releases |
| `arch` | global | Architecture, ADR, IPC |
| `ux` | front-vuejs | Interface et expérience utilisateur |
| `secu` | global | Sécurité |
| `perf` | global | Performance |
| `data` | global | Base de données, schéma |

---

## Versioning

agent-viewer utilise [SemVer](https://semver.org/).

### Règles de bump

| Type de changement | Incrément | Exemple |
|--------------------|-----------|---------|
| Bugfix rétrocompatible | PATCH | 0.3.0 → 0.3.1 |
| Feature rétrocompatible | MINOR | 0.3.0 → 0.4.0 |
| Breaking change | MAJOR | 0.3.0 → 1.0.0 |

### Commandes de release

```bash
npm run release        # Patch
npm run release:minor  # Minor
npm run release:major  # Major
```

> **Note** : Les releases nécessitent une connexion GitHub pour créer le tag et le draft release. Le token doit être configuré dans les paramètres de l'application.

---

## Ressources

- [CLAUDE.md](./CLAUDE.md) — Documentation architecturale complète
- [CHANGELOG.md](./CHANGELOG.md) — Historique des versions
- [Issues GitHub](https://github.com/IvyNotFound/agent-viewer/issues) — Signalement de bugs et demandes de features
