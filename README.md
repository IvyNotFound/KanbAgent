# agent-viewer

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Statut](https://img.shields.io/badge/statut-b%C3%A9ta-orange)

Interface desktop style Trello/Jira pour visualiser en temps réel les tâches des agents Claude depuis une base SQLite locale. L'application permet de gérer des agents, lancer des sessions, et dispose d'un terminal WSL intégré.

![Board agent-viewer](https://placehold.co/800x400/18181b/white?text=agent-viewer+board)

## Fonctionnalités principales

- **Board Trello/Jira** : Colonnes par statut (`todo`, `in_progress`, `done`, `archived`), cartes de tâches avec drill-down
- **Gestion des agents** : Création, configuration, lancement de sessions Claude Code
- **Terminal WSL intégré** : Sessions multiples, onglets, node-pty + xterm.js
- **Reprise de session** : Les sessions Claude Code sont reprises via `--resume <conv_id>` pour économiser les tokens
- **Connexion à un fichier externe** : Ouvre n'importe quel fichier `.claude/project.db`
- **Explorateur de fichiers** : Navigation et édition de fichiers du projet directement depuis l'app
- **Recherche** : Recherche plein texte dans les tâches avec filtres (statut, agent, périmètre)
- **Synchronisation CLAUDE.md** : Compare et met à jour depuis un dépôt GitHub master
- **Mode dark natif** : Thème sombre par défaut
- **Token GitHub sécurisé** : Chiffrement OS-level via Electron `safeStorage` (DPAPI Windows / Keychain macOS)

## Prérequis

| Logiciel | Version minimale |
|----------|-----------------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| WSL2 | Pour le terminal intégré |
| sql.js | ^1.14.0 (inclus via `npm install`) | SQLite WASM — couche DB canonique, bypass file locks |

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
| `npm run test` | Exécution des tests (Vitest) |
| `npm run test:watch` | Tests en mode watch |
| `npm run test:coverage` | Rapport de couverture |
| `npm run release` | Release patch (SemVer) |
| `npm run release:minor` | Release mineure |
| `npm run release:major` | Release majeure |

## Architecture

```
agent-viewer/
├── src/
│   ├── main/                   # Processus principal Electron
│   │   ├── index.ts            # Point d'entrée, BrowserWindow, CSP
│   │   ├── ipc.ts              # Handlers IPC (SQL, fichiers, agents, GitHub…)
│   │   ├── terminal.ts         # Gestion node-pty + WSL (spawn, resize, kill)
│   │   ├── migration.ts        # Migrations SQLite incrémentales (schéma v2+)
│   │   └── default-agents.ts   # Agents par défaut insérés à la création d'un projet
│   ├── preload/
│   │   └── index.ts            # contextBridge — expose electronAPI au renderer
│   └── renderer/               # Application Vue 3
│       └── src/
│           ├── main.ts         # Point d'entrée Vue + Pinia
│           ├── App.vue         # Composant racine
│           ├── stores/         # Stores Pinia
│           │   ├── tasks.ts    # Tâches, agents, locks, projet
│           │   ├── tabs.ts     # Gestion des onglets
│           │   └── settings.ts # Thème, langue, GitHub, CLAUDE.md
│           ├── components/     # Composants Vue
│           └── types/
│               └── index.ts    # Types TypeScript partagés
├── electron.vite.config.ts
├── electron-builder.config.ts
└── package.json
```

### Flux de données

```
┌─────────────────┐     IPC (contextBridge)     ┌─────────────────┐
│  Vue Renderer   │ ◄────────────────────────► │  Electron Main  │
│   (Pinia)       │                             │  (sql.js + pty) │
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
| Framework desktop | Electron 40 |
| Build tool | electron-vite 5 |
| Frontend | Vue 3 + TypeScript 5 |
| State management | Pinia 2 |
| CSS | Tailwind CSS v4 (`@tailwindcss/postcss`) |
| Terminal | node-pty 1 + @xterm/xterm 5 |
| Base de données | sql.js 1.14 (SQLite WASM) |
| Tests | Vitest 4 |
| Éditeur de code | CodeMirror 6 |

## Configuration

### Variables d'environnement

Aucune variable d'environnement requise pour le fonctionnement de base.

### Configuration WSL 2 recommandée (usage intensif d'agents)

WSL 2 tourne dans une VM Hyper-V qui alloue de la RAM dynamiquement mais ne la restitue pas automatiquement à Windows. Par défaut, WSL 2 peut utiliser jusqu'à 50% de la RAM système. Après plusieurs heures d'agents Claude actifs, la VM accumule de la RAM (heap Node.js, buffers kernel, etc.) même si les processus sont terminés.

**Créer ou modifier** `C:\Users\<votre-utilisateur>\.wslconfig` :

```ini
[wsl2]
memory=4GB            # Limite max RAM allouée à WSL (adapter selon RAM disponible)
processors=4          # Optionnel : limiter les vCPUs

[experimental]
autoMemoryReclaim=gradual   # WSL 2.0+ : libère la mémoire inutilisée progressivement
# Alternatives : "dropcache" (agressif) ou "disabled" (défaut)
```

> **Note** : Après modification, exécuter `wsl --shutdown` dans PowerShell pour appliquer les changements.

 Références : [Documentation WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

### Stockage local

L'application utilise `localStorage` pour :
- `projectPath` — Chemin du projet connecté
- `dbPath` — Chemin vers la DB SQLite
- `theme` — Thème (`dark` ou `light`)
- `language` — Langue (`fr` ou `en`)
- `github_token` — Token GitHub (si configuré, chiffré via `safeStorage` côté main)
- `github_repo_url` — URL du dépôt GitHub
- `github_last_check` — Timestamp de la dernière vérification de connexion GitHub

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md) pour :
- Workflow de développement
- Conventions de code
- Procédure de soumission

## Licence

MIT
