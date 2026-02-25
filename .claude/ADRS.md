# ADRs — Architecture Decision Records

> Décisions d'architecture validées. Toute nouvelle ADR → agent `arch`, révision CLAUDE.md.

---

## ADR-001 — Nomenclature des agents opérationnels

**Date :** 2026-02-24 | **Statut :** accepté | **Auteur :** arch

### Contexte

L'agent `git` couvrait un périmètre plus large que les opérations git pures (CI/CD, releases, scripts). Le nom induisait une ambiguïté. Des projets d'envergure nécessitent une séparation entre opérations infra et accès production.

### Décision

Renommer `git` → `devops` et définir trois niveaux d'agents opérationnels :

| Agent | Périmètre | Autonomie |
|---|---|---|
| `devops` | Commits, branches, CI/CD, releases, scripts | Autonome |
| `infra` | Serveurs, Docker, IaC, monitoring, configuration | Autonome |
| `infra-prod` | Production uniquement — actions irréversibles ou à risque | Validation humaine obligatoire |

`infra` et `infra-prod` sont optionnels, créés à la demande.

### Conséquences

- CLAUDE.md mis à jour : `git` → `devops`, ajout `infra` et `infra-prod`
- DB : `UPDATE agents SET name='devops', type='devops' WHERE name='git';`
- Règle ajoutée : `infra-prod` ne peut jamais agir sans confirmation humaine explicite

---

## ADR-002 — Thinking mode par agent

**Date :** 2026-02-25 | **Statut :** révisé 2026-02-25 | **Auteur :** arch

### Contexte

L'API Claude supporte plusieurs modes de raisonnement étendu. Chaque type d'agent a un profil de complexité différent — désactiver le thinking pour les agents simples (test, doc, devops) réduit les coûts de façon significative.

**Audit des leviers réels (doc Claude Code 2026-02-25) :**

| Levier | Disponibilité | Contrôle |
|---|---|---|
| `alwaysThinkingEnabled` | `settings.json` projet/user | `true` / `false` |
| `CLAUDE_CODE_EFFORT_LEVEL` | env var / settings.json | `low/medium/high` — **Opus 4.6 uniquement** |

Il n'existe **pas** de flag `--thinking disabled` ni de paramètre `budget_tokens` dans la CLI `claude`. La valeur `budget_tokens` stockée en DB était anticipatoire — elle n'a jamais eu de correspondance CLI.

### Décision

Colonne `thinking_mode TEXT` sur `agents` avec valeurs **`auto | disabled`** (NULL = auto). La valeur est lue par le lanceur (LaunchSessionModal / terminal.ts) et injectée via `--settings`.

| Valeur DB | Injection CLI | Comportement |
|---|---|---|
| `NULL` ou `'auto'` | *(aucun flag)* | Mode par défaut — Claude décide |
| `'disabled'` | `--settings '{"alwaysThinkingEnabled":false}'` | Extended thinking désactivé |

**Règle de surcharge :** valeur DB = default. L'utilisateur peut modifier par session via LaunchSessionModal.

### Conséquences

- Colonne `thinking_mode` sur `agents` : CHECK constraint → `('auto', 'disabled')` — `budget_tokens` retiré
- `terminal.ts` : injection `--settings '{"alwaysThinkingEnabled":false}'` quand `thinkingMode === 'disabled'`
- `LaunchSessionModal.vue` : UI 2 boutons — Auto / Désactivé (bouton "Budget" supprimé)
- `CLAUDE_CODE_EFFORT_LEVEL` hors scope agent-viewer (Opus uniquement, pas exposé par IPC)

---

## ADR-003 — Consolidation WSL : un seul utilisateur, sélecteur de profil API

**Date :** 2026-02-25 | **Statut :** accepté | **Auteur :** arch

### Contexte

Trois users WSL distincts pour isoler les configurations API de Claude Code : deux Claude Pro (OAuth), un Minimax M2.5 (API key + endpoint compatible).

**Problèmes du multi-user :**
- nvm par user → risque de version Node divergente
- node_modules dupliqués → surcharge disque
- Logs `~/.claude/` fragmentés → debugging difficile

**Contrainte :** clés API ne doivent pas être dans `project.db`.

**Besoin réel :** choisir le profil API au moment du lancement (per-session, pas per-agent).

### Décision

**Un seul user WSL.** Profil API sélectionnable dans `LaunchSessionModal` via des scripts wrapper dans `~/bin/`.

```bash
# ~/bin/claude-pro2  (second compte OAuth)
#!/bin/bash
export CLAUDE_CONFIG_DIR="$HOME/.claude-pro2"
exec claude "$@"

# ~/bin/claude-minimax  (MiniMax-M2.5 — ANTHROPIC_AUTH_TOKEN, PAS API_KEY)
#!/bin/bash
# ANTHROPIC_AUTH_TOKEN évite le warning "Auth conflict" (≠ ANTHROPIC_API_KEY)
# Base URL officielle Minimax : https://api.minimax.io/anthropic (international)
# Doc : https://platform.minimax.io/docs/guides/text-ai-coding-tools
export ANTHROPIC_BASE_URL="https://api.minimax.io/anthropic"
export ANTHROPIC_AUTH_TOKEN="YOUR_MINIMAX_API_KEY"
export ANTHROPIC_MODEL="MiniMax-M2.5"
export ANTHROPIC_SMALL_FAST_MODEL="MiniMax-M2.5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="MiniMax-M2.5"
export ANTHROPIC_DEFAULT_OPUS_MODEL="MiniMax-M2.5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="MiniMax-M2.5"
exec claude "$@"
```

> Le compte OAuth principal n'a pas besoin de wrapper — `claude` nu utilise `~/.claude/`.

**Pourquoi `ANTHROPIC_AUTH_TOKEN` et pas `ANTHROPIC_API_KEY` pour minimax ?**
`ANTHROPIC_API_KEY` déclenche le warning "Auth conflict" quand OAuth est aussi présent. `ANTHROPIC_AUTH_TOKEN` est la variable alternative reconnue par le SDK Anthropic — elle ne déclenche pas ce warning. Recommandé par la doc Minimax officielle.

**Découverte des profils :** `terminal:getClaudeProfiles` IPC liste les `claude-*` dans `~/bin/`. LaunchSessionModal affiche un sélecteur avec ces profils + `claude` (défaut).

**Sécurité `claudeCommand` :** validé contre le pattern `^claude(-[a-z0-9-]+)?$` avant interpolation dans le shell. Toute valeur non conforme → erreur IPC.

### Conséquences

**Aucun changement de schéma DB.** Profil = décision de session, pas attribut d'agent.

**`terminal.ts`** :
- IPC `terminal:getClaudeProfiles` → liste `claude-*` dans `~/bin/` WSL
- `terminal:create` reçoit `claudeCommand?: string` (défaut : `'claude'`)
- Regex validation `^claude(-[a-z0-9-]+)?$` obligatoire

**`LaunchSessionModal.vue`** :
- Sélecteur "Profil API" peuplé via `terminal:getClaudeProfiles`
- Valeur transmise à `tabsStore.addTerminal` → `TerminalView` → `terminal:create`

**Setup OAuth secondaire :**
```bash
mkdir -p ~/.claude-pro2
ln -s ~/.claude/settings.json ~/.claude-pro2/settings.json  # optionnel
CLAUDE_CONFIG_DIR=~/.claude-pro2 claude auth login
```

**Setup Minimax :**
```bash
mkdir -p ~/.claude-minimax
cp ~/.claude/settings.json ~/.claude-minimax/settings.json  # copie, pas symlink
# Éditer ~/bin/claude-minimax : renseigner ANTHROPIC_API_KEY
chmod +x ~/bin/claude-minimax
```

**Migration WSL :**
1. Sauvegarder `~/.claude/` de chaque user WSL à supprimer
2. Garder l'unique user WSL principal (ex. `cover`)
3. Créer les wrappers dans `~/bin/`
4. Supprimer les users WSL superflus

### Comparatif d'approches

| Approche | Statut | Risques |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | ✅ Documenté officiellement | Aucun effet de bord |
| `HOME` override | ⚠️ Non documenté | Casse nvm, `.bashrc`, chemins node_modules |
| `ANTHROPIC_API_KEY` seul | ❌ Insuffisant pour OAuth | Conflit si token OAuth présent |

---

## ADR-004 — Migration Tailwind CSS v3 → v4

**Date :** 2026-02-25 | **Statut :** accepté | **Auteur :** arch

### Contexte

Version actuelle : `tailwindcss ^3.4.1`. Tailwind CSS v4.0 est sorti en janvier 2025 (stable).

**État du codebase :**
- `tailwind.config.ts` : `darkMode: 'class'`, 4 couleurs brand custom (violet/emerald/amber/zinc), content glob `./src/renderer/**/*.{vue,ts,html}`
- `postcss.config.js` : plugin `tailwindcss: {}` + `autoprefixer: {}`
- `main.css` : directives `@tailwind base/components/utilities`
- ~186 classes Tailwind dans 21 composants Vue
- `ring-*` (focus:ring-1/ring-violet-500) dans 8 fichiers — pattern uniforme
- `outline-none` dans 8 fichiers
- `placeholder-zinc-*` dans plusieurs composants
- Aucun usage de `bg-opacity`, `text-opacity` (classes supprimées en v4 — non concerné)

**Breaking changes v4 applicables au projet :**

| Changement | Impact | Fichiers concernés |
|---|---|---|
| Suppression `tailwind.config.ts` → `@theme` CSS | Élevé | `tailwind.config.ts` + `main.css` |
| `@tailwind base/components/utilities` → `@import 'tailwindcss'` | Faible | `main.css` (3 lignes) |
| Plugin postcss : `tailwindcss` → `@tailwindcss/postcss` | Faible | `postcss.config.js` (1 ligne) |
| Couleurs brand → variables CSS `--color-brand-*` dans `@theme` | Moyen | `main.css` |
| `ring-*` : anneau défaut 3px → 1px (mais `ring-1` inchangé) | Nul | usage `ring-1` déjà explicite |
| `darkMode: 'class'` → default v4, pas de config nécessaire | Nul | supprimé avec config |
| `placeholder-*` : syntaxe inchangée | Nul | — |

### Décision

**Migrer vers Tailwind CSS v4.** Justification :

1. **Projet en bêta (0.x)** : pas de contrainte de rétrocompatibilité
2. **Breaking changes maîtrisés** : scope limité (3 fichiers de config, CSS variables pour 4 couleurs), aucun usage des patterns les plus risqués (`bg-opacity/*`, `[attr]` arbitraires complexes)
3. **Gains réels** : compilation Rust (Lightning CSS) — builds 5-10× plus rapides ; CSS variables natives (meilleur interop dark mode) ; `@import 'tailwindcss'` simplifie main.css
4. **`ring-1` explicite dans tout le codebase** : le changement du ring défaut (3px→1px) ne nous affecte pas

**Approche postcss (pas `@tailwindcss/vite`)** retenue car electron-vite ne supporte pas encore nativement le plugin Vite Tailwind v4 dans la config multi-process (main/preload/renderer) sans configuration additionnelle.

### Plan de migration (ordre d'exécution)

**Périmètre : `devops` + `dev-front-vuejs`** | **Branche dédiée : `feat/tailwind-v4`**

#### Étape 1 — Mise à jour dépendances

```bash
npm uninstall tailwindcss
npm install tailwindcss@^4 @tailwindcss/postcss@^4
# autoprefixer : optionnel (v4 inclut vendor prefixes) mais conservé pour compatibilité
```

#### Étape 2 — `postcss.config.js`

```js
// Avant
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }

// Après
module.exports = { plugins: { '@tailwindcss/postcss': {}, autoprefixer: {} } }
```

#### Étape 3 — `src/renderer/src/assets/main.css`

```css
/* Avant */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Après — @import en premier, puis @theme pour config, puis styles custom */
@import 'tailwindcss';

@theme {
  --color-brand-violet: #8b5cf6;
  --color-brand-emerald: #10b981;
  --color-brand-amber: #f59e0b;
  --color-brand-zinc: #71717a;
}
```

> Les classes `brand-violet`, `brand-emerald` etc. restent fonctionnelles car v4 génère automatiquement les utilitaires (`bg-brand-violet`, `text-brand-emerald`) depuis les variables `--color-brand-*`.

#### Étape 4 — Suppression `tailwind.config.ts`

```bash
rm tailwind.config.ts
```

> `content` glob : v4 détecte automatiquement les fichiers via `@import` et le répertoire projet — pas de config nécessaire pour les patterns standards `.vue/.ts/.html`.

> `darkMode: 'class'` : comportement `dark:` via classe `.dark` est le **default** en v4 — aucune config requise.

#### Étape 5 — Vérification visuelle

```bash
npm run dev
# Vérifier : dark mode, couleurs brand, focus rings sur les inputs, placeholders
```

#### Étape 6 — Tests + build

```bash
npm test
npm run build
```

### Fichiers modifiés (résumé)

| Fichier | Action |
|---|---|
| `package.json` | `tailwindcss ^3.4.1` → `^4`, ajout `@tailwindcss/postcss ^4` |
| `postcss.config.js` | `tailwindcss` → `@tailwindcss/postcss` |
| `src/renderer/src/assets/main.css` | `@tailwind *` → `@import + @theme` |
| `tailwind.config.ts` | **Supprimé** |

**Composants Vue : aucune modification requise** — le mapping `brand-*` est conservé via `@theme`.

### Risques identifiés

| Risque | Probabilité | Mitigation |
|---|---|---|
| electron-vite incompatibilité postcss v4 | Faible | Fallback : pin `@tailwindcss/postcss@4.0.x` stable |
| Détection auto `content` manque des fichiers | Faible | Ajouter `@source './src/renderer/**/*'` dans main.css si classes purgées |
| Comportement `ring-*` non conforme | Très faible | Tous les usages sont `focus:ring-1` explicite |
| Regression visuelle couleurs brand | Faible | Variables CSS `--color-brand-*` validées en v4 |

### Plan de rollback

```bash
git checkout main -- tailwind.config.ts postcss.config.js src/renderer/src/assets/main.css
npm uninstall tailwindcss @tailwindcss/postcss
npm install tailwindcss@^3.4.1
```

### Conséquences

- Ticket d'implémentation à créer par `review` → assigné `devops` (npm) + `dev-front-vuejs` (CSS/config)
- Branche dédiée `feat/tailwind-v4` — PR vers `main` après validation visuelle complète
- `electron.vite.config.ts` : aucune modification attendue (postcss géré automatiquement par Vite)

---

## ADR-005 — Maintien de sql.js + ReadFile pour l'accès concurrent à project.db

**Date :** 2026-02-25 | **Statut :** accepté | **Auteur :** arch

### Contexte

Le user a demandé d'évaluer le remplacement de `sql.js` par `better-sqlite3` pour l'accès à `project.db` dans `src/main/ipc.ts` et `src/main/migration.ts`.

**Contrainte documentée (MEMORY.md) :** Le serveur MCP SQLite maintient `project.db` verrouillé en permanence. `node-sqlite3-wasm` avait déjà été testé et échoue avec ce scénario.

**Analyse du mécanisme de lock :**

`project.db` utilise `journal_mode=DELETE` et `locking_mode=NORMAL` (confirmé via `PRAGMA`).

Sur Windows, SQLite implémente ses verrous via `LockFileEx` sur des byte-ranges précis :

| Verrou SQLite | Portée | Compatible lecteurs ? |
|---|---|---|
| SHARED | Byte range 0x40000000+ | Oui (multi-reader OK) |
| RESERVED | 1 octet spécifique | Oui mais signale écriture imminente |
| PENDING | 1 octet spécifique | Bloque nouveaux SHARED |
| EXCLUSIVE | All bytes | Bloque tout |

Le serveur MCP SQLite garde une connexion permanente ouverte en lecture/écriture. Lors d'une écriture (agents, sessions, tâches), il monte jusqu'à EXCLUSIVE — ce qui bloque toute connexion `sqlite3_open_v2()` concurrente.

**Pourquoi `ReadFile()` bypasse ce mécanisme :**

`fs.readFile()` sur Windows appelle `ReadFile()` Win32. Or `LockFileEx` implémente des verrous "advisory" au niveau Windows — ils bloquent d'autres appels `LockFileEx`, mais **pas** les accès `ReadFile()` bruts. sql.js charge les bytes en mémoire WASM puis les traite indépendamment, sans jamais appeler `LockFileEx`.

**Pourquoi `better-sqlite3` ne peut pas bypasser ce mécanisme :**

`better-sqlite3` est un binding natif C++ qui appelle `sqlite3_open_v2()`. Cette fonction appelle le VFS SQLite Windows, qui lui-même appelle `LockFileEx` pour coordonner l'accès concurrent. Même avec `{ readonly: true }`, better-sqlite3 doit acquérir un SHARED lock via `LockFileEx` — ce qui est bloqué si le MCP tient un PENDING ou EXCLUSIVE lock au moment de la tentative.

Ce comportement est **identique** à `node-sqlite3-wasm`, qui utilise aussi `sqlite3_open_v2()` (via WASM, mais avec le même VFS SQLite). La preuve empirique de l'échec de `node-sqlite3-wasm` valide que `better-sqlite3` échouerait de manière équivalente.

### Décision

**REJETER la migration vers better-sqlite3** pour les accès à `project.db`.

**MAINTENIR** l'approche `sql.js` + `fs.readFile()` comme solution canonique pour l'accès concurrent à une DB SQLite verrouillée par un autre processus sur Windows.

### Conditions qui invalideraient cette décision

Si le serveur MCP SQLite est reconfiguré avec :
- `PRAGMA journal_mode = WAL` : WAL permet des lecteurs concurrents même pendant une écriture. Dans ce cas, `better-sqlite3 { readonly: true }` fonctionnerait sans conflit.

Ce serait une migration en deux étapes : (1) forcer WAL sur `project.db`, (2) remplacer sql.js par better-sqlite3. Hors scope tant que le MCP utilise DELETE journal mode.

### Conséquences

- **Aucune modification de code** — décision de non-migration documentée.
- `sql.js` reste la dépendance canonique pour les lectures DB dans `ipc.ts` et `migration.ts`.
- **Risque résiduel documenté** : le pattern read-copy-update (`readFile → modify → writeFile`) utilisé pour les écritures agent-viewer présente un risque de race condition si le MCP écrit simultanément. Ce risque est pré-existant et hors scope de cette évaluation.
- Toute future proposition de migration vers `better-sqlite3` ou `node-sqlite3-wasm` doit passer par `arch` et référencer cette ADR.
