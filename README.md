# agent-viewer

![Version](https://img.shields.io/badge/version-0.5.1-blue)
![Statut](https://img.shields.io/badge/statut-b%C3%A9ta-orange)

Interface desktop style Trello/Jira pour visualiser en temps réel les tâches des agents Claude depuis une base SQLite locale. L'application permet de gérer des agents, lancer des sessions, et dispose d'un terminal WSL intégré.

![Board agent-viewer](https://placehold.co/800x400/18181b/white?text=agent-viewer+board)

## Fonctionnalités principales

- **Board Trello/Jira** : Colonnes par statut (`todo`, `in_progress`, `done`, `archived`), cartes de tâches avec drill-down, badge effort S/M/L et priorité
- **Gestion des agents** : Création, configuration, édition system prompt, thinking mode (auto/disabled), assignation obligatoire
- **Terminal WSL intégré** : Sessions multiples, onglets, node-pty + xterm.js, crash recovery avec `--resume`
- **Auto-launch terminals** : Lancement automatique des sessions agent à la création d'une tâche avec assignation
- **Auto-trigger review** : Lancement automatique d'une session review quand ≥10 tâches atteignent le statut `done` (seuil configurable, cooldown)
- **Token stats** : Statistiques globales/quotidiennes/horaires de tokens, barres par agent, table par session
- **Terminal watchdog** : Détection automatique de crash et recovery avec paramètres de lancement stockés
- **Multi-instance** : Lancement de plusieurs instances du même agent avec isolation worktree git
- **Reprise de session** : Les sessions Claude Code sont reprises via `--resume <conv_id>` pour économiser les tokens
- **Détection multi-distro** : Découverte automatique des distributions WSL avec Claude Code installé
- **Connexion à un fichier externe** : Ouvre n'importe quel fichier `.claude/project.db`
- **Explorateur de fichiers** : Navigation et édition de fichiers du projet avec CodeMirror 6
- **Recherche** : Recherche plein texte dans les tâches avec filtres (statut, agent, périmètre)
- **Synchronisation CLAUDE.md** : Compare et met à jour depuis un dépôt GitHub master
- **Mode dark / light** : Thème sombre par défaut, mode clair disponible
- **Internationalisation** : Interface disponible en français et anglais (vue-i18n)
- **Token GitHub sécurisé** : Chiffrement OS-level via Electron `safeStorage` (DPAPI Windows / Keychain macOS)
- **Monitoring mémoire WSL** : Surveillance en temps réel de la RAM WSL avec alertes et libération mémoire

## Prérequis

| Logiciel | Version minimale |
|----------|-----------------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| WSL2 | Pour le terminal intégré |
| sql.js | ≥ 1.14 (inclus via `npm install`) |

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
│   │   ├── ipc.ts              # Handlers IPC core (SQL, window, locks, migrations)
│   │   ├── ipc-agents.ts       # Handlers IPC agents (CRUD, sessions, recherche)
│   │   ├── ipc-fs.ts           # Handlers IPC filesystem (listDir, readFile, writeFile)
│   │   ├── ipc-settings.ts     # Handlers IPC settings (config, GitHub, updates)
│   │   ├── db.ts               # Utilitaires SQLite (queryLive, writeLive)
│   │   ├── terminal.ts         # Gestion node-pty + WSL (spawn, resize, kill, memory)
│   │   ├── claude-md.ts        # Manipulation CLAUDE.md (insertion agents)
│   │   ├── migration.ts        # Migrations SQLite incrémentales (schéma v2+)
│   │   ├── seed.ts             # Données de démo pour project.db
│   │   └── default-agents.ts   # Agents par défaut insérés à la création d'un projet
│   ├── preload/
│   │   └── index.ts            # contextBridge — expose electronAPI au renderer
│   └── renderer/               # Application Vue 3
│       └── src/
│           ├── main.ts         # Point d'entrée Vue + Pinia + i18n
│           ├── App.vue         # Composant racine
│           ├── stores/         # Stores Pinia
│           │   ├── tasks.ts    # Tâches, agents, locks, projet
│           │   ├── tabs.ts     # Gestion des onglets (multi-type)
│           │   └── settings.ts # Thème, langue, GitHub, CLAUDE.md
│           ├── components/     # Composants Vue (~20 composants)
│           ├── composables/    # Composables Vue (useAutoLaunch, useConfirmDialog…)
│           ├── locales/        # Traductions i18n (fr.json, en.json)
│           ├── utils/          # Utilitaires (agentColor…)
│           └── types/
│               └── index.ts    # Types TypeScript partagés
├── scripts/                    # Scripts CLI (dbq.js, dbw.js, dbstart.js)
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
| i18n | vue-i18n 9 (FR/EN) |
| Terminal | node-pty 1 + @xterm/xterm 5 |
| Base de données | sql.js 1.14 (SQLite WASM, bypass file locks) |
| Tests | Vitest 4 |
| Éditeur de code | CodeMirror 6 |
| Markdown | marked + DOMPurify |

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
