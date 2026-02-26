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

---

## ADR-006 — Concurrence multi-instances agents dev

**Date :** 2026-02-26 | **Statut :** accepté | **Auteur :** arch

### Contexte

Quand on lance N instances du même agent (ex. 2× `dev-front-vuejs`), les risques suivants existent :

1. **Double prise de tâche** — deux instances lisent le même ticket `todo` et passent toutes deux `in_progress`
2. **Conflit fichiers** — deux instances modifient les mêmes fichiers simultanément
3. **Conflit git** — modifications sur la même branche/worktree → merge impossible
4. **Perte d'écriture DB** — `dbw.js` fait `readFile → modify → writeFile` : si deux écritures se chevauchent, la dernière écrase la première (last-write-wins)

**Mécanismes existants :**
- Table `locks` : `(fichier, agent_id, session_id)` — conçue pour un agent à la fois, non testée en multi-instance
- `dbw.js` : read-copy-update non atomique (ADR-005 risque résiduel documenté)
- Session : chaque instance crée sa propre session → `session_id` sert naturellement d'identifiant d'instance

### Décision

#### 1. Prise de tâche atomique via claim-and-check

Le pattern `UPDATE ... WHERE statut='todo'` dans `dbw.js` est pseudo-atomique (un seul processus écrit à la fois car `writeFileSync` prend un bref lock OS). Mais le vrai risque est le TOCTOU : deux instances **lisent** le ticket comme `todo` via `dbq.js`, puis chacune **écrit** `in_progress`.

**Solution : claim-and-verify.**

```
# Étape 1 — Claim (chaque instance tente)
node scripts/dbw.js "UPDATE tasks SET statut='in_progress', session_id=<MY_SESSION> WHERE id=<TASK_ID> AND statut='todo'"

# Étape 2 — Verify (l'instance vérifie qu'elle a gagné)
node scripts/dbq.js "SELECT session_id FROM tasks WHERE id=<TASK_ID> AND statut='in_progress'"
# Si session_id ≠ MY_SESSION → la tâche a été prise par une autre instance → passer au ticket suivant
```

Ce pattern fonctionne car :
- `writeFileSync` sérialise les écritures au niveau OS (verrou bref sur le fichier)
- La vérification post-écriture détecte la perte de course : si l'autre instance a écrit après, son `session_id` sera présent
- Pas de modification de `dbw.js` nécessaire

**Règle workflow mise à jour :** remplacer `UPDATE tasks SET statut='in_progress'` par le pattern claim-and-verify ci-dessus dans la section "Étape 3" de WORKFLOW.md.

#### 2. Locks fichiers renforcés — vérification obligatoire avant modification

La table `locks` est déjà correcte structurellement. Le `session_id` distingue les instances.

**Protocole renforcé :**

```sql
-- Avant de modifier un fichier, vérifier qu'aucun lock actif n'existe pour un autre session_id
SELECT l.fichier, a.name, l.session_id
FROM locks l JOIN agents a ON a.id = l.agent_id
WHERE l.fichier = '<fichier>' AND l.released_at IS NULL AND l.session_id != <MY_SESSION>;

-- Si résultat non vide → NE PAS modifier, passer à un autre fichier ou attendre
-- Si vide → poser le lock
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id) VALUES ('<fichier>', :agent_id, :session_id);
```

**Limitation connue :** ce check-then-lock a aussi un TOCTOU minime (deux instances vérifient, puis lockent). Acceptable car :
- La fenêtre de course est de quelques ms (query + insert)
- En pratique, les agents dev travaillent sur des fichiers différents (périmètres distincts)
- L'isolation git (point 3) est le filet de sécurité final

#### 3. Isolation git — worktree par instance

Chaque instance travaille dans un **git worktree dédié**, créé au démarrage de session.

**Convention de nommage :**
```
Branche : agent/<agent-name>/s<session-id>
Worktree : .claude/worktrees/s<session-id>
```

**Cycle de vie :**
```bash
# Création (démarrage session)
git worktree add .claude/worktrees/s<session_id> -b agent/<agent-name>/s<session_id>

# Travail — l'agent opère dans le worktree
cd .claude/worktrees/s<session_id>

# Nettoyage (fin de session)
git worktree remove .claude/worktrees/s<session_id>
# La branche reste pour merge/review
```

**Impact terminal.ts :** le `cwd` passé à `terminal:create` doit pointer vers le worktree si multi-instance est activé. Ajout d'un paramètre optionnel `workDir` dans l'IPC `terminal:create`.

#### 4. Visibilité UI — distinction des instances

Les sessions ont déjà un `id` unique. Pour distinguer les instances dans la UI :

- **Sidebar / AgentLogsView** : afficher `agent-name #S<session_id>` quand plusieurs sessions du même agent sont `en_cours` simultanément
- **BoardView / TaskCard** : la tâche affiche `session_id` en plus de `agent_name` quand assignée

**Pas de nouvelle colonne DB** — le `session_id` existant suffit comme identifiant d'instance.

#### 5. Workflow merge — review comme intégrateur

```
1. L'instance termine son travail → push sa branche agent/<name>/s<id>
2. L'instance marque sa tâche `done`
3. review-master (ou review) :
   a. Vérifie le code sur la branche
   b. Merge vers main (fast-forward ou merge commit selon conflits)
   c. Si conflit → crée une tâche de résolution assignée à l'agent concerné
   d. Archive la tâche
4. Nettoyage : review supprime la branche après merge
```

**Ordre de merge :** par priorité de tâche (`critical > high > normal > low`), puis par `completed_at` (FIFO).

### Modifications nécessaires

| Composant | Modification | Effort |
|---|---|---|
| `WORKFLOW.md` | Étape 3 : claim-and-verify + locks renforcés | Faible |
| `CLAUDE.md` | Section protocole agent : mention worktree multi-instance | Faible |
| `terminal.ts` | Paramètre optionnel `workDir` dans `terminal:create` | Faible |
| `LaunchSessionModal.vue` | Option "multi-instance" qui crée le worktree au lancement | Moyen |
| Sidebar/BoardView | Affichage `#S<id>` conditionnel | Faible |
| Aucun changement DB | `session_id` existant suffit | Nul |

### Risques

| Risque | Probabilité | Mitigation |
|---|---|---|
| TOCTOU sur claim-and-verify | Faible | Fenêtre de course < 100ms + verify post-write |
| Conflits de merge entre worktrees | Moyenne | Review comme intégrateur + tâches de résolution |
| Worktrees orphelins (crash agent) | Moyenne | Nettoyage au démarrage : `git worktree prune` |
| `project.db` corruption (writes concurrents) | Faible | Sérialisé par `writeFileSync` OS-level lock |

### Hors scope

- Migration `dbw.js` vers un mécanisme transactionnel (WAL, better-sqlite3) — voir ADR-005
- Orchestrateur centralisé (file de tâches, broker) — sur-ingénierie pour le volume actuel (< 10 instances simultanées)
- Auto-scaling du nombre d'instances — décision manuelle de l'opérateur

### Conséquences

- Aucune migration DB nécessaire — les structures existantes (`sessions`, `locks`, `tasks.session_id`) suffisent
- Le pattern claim-and-verify est rétrocompatible : un agent solo l'utilise sans effet secondaire
- L'isolation worktree est opt-in : un agent solo continue de travailler sur `main` directement
- Tickets d'implémentation à créer par `review` : un pour WORKFLOW.md, un pour `terminal.ts` workDir, un pour UI multi-instance

---

## ADR-008 — Affectation multi-agents par tâche

**Date :** 2026-02-26 | **Statut :** accepté | **Auteur :** arch

### Contexte

`tasks.agent_assigne_id` est un INTEGER FK unique → 1 agent par tâche. Certaines tâches nécessitent une collaboration entre agents de périmètres différents (ex. dev-front + dev-back). La duplication de tickets est un contournement non souhaitable.

### Décision

#### 1. Nouvelle table `task_agents` (many-to-many)

```sql
CREATE TABLE task_agents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(id),
  role        TEXT CHECK(role IN ('primary', 'support', 'reviewer')),
  assigned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(task_id, agent_id)
);
CREATE INDEX idx_task_agents_task_id  ON task_agents(task_id);
CREATE INDEX idx_task_agents_agent_id ON task_agents(agent_id);
```

**Rôles :** `primary` (responsable principal), `support` (contribution ponctuelle), `reviewer` (audit). NULL = non spécifié.

#### 2. Compatibilité ascendante — `agent_assigne_id` conservé

`tasks.agent_assigne_id` reste la référence pour les queries existantes (BoardView, dbstart, search-tasks, build-agent-prompt). Il représente l'agent principal.

**Règle de cohérence :** `task:setAssignees` synchronise automatiquement `tasks.agent_assigne_id` avec l'assigné ayant `role='primary'`, ou le premier de la liste si aucun n'est `primary`, ou `NULL` si liste vide.

#### 3. Migration DB — schema version 3 → 4

Dans `migrateDb()`, après les migrations existantes, créer `task_agents` si elle n'existe pas. Bumper `CURRENT_SCHEMA_VERSION` de `'3'` à `'4'`.

#### 4. Nouveaux handlers IPC

**`task:getAssignees`**
- Input : `(dbPath: string, taskId: number)`
- Output : `{ success: boolean, assignees: Array<{ agent_id: number, agent_name: string, role: string|null, assigned_at: string }>, error?: string }`
- Implémentation : `SELECT ta.agent_id, a.name as agent_name, ta.role, ta.assigned_at FROM task_agents ta JOIN agents a ON a.id = ta.agent_id WHERE ta.task_id = ? ORDER BY ta.assigned_at ASC`

**`task:setAssignees`**
- Input : `(dbPath: string, taskId: number, assignees: Array<{ agentId: number, role?: string | null }>)`
- Output : `{ success: boolean, error?: string }`
- Comportement : transaction atomique — DELETE task_agents + INSERT + UPDATE tasks.agent_assigne_id
- Validation : `role` doit être `null | 'primary' | 'support' | 'reviewer'`
- Localisation : `src/main/ipc-agents.ts` (registerAgentHandlers)

#### 5. Ajouts preload `src/preload/index.ts`

```ts
getTaskAssignees: (dbPath: string, taskId: number): Promise<{
  success: boolean
  assignees: Array<{ agent_id: number; agent_name: string; role: string | null; assigned_at: string }>
  error?: string
}> => ipcRenderer.invoke('task:getAssignees', dbPath, taskId),

setTaskAssignees: (dbPath: string, taskId: number, assignees: Array<{ agentId: number; role?: string | null }>): Promise<{
  success: boolean
  error?: string
}> => ipcRenderer.invoke('task:setAssignees', dbPath, taskId, assignees),
```

#### 6. Impact front (spécification pour dev-front-vuejs)

**`TaskDetailModal.vue`** : multi-select agents avec dropdown + sélecteur de rôle par agent. Appel `setTaskAssignees` au save. Afficher l'agent principal en premier (role='primary' ou agent_assigne_id).

**`TaskCard.vue`** : fetch `task_agents` via `getTaskAssignees` ou depuis le store. Afficher ≤ 3 avatars colorés (`agentColor`) + badge "+N" si N > 3. Fallback sur `agent_assigne_id` si `task_agents` vide.

**`BoardView.vue`** : aucune modification — le filtre par `agent_assigne_id` reste valide (agent principal).

**Store `tasks.ts`** : le champ `assignees` peut être chargé à la demande (lazy) dans `TaskDetailModal`, pas nécessairement dans le store global (éviter surcharge du fetch boardview).

### Ordre d'implémentation

1. `dev-back-electron` : migration DB + handlers IPC (ce qui suit cette ADR)
2. `dev-front-vuejs` : UI TaskDetailModal + TaskCard
3. `test-back-electron` + `test-front-vuejs` : tests
4. `review` : audit final

### Conséquences

- `CURRENT_SCHEMA_VERSION` : `'3'` → `'4'` dans `src/main/db.ts`
- `tasks.agent_assigne_id` conservé sans dépréciation formelle — migration future si besoin
- `CLAUDE.md` (section schema DB) mis à jour pour inclure `task_agents`
- Pas de breaking change IPC — deux nouveaux handlers ajoutifs

---

## ADR-009 — Remplacement node-pty/xterm.js par CLI stream-json

**Date :** 2026-02-26 | **Statut :** accepté (Option B — roadmap v1.x) | **Auteur :** arch

### Contexte

L'architecture actuelle node-pty + xterm.js présente des problèmes récurrents :

| Problème | Tickets |
|---|---|
| Fuites mémoire xterm.js | T559, T564 |
| Vulnérabilités sécurité PTY | T532, T546 |
| Cycle de vie PTY complexe (listeners orphelins) | T563 |
| Output non structuré — impossible d'afficher de façon riche | — |

Deux options de remplacement ont été évaluées via spikes dédiés.

---

### Option A — SDK @anthropic-ai/claude-agent-sdk (T574 — REJETÉ v0.x)

**Évaluation :** le SDK est un wrapper autour de l'API Anthropic REST — il appelle `api.anthropic.com` directement, **pas** le CLI `claude` local.

**Contrainte bloquante :** `ANTHROPIC_API_KEY` requis. Or l'authentification de l'environnement de développement est **OAuth CLI** (Claude Pro/Max — abonnement), pas une API key. Ces deux modes sont incompatibles dans le SDK v0.x.

**Décision :** REJETÉ pour v0.x. Maintenir en roadmap v2.0 si Anthropic expose une API SDK compatible OAuth ou un SDK qui délègue au CLI local.

---

### Option B — CLI stream-json via child_process.spawn (T576 — VALIDÉ)

**Hypothèse :** `claude -p --verbose --input-format stream-json --output-format stream-json` avec `stdio: ['pipe', 'pipe', 'pipe']` = remplacement complet sans API key, auth OAuth existante.

#### Résultats du spike T576

| Question | Test | Résultat |
|---|---|---|
| Q1 | stream-json sans `-p` (mode interactif pur) | **FAIL** — `--output-format` requiert `-p` |
| Q1b | stream-json avec `-p --verbose` (baseline) | **PASS** ✓ |
| Q2 | Multi-turn via stdin `--input-format stream-json` | **PASS** ✓ |
| Q3 | `--thinking` expose des blocs thinking dans stream-json | **FAIL** — aucun bloc `type:"thinking"` sur claude-sonnet-4-6 |
| Q4 | `--resume <conv_id>` compatible avec stream-json | **PASS** ✓ |

**Verdict :** PASS partiel — les 3 fonctionnalités critiques (lancement structuré, multi-turn, reprise de session) sont validées. Q3 (thinking) est une limitation documentée, non bloquante.

#### Types de messages JSONL observés

| Type | Sous-type / champs | Moment |
|---|---|---|
| `system` | `subtype: "init"`, `session_id` | Démarrage — fournit le `conv_id` |
| `user` | `message.role: "user"`, `message.content[]` | Écho du message envoyé en stdin |
| `assistant` | `message.content[]` avec `type:"text"` | Réponse Claude (texte) |
| `assistant` | `message.content[]` avec `type:"tool_use"` | Appel outil |
| `result` | `cost_usd`, `num_turns`, `session_id` | Fin de chaque tour |

> **Note Q3 :** `message.content[]` avec `type:"thinking"` absent dans les réponses claude-sonnet-4-6 même avec `--thinking enabled`. Seul Opus pourrait l'exposer (non testé). Contournement : garder le mode thinking PTY actuel (ADR-002) pour les agents qui en ont besoin.

#### Format stdin (multi-turn)

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "..." }]
  }
}
```

> Le **premier** message stdin doit être envoyé immédiatement après le `spawn()`, avant même l'événement `system:init`. Les messages suivants sont envoyés après chaque événement `result`.

> Si aucun message stdin prévu → fermer stdin avec `proc.stdin.end()` immédiatement après spawn.

> `--verbose` est **obligatoire** — sans ce flag, les événements `system` et `user` sont absents du flux JSONL.

#### Architecture cible

```
child_process.spawn('claude', [
  '-p', '--verbose',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  // optionnel : '--resume', convId
  // optionnel : '--append-system-prompt', '...'
], { stdio: ['pipe', 'pipe', 'pipe'] })
```

**Dans `src/main/ipc.ts` ou `src/main/terminal.ts` :**
- `stdout` : readline ligne par ligne → parse JSON → émettre via IPC structuré
- `stdin` : écriture JSONL au format `{ type: "user", message: ... }`
- `session_id` extrait de l'événement `system:init` → stocké en `sessions.claude_conv_id`

**IPC Electron → Vue (nouveaux channels) :**

```ts
// agent:stream — émis pour chaque événement JSONL parsé
interface AgentStreamEvent {
  terminalId: string
  event: {
    type: 'system' | 'user' | 'assistant' | 'result'
    subtype?: string
    session_id?: string
    message?: { role: string; content: Array<{ type: string; text?: string }> }
    cost_usd?: number
    num_turns?: number
  }
}

// agent:sendMessage — envoi d'un message utilisateur mid-session
interface AgentSendMessagePayload {
  terminalId: string
  text: string
}
```

**Vue — composant `AgentStreamView.vue`** (remplace `TerminalView.vue` pour les sessions agents) :
- Affiche les blocs `assistant.message.content[]` de façon structurée (texte, tool_use)
- Conserve un historique scrollable des tours
- Bouton "Envoyer" → IPC `agent:sendMessage`

#### Contrainte abonnement

| Auth | Compatibilité |
|---|---|
| OAuth CLI (Claude Pro/Max) | ✓ Compatible — `claude -p` utilise le même auth que CLI interactif |
| ANTHROPIC_API_KEY | ✓ Compatible (si défini dans l'env) |
| SDK @anthropic-ai/sdk direct | ✗ Incompatible avec OAuth (voir Option A) |

---

### Décision

**Adopter Option B — CLI stream-json** pour le remplacement de node-pty/xterm.js dans les sessions agents Claude.

**Roadmap :**
- **v1.x** : implémentation principale — `child_process.spawn + stream-json` dans `terminal.ts` ou nouvel `agent-stream.ts`, IPC structuré, `AgentStreamView.vue`
- **v2.0** : réévaluer Option A SDK si Anthropic publie un SDK compatible OAuth

### Questions ouvertes (non bloquantes pour v1.x)

1. **Q3 — Thinking blocks :** pas de `type:"thinking"` dans stream-json sur sonnet-4-6. Conserver node-pty pour les agents `thinking_mode:'auto'` jusqu'à résolution, ou accepter l'absence de blocs thinking dans l'UI structurée.
2. **TerminalView coexistence :** les terminaux génériques (non-agents) continuent à utiliser node-pty + xterm.js. La migration est **additive** — `AgentStreamView` pour les sessions agents, `TerminalView` pour le reste.
3. **System prompt injection :** avec stream-json, `--append-system-prompt` fonctionne en argument CLI. Valider que les caractères spéciaux (backticks, guillemets) sont correctement escapés.

### Modifications nécessaires

| Fichier | Action | Effort |
|---|---|---|
| `src/main/agent-stream.ts` (nouveau) | Spawn + readline + IPC pour CLI stream-json | Élevé |
| `src/main/ipc.ts` | Enregistrer les handlers `agent:*` | Moyen |
| `src/preload/index.ts` | Exposer `agentStream`, `agentSendMessage`, `agentKill` | Faible |
| `src/renderer/src/components/AgentStreamView.vue` (nouveau) | Affichage structuré des events stream-json | Élevé |
| `src/renderer/src/stores/tabs.ts` | Type de tab `'agent-stream'` | Faible |
| Tests | `agent-stream.spec.ts` + `AgentStreamView.spec.ts` | Moyen |

### Conséquences

- node-pty + xterm.js conservés pour les terminaux génériques — migration non cassante
- `sessions.claude_conv_id` peuplé depuis `system:init.session_id` — aucun changement de schéma
- `--resume` validé — la reprise de session fonctionne avec stream-json
- Tickets d'implémentation à créer par `review` : `agent-stream.ts` (back-electron) + `AgentStreamView.vue` (front-vuejs) + tests

---

## ADR-007 — Support Windows natif pour les sessions Claude Code

**Date :** 2026-02-26 | **Statut :** accepté | **Auteur :** arch

### Contexte

Actuellement, agent-viewer ne peut lancer des sessions Claude Code que via WSL (`wsl.exe` → `node-pty`). Le besoin est de supporter également le lancement de Claude Code installé nativement sous Windows (npm global → `claude.cmd`), sans WSL.

**Analyse du code existant :**

`terminal.ts` est 100% WSL-centric :
- `spawn('wsl.exe', args, ...)` — hard-codé
- `toWslPath()` — conversion Windows → `/mnt/c/...`
- `startMemoryMonitoring()` — exécute `wsl.exe -- free -m`
- `terminal:getClaudeInstances` — scan des distros WSL
- `terminal:getClaudeProfiles` — scan `~/bin/` dans WSL
- Env vars `wslRequiredVars` — spécifiques à `wsl.exe`
- `gracefulKillPty()` — séquence Ctrl+C → `exit\r` → kill (adaptée bash WSL)

**node-pty sur Windows :**
node-pty supporte nativement Windows via ConPTY (Windows 10 1809+). `spawn('cmd.exe', ...)` ou `spawn('powershell.exe', ...)` fonctionne sans configuration supplémentaire. La compilation actuelle inclut déjà ConPTY (cf. MEMORY.md — Spectre mitigation fix).

### Décision

Ajouter un paramètre `env: 'wsl' | 'windows'` à l'IPC `terminal:create` et un nouveau handler `terminal:getWindowsClaudeInstances` pour la détection Windows.

#### 1. IPC `terminal:create` — nouveau paramètre `env`

**Signature actuelle :**
```ts
terminal:create(cols, rows, projectPath?, wslDistro?, systemPrompt?, userPrompt?, thinkingMode?, claudeCommand?, convId?)
```

**Problème :** ajouter `env` comme 10ème paramètre positionnel rend l'API illisible et fragile.

**Solution : migration vers un objet options.**

```ts
// Nouveau payload — objet unique au lieu de paramètres positionnels
interface TerminalCreatePayload {
  cols: number
  rows: number
  env: 'wsl' | 'windows'        // NEW — défaut: 'wsl' pour rétrocompatibilité
  projectPath?: string
  wslDistro?: string             // ignoré si env='windows'
  systemPrompt?: string
  userPrompt?: string
  thinkingMode?: string
  claudeCommand?: string
  convId?: string
}
```

**Rétrocompatibilité :** le handler backend accepte les deux formes pendant une transition :
```ts
ipcMain.handle('terminal:create', async (event, ...args) => {
  // Object form (new)
  if (args.length === 1 && typeof args[0] === 'object') {
    const payload = args[0] as TerminalCreatePayload
    // ...
  }
  // Positional form (legacy) — env defaults to 'wsl'
  else {
    const [cols, rows, projectPath, wslDistro, ...rest] = args
    // ...
  }
})
```

**Impact preload :**
```ts
// Avant — positional args
terminalCreate: (cols, rows, projectPath?, wslDistro?, ...) => ...

// Après — object payload
terminalCreate: (payload: TerminalCreatePayload) => ipcRenderer.invoke('terminal:create', payload)

// Legacy compat — supprimer dans 0.4.0
terminalCreateLegacy: (cols, rows, ...) => ipcRenderer.invoke('terminal:create', cols, rows, ...)
```

#### 2. Branche Windows dans `terminal:create`

Quand `env === 'windows'` :

```ts
// Shell = cmd.exe (PowerShell a des quirks d'encoding avec node-pty)
const shell = 'cmd.exe'
const shellArgs: string[] = []

// Env minimal pour Windows natif
const ptyEnv: Record<string, string> = {
  TERM: 'xterm-256color',
  PATH: process.env.PATH || '',
  USERPROFILE: process.env.USERPROFILE || '',
  APPDATA: process.env.APPDATA || '',
  LOCALAPPDATA: process.env.LOCALAPPDATA || '',
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  HOME: process.env.HOME || process.env.USERPROFILE || '',
}

// CWD = projectPath tel quel (pas de toWslPath)
const cwd = projectPath ?? process.env.USERPROFILE ?? 'C:\\'

const pty = spawn(shell, shellArgs, {
  name: 'xterm-256color',
  cols, rows, cwd,
  env: ptyEnv,
})
```

**Lancement Claude (agent session) :**
```ts
// Windows : claude.cmd est dans le PATH npm global
// Pas de bash -lc, pas de temp script — cmd.exe exécute directement
const cmd = claudeCommand ?? 'claude'
const thinkingFlag = thinkingMode === 'disabled'
  ? ' --settings "{\\"alwaysThinkingEnabled\\":false}"'
  : ''

if (validConvId) {
  // Resume
  pty.write(`${cmd} --resume ${validConvId}${thinkingFlag}\r`)
} else if (systemPrompt && userPrompt) {
  // System prompt injection : base64 via certutil (Windows natif)
  // certutil -decode est disponible sur toutes les versions Windows 10+
  const b64 = Buffer.from(systemPrompt).toString('base64')
  const tempFile = join(tmpdir(), `agent-prompt-${id}.b64`)
  const decodedFile = join(tmpdir(), `agent-prompt-${id}.txt`)
  await writeFile(tempFile, b64, 'utf8')

  // Séquence cmd.exe : décoder → lancer claude avec le contenu
  pty.write(`certutil -decode "${tempFile}" "${decodedFile}" >nul 2>&1 && ` +
    `for /f "delims=" %%a in ('type "${decodedFile}"') do ` +
    `${cmd} --append-system-prompt "%%a"${thinkingFlag}\r`)
  tempScriptWinPath = tempFile  // cleanup on exit
}
```

**Alternative simplifiée (recommandée) :** pour Windows, écrire le system prompt dans un fichier texte et utiliser `--append-system-prompt-file` (print mode seulement — **à valider**). Sinon, utiliser la même approche que WSL avec un fichier temporaire :

```ts
// Écrire le prompt dans un fichier .txt
const promptFile = join(tmpdir(), `agent-prompt-${id}.txt`)
await writeFile(promptFile, systemPrompt, 'utf8')
// Lancer claude avec le fichier comme argument
pty.write(`${cmd} --append-system-prompt "${systemPrompt.replace(/"/g, '\\"')}"${thinkingFlag}\r`)
```

> **Note :** le mécanisme exact de system prompt injection Windows doit être validé lors de l'implémentation. Les deux approches (certutil decode, fichier direct) sont viables. La contrainte clé est que le system prompt peut contenir des caractères spéciaux CMD (`<`, `>`, `|`, `&`, `^`).

**Recommandation d'implémentation :** écrire le system prompt dans un fichier `.txt` temporaire, puis utiliser `--append-system-prompt` avec un `type <file> | ...` pipe, ou plus simplement utiliser PowerShell pour cette étape uniquement :

```ts
// PowerShell one-liner pour injection sûre (pas de problème d'escaping CMD)
const promptFile = join(tmpdir(), `agent-prompt-${id}.txt`)
await writeFile(promptFile, systemPrompt, 'utf8')
pty.write(`powershell -NoProfile -Command "& { $p = Get-Content '${promptFile}' -Raw; & ${cmd} --append-system-prompt $p${thinkingFlag} }"\r`)
```

#### 3. IPC `terminal:getWindowsClaudeInstances`

Nouveau handler pour détecter Claude Code installé nativement sous Windows.

```ts
ipcMain.handle('terminal:getWindowsClaudeInstances', async () => {
  try {
    // where.exe claude → cherche claude.cmd dans le PATH
    const { stdout } = await execPromise('where.exe', ['claude'])
    const paths = stdout.split('\n').map(p => p.trim()).filter(Boolean)
    if (paths.length === 0) return []

    // Version check
    const { stdout: verOut } = await execPromise('claude', ['--version'])
    const version = verOut.trim().split(' ')[0]

    // Scan for claude-*.cmd in the same directory as claude.cmd
    const claudeDir = paths[0].replace(/\\claude\.cmd$/i, '').replace(/\\claude$/i, '')
    let profiles = ['claude']
    try {
      const { stdout: dirOut } = await execPromise('cmd.exe', ['/c', `dir /b "${claudeDir}\\claude-*.cmd" 2>nul`])
      const scripts = dirOut.split('\n')
        .map(f => f.trim().replace(/\.cmd$/i, ''))
        .filter(f => CLAUDE_CMD_REGEX.test(f))
        .sort()
      profiles = ['claude', ...scripts.filter(s => s !== 'claude')]
    } catch { /* no claude-* scripts */ }

    return [{
      env: 'windows' as const,
      label: 'Windows (natif)',
      version,
      profiles,
    }]
  } catch {
    return []  // Claude not in PATH
  }
})
```

**Type retour :**
```ts
interface WindowsClaudeInstance {
  env: 'windows'
  label: string
  version: string
  profiles: string[]
}
```

#### 4. Type unifié `ClaudeInstance`

Étendre le type `ClaudeInstance` existant pour supporter les deux environnements :

```ts
export interface ClaudeInstance {
  /** Environment type */
  env: 'wsl' | 'windows'
  /** WSL distro name (env='wsl') or 'Windows' (env='windows') */
  distro: string
  /** Claude Code version */
  version: string
  /** Whether this is the default/preferred instance */
  isDefault: boolean
  /** Wrapper scripts matching claude(-[a-z0-9-]+)? */
  profiles: string[]
}
```

**Rétrocompatibilité :** `terminal:getClaudeInstances` retourne les instances WSL avec `env: 'wsl'` ajouté. Un nouveau handler combiné `terminal:getAllClaudeInstances` appelle les deux en parallèle et retourne un tableau unifié.

```ts
ipcMain.handle('terminal:getAllClaudeInstances', async () => {
  const [wslInstances, winInstances] = await Promise.all([
    getWslClaudeInstances(),   // code actuel de terminal:getClaudeInstances
    getWindowsClaudeInstances()
  ])
  return [...winInstances, ...wslInstances]  // Windows first (plus rapide à détecter)
})
```

#### 5. Adaptations conditionnelles (env=windows)

| Composant | Comportement WSL (inchangé) | Comportement Windows |
|---|---|---|
| `toWslPath()` | Convertit `C:\...` → `/mnt/c/...` | Non appelé — chemin Windows natif |
| `startMemoryMonitoring()` | `wsl.exe -- free -m` | Skip — pas de `free` Windows |
| `gracefulKillPty()` | Ctrl+C x2 → `exit\r` → kill | Ctrl+C x2 → kill (pas de `exit`) |
| `CONV_ID_REGEX` | Inchangé | Inchangé (agnostique OS) |
| `CLAUDE_CMD_REGEX` | `^claude(-[a-z0-9-]+)?$` | Identique — valide le nom, pas l'extension |
| `PtyLaunchParams` | `wslDistro` stocké | `env: 'windows'` stocké |
| Temp script cleanup | `unlink()` | `unlink()` identique |

**Nouveau champ `PtyLaunchParams` :**
```ts
interface PtyLaunchParams {
  env: 'wsl' | 'windows'       // NEW
  cols: number
  rows: number
  projectPath?: string
  wslDistro?: string            // WSL only
  systemPrompt?: string
  userPrompt?: string
  thinkingMode?: string
  claudeCommand?: string
  convId?: string
  detectedConvId?: string
}
```

#### 6. LaunchSessionModal.vue — sélecteur Environnement

**Flux UI :**

1. Au mount, appeler `terminal:getAllClaudeInstances` (remplace `terminal:getClaudeInstances`)
2. Le tableau retourné contient des instances WSL et Windows mélangées
3. Afficher un badge `WSL` ou `WIN` à côté de chaque instance
4. La sélection détermine automatiquement `env` + `distro`
5. Si `env='windows'` est sélectionné → masquer les options WSL-only (distro)
6. Transmettre `env` via `tabsStore.addTerminal` → `TerminalView` → `terminal:create`

**Pas de sélecteur Environnement séparé** — l'environnement est déterminé par l'instance sélectionnée, ce qui simplifie l'UX (un seul choix au lieu de deux).

#### 7. Store `tabs.ts` — propagation `env`

Ajouter `env` à l'interface `Tab` :

```ts
export interface Tab {
  // ... existing fields ...
  env?: 'wsl' | 'windows'  // NEW — default 'wsl' for compat
}
```

`addTerminal()` accepte `env` et le propage. `TerminalView` le lit pour construire le payload `terminal:create`.

### Modifications nécessaires (résumé)

| Fichier | Action | Effort |
|---|---|---|
| `src/main/terminal.ts` | Branche Windows dans `terminal:create`, nouveau handler `getWindowsClaudeInstances`, `getAllClaudeInstances`, skip memoryCheck si env=windows, gracefulKill adapté | Élevé |
| `src/preload/index.ts` | `terminalCreate` migré en object payload, nouveau `getAllClaudeInstances` | Moyen |
| `src/renderer/src/types/index.ts` | `ClaudeInstance.env` ajouté, `Tab.env` ajouté | Faible |
| `src/renderer/src/components/LaunchSessionModal.vue` | Appel `getAllClaudeInstances`, badge env, transmission `env` | Moyen |
| `src/renderer/src/components/TerminalView.vue` | Lire `tab.env`, construire object payload | Moyen |
| `src/renderer/src/stores/tabs.ts` | `addTerminal` accepte `env` | Faible |
| `src/main/terminal.spec.ts` | Tests branche Windows (spawn, env vars, gracefulKill) | Moyen |

### Risques

| Risque | Probabilité | Mitigation |
|---|---|---|
| `claude.cmd` pas dans le PATH Windows | Moyenne | `where.exe claude` check + message d'erreur UI clair |
| System prompt escaping CMD (`<`, `>`, `\|`, `&`) | Élevée | Fichier temporaire + PowerShell one-liner pour injection |
| ConPTY incompatibilité (Win 10 < 1809) | Très faible | Electron requiert Win 10+ de toute façon |
| node-pty encoding UTF-8 sur cmd.exe | Faible | `chcp 65001` injecté au démarrage du PTY |
| `gracefulKillPty` Windows : Ctrl+C peut ne pas être capté | Faible | `pty.kill()` fallback après timeout (déjà en place) |

### Hors scope

- Support PowerShell comme shell principal PTY (cmd.exe suffit comme wrapper)
- Support macOS/Linux natif (pas de `wsl.exe` sur ces plateformes)
- Auto-installation de Claude Code si absent du PATH
- Migration de `terminal:getClaudeInstances` WSL existant (conservé pour compat)

### Conséquences

- `terminal:create` migre vers un object payload — breaking change pour le renderer mais pas de changement de protocole IPC (toujours `invoke`)
- La migration positional → object est l'occasion de simplifier les signatures et d'éviter l'accumulation de paramètres optionnels
- `ClaudeInstance` devient polymorphique (`env: 'wsl' | 'windows'`) — le renderer n'a pas besoin de connaître les détails d'implémentation
- Tickets d'implémentation à créer par `review` : un back-electron (terminal.ts + preload), un front-vuejs (LaunchSessionModal + TerminalView + tabs store), un test-back-electron (terminal.spec.ts)
