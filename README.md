# agent-viewer

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Statut](https://img.shields.io/badge/statut-b%C3%A9ta-orange)

Interface desktop style Trello/Jira pour visualiser en temps réel les tâches des agents Claude depuis une base SQLite locale. L'application permet de gérer des agents, lancer des sessions, et dispose d'un terminal WSL intégré.

![Board agent-viewer](https://placehold.co/800x400/18181b/white?text=agent-viewer+board)

## Fonctionnalités principales

- **Board Trello/Jira** : Colonnes par statut (`à faire`, `en cours`, `terminé`, `archivé`), cartes de tâches avec drill-down
- **Gestion des agents** : Création, configuration, lancement de sessions Claude Code
- **Terminal WSL intégré** : Sessions multiples, onglets,node-pty + xterm.js
- **Connexion à un fichier externe** : Ouvre n'importe quel fichier `.claude/project.db`
- **Mode dark natif** : Thème sombre par défaut
- **Synchronisation CLAUDE.md** : Compare et met à jour depuis un projet master

## Prérequis

| Logiciel | Version minimale |
|----------|-----------------|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| WSL2 | Pour le terminal intégré |
| sqlite3 CLI | Optionnel (téléchargé automatiquement) |

## Installation

```bash
# Clonez le projet
git clone https://github.com/IvyNotFound/agent-viewer.git
cd agent-viewer

# Installez les dépendances
npm install
```

## Utilisation

### Développement

```bash
npm run dev
```

Lance l'application en mode développement avec hot-reload :
- Main process Electron
- Preload scripts
- Renderer Vue 3 sur http://localhost:5173

### Build desktop (Windows)

```bash
npm run build
```

Productions :
- `dist/win-unpacked/` — Application décompressée
- `dist/*.exe` — Installeur (si Wine disponible)

### Commandes disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Démarrage en mode développement |
| `npm run build` | Build production Windows |
| `npm run build:dir` | Build sans empaquetage |
| `npm run lint` | Vérification ESLint |
| `npm run test` | Exécution des tests |
| `npm run release` | Release patch (SemVer) |
| `npm run release:minor` | Release mineure |
| `npm run release:major` | Release majeure |

## Architecture

```
agent-viewer/
├── src/
│   ├── main/           # Processus principal Electron
│   │   ├── index.ts    # Point d'entrée, création BrowserWindow
│   │   ├── ipc.ts     # Handlers IPC (SQL, fichiers, terminal)
│   │   └── terminal.ts# Gestion node-pty + WSL
│   ├── preload/        # Scripts preload (contextBridge)
│   └── renderer/       # Application Vue 3
│       └── src/
│           ├── main.ts # Point d'entrée Vue + Pinia
│           ├── App.vue # Composant racine
│           ├── stores/# Stores Pinia
│           │   ├── tasks.ts
│           │   ├── tabs.ts
│           │   └── settings.ts
│           └── components/
├── electron.vite.config.ts
├── electron-builder.config.ts
└── package.json
```

### Flux de données

```
┌─────────────────┐     IPC (contextBridge)     ┌─────────────────┐
│  Vue Renderer   │ ◄────────────────────────► │  Electron Main  │
│   (Pinia)       │                             │   (sql.js)      │
└─────────────────┘                             └────────┬────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │  SQLite DB      │
                                                  │  (project.db)   │
                                                  └─────────────────┘
```

### Stack technique

| Catégorie | Technologie |
|-----------|-------------|
| Framework desktop | Electron 28 |
| Build tool | electron-vite |
| Frontend | Vue 3 + TypeScript |
| State management | Pinia |
| CSS | Tailwind CSS v3 |
| Terminal | node-pty + xterm.js |
| Base de données | sql.js (SQLite WASM) |
| Éditeur de code | CodeMirror 6 |

## Configuration

### Variables d'environnement

Aucune variable d'environnement requise pour le fonctionnement de base.

### Stockage local

L'application utilise `localStorage` pour :
- `projectPath` — Chemin du projet connecté
- `dbPath` — Chemin vers la DB SQLite
- `theme` — Thème (`dark` ou `light`)
- `language` — Langue (`fr` ou `en`)
- `github_token` — Token GitHub (si configuré)

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md) pour :
- Workflow de développement
- Conventions de code
- Procédure de soumission

## Licence

MIT
