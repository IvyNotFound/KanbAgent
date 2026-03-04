# Workflow tickets — SQL complet

> Statuts : `todo` → `in_progress` → `done` → `archived` (rejeté → retour `todo`)
> Résumé rapide → `CLAUDE.md` · Input session → `sessions.summary`

---

## Schéma (project.db)

> **Consulter avant d'écrire du SQL.** Ne jamais deviner les noms de colonnes.

```
agents          (id PK, name, type, perimetre, system_prompt, system_prompt_suffix, thinking_mode, allowed_tools, created_at)
sessions        (id PK, agent_id→agents, started_at, ended_at, updated_at, statut CHECK(statut IN ('started','completed','blocked')), summary, claude_conv_id, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write)
tasks           (id PK, titre, description, statut, agent_createur_id→agents, agent_assigne_id→agents, agent_valideur_id→agents, parent_task_id→tasks, session_id→sessions, perimetre, effort, priority, created_at, updated_at, started_at, completed_at, validated_at)
task_comments   (id PK, task_id→tasks, agent_id→agents, contenu, created_at)
task_links      (id PK, from_task→tasks, to_task→tasks, type CHECK(type IN ('bloque','dépend_de','lié_à','duplique')), created_at)
locks           (id PK, fichier, agent_id→agents, session_id→sessions, created_at, released_at)
agent_logs      (id PK, session_id→sessions, agent_id→agents, niveau, action, detail, fichiers, created_at)
perimetres      (id PK, name, dossier, techno, description, actif, created_at)
config          (key PK, value, updated_at)
```

> **Pièges :** `tasks` n'a **pas** `agent_id` → utiliser `agent_assigne_id`. `task_comments.agent_id` (pas `auteur_agent_id`).

---

## Exécution

```bash
node scripts/dbq.js "<SQL>"   # lecture (sql.js + fs.readFile, bypass lock)
node scripts/dbw.js "<SQL>"   # écriture
```

> **⚠ SQL contenant backticks, `$()` ou quotes** : ne PAS passer en argument positionnel.
> Utiliser le **mode stdin (heredoc)** pour éviter que bash interprète les caractères spéciaux :
>
> ```bash
> node scripts/dbw.js <<'SQL'
> INSERT INTO tasks (titre, description, statut, agent_createur_id, perimetre, effort, priority)
> VALUES ('fix(terminal): mon titre', 'Description avec des backticks `code` et $(variables) et des quotes ''simples''', 'todo', (SELECT id FROM agents WHERE name = 'review'), 'back-electron', 1, 'normal');
> SQL
> ```
>
> Le heredoc `<<'SQL'` (quotes autour du délimiteur) désactive **toute** interprétation shell.
> Même syntaxe pour `dbq.js` en lecture.

---

## Primitives SQL réutilisables

```sql
-- Commenter un ticket
INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (:task_id, :agent_id, '<contenu>');

-- Locker un fichier (AVANT modification)
INSERT OR REPLACE INTO locks (fichier, agent_id, session_id) VALUES ('<fichier>', :agent_id, :session_id);

-- Libérer tous les locks
UPDATE locks SET released_at = CURRENT_TIMESTAMP WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;

-- Log (optionnel, omettre si contexte limité)
INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail) VALUES (:session_id, :agent_id, 'info', '<action>', '<detail>');
```

---

## Étapes

### 1. Review crée le ticket

```sql
INSERT INTO tasks (titre, description, statut, agent_createur_id, agent_assigne_id, perimetre)
VALUES ('<titre>', '<description complète : contexte, symptômes, critères acceptation>', 'todo',
  (SELECT id FROM agents WHERE name = '<review>'),
  (SELECT id FROM agents WHERE name = '<agent-cible>'), '<perimetre>');
-- + commentaire (risques, dépendances) via primitive
```

> Description max verbeuse — un agent sans contexte doit pouvoir réaliser le ticket seul.

### 2. L'agent démarre sa session

```bash
node scripts/dbstart.js <agent> [type] [perimetre]
```

> Fait tout en un appel : enregistre l'agent, crée la session, affiche `agent_id` + `session_id`, session précédente, tâches assignées, locks actifs.
> Tâches trouvées → commencer immédiatement. Questions seulement si aucune tâche ET type non inférable.

> **⚠ Limite sessions parallèles** : max 3 sessions actives par agent — enforcé par `dbstart.js` (exit code 2 si limite atteinte).

### 3. L'agent prend le ticket

```sql
SELECT titre, description FROM tasks WHERE id = :task_id;
SELECT tc.contenu, a.name, tc.created_at FROM task_comments tc
  JOIN agents a ON a.id = tc.agent_id WHERE tc.task_id = :task_id ORDER BY tc.created_at DESC LIMIT 5;
UPDATE tasks SET statut = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + lock fichiers via primitive
```

> Lock posé **avant** toute modification.

### 4. L'agent termine le ticket

> **⚠ Ordre obligatoire : commentaire EN PREMIER, puis `done`.**
> Si la session expire entre les deux appels, le commentaire est déjà persisté. Inverser l'ordre = risque de `done` sans commentaire (cf. T430, T437, T438).

```bash
# Recommandé : un seul heredoc pour réduire les turns nécessaires
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, contenu)
  VALUES (:task_id, :agent_id, 'fichiers:lignes · fait · choix · reste · à valider');
UPDATE tasks SET statut = 'done', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
SQL
# + libérer locks via primitive
```

> Après `done` → consulter backlog. Tâches restantes → **enchaîner sans fermer la session** (`/clear` + reset PTY, puis prendre la suivante). Ne fermer la session (étape 5) **que si** : aucune tâche restante, ou tâche bloquée (dépendance, lock, attente review).

### 5. L'agent termine sa session

```sql
-- 1. Enregistrer les tokens consommés (OBLIGATOIRE avant de clore)
--    Source : résumé affiché par Claude Code en fin de conversation
--    Ligne "Tokens: X in, Y cache_read, Z cache_write, W out"
UPDATE sessions SET tokens_in=X, tokens_out=Y, tokens_cache_read=Z, tokens_cache_write=W WHERE id=:session_id;

-- 2. Libérer locks via primitive
-- 3. Clore la session
UPDATE sessions SET statut = 'completed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
  summary = 'Done:<accompli>. Pending:<tickets>. Next:<action>.' WHERE id = :session_id;
```

> `summary` autosuffisant (max 200 chars) — un agent reprenant sans contexte doit savoir où il en est.
>
> **⚠ Tokens obligatoires** : noter les tokens AVANT de clore (`tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`). Les valeurs sont affichées par Claude Code à la fin de chaque conversation. Si la valeur est inconnue (session interrompue), mettre 0.
>
> **⚠ Locks obligatoires** : libérer **tous** les locks avant de terminer la session. `dbstart.js` libère automatiquement les locks orphelins des sessions terminées au démarrage, mais les agents doivent les libérer eux-mêmes en étape 5.

### 6. Review valide ou rejette

```sql
-- OK : archiver
UPDATE tasks SET statut = 'archived', agent_valideur_id = (SELECT id FROM agents WHERE name = '<review>'),
  validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + commentaire 'ARCHIVÉ — <observations>'

-- KO : rejeter
UPDATE tasks SET statut = 'todo', updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + commentaire 'REJETÉ — <motif précis, corrections attendues, critères re-validation>'
```
