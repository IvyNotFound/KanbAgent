/**
 * Generic project templates deployed on new project initialization.
 *
 * These strings are bundled at compile time and written to the project
 * directory by the `init-new-project` IPC handler — no network access required.
 */

/** Template content for `CLAUDE.md` written at the project root on initialization. */
export const CLAUDE_MD_TEMPLATE = `# CLAUDE.md — [project-name]

> Remplacer [project-name] par le nom du projet. État vivant → \`.claude/project.db\`. Refs → \`.claude/WORKFLOW.md\`

---

## Configuration

MODE: solo · LANG_CONV: français · LANG_CODE: english · Solo: \`review\` = \`review-master\`.

---

## Projet

**[project-name]** — Décrivez votre projet ici.

---

## Accès DB

\`node scripts/dbq.js "<SQL>"\` (lecture) · \`node scripts/dbw.js "<SQL>"\` (écriture)

SQL complexe → **heredoc obligatoire** :
\`\`\`
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content) VALUES (1, 2, 'texte');
SQL
\`\`\`
Démarrage session : \`node scripts/dbstart.js <agent-name>\`

---

## Workflow tickets

\`todo\` → \`in_progress\` → \`done\` → \`archived\` (rejeté → retour \`todo\`)

1. **review** crée ticket (titre + description + commentaire risques)
2. Agent démarre immédiatement sur ses tickets assignés
3. Agent écrit commentaire de sortie **EN PREMIER** · puis \`done\`
4. **review** archive ou rejette (\`todo\` + motif précis)

Voir \`.claude/WORKFLOW.md\` pour le protocole SQL complet.
`

/** Template content for `.claude/WORKFLOW.md` written on initialization. */
export const WORKFLOW_MD_TEMPLATE = `# Ticket Workflow — Full SQL Reference

> Statuses: \`todo\` → \`in_progress\` → \`done\` → \`archived\` (rejected → back to \`todo\`)
> Quick summary → \`CLAUDE.md\` · Session input → \`sessions.summary\`

---

## Schema (project.db)

> **Consult before writing SQL.** Never guess column names.

\`\`\`
agents          (id PK, name, type, scope, system_prompt, system_prompt_suffix, thinking_mode, allowed_tools, created_at)
sessions        (id PK, agent_id→agents, started_at, ended_at, updated_at, status CHECK(status IN ('started','completed','blocked')), summary, claude_conv_id, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write)
tasks           (id PK, title, description, status, agent_creator_id→agents, agent_assigned_id→agents, agent_validator_id→agents, parent_task_id→tasks, session_id→sessions, scope, effort, priority, created_at, updated_at, started_at, completed_at, validated_at)
task_comments   (id PK, task_id→tasks, agent_id→agents, content, created_at)
task_links      (id PK, from_task→tasks, to_task→tasks, type CHECK(type IN ('blocks','depends_on','related_to','duplicates')), created_at)
agent_logs      (id PK, session_id→sessions, agent_id→agents, level, action, detail, files, created_at)
scopes          (id PK, name, folder, techno, description, active, created_at)
config          (key PK, value, updated_at)
\`\`\`

> **Pitfalls:** \`tasks\` does **not** have \`agent_id\` → use \`agent_assigned_id\`. \`task_comments.agent_id\` (not \`auteur_agent_id\`).

---

## Execution

\`\`\`bash
node scripts/dbq.js "<SQL>"   # read (better-sqlite3, WAL mode)
node scripts/dbw.js "<SQL>"   # write
\`\`\`

> **⚠ SQL containing backticks, \`$()\` or quotes**: use **stdin mode (heredoc)**:
>
> \`\`\`bash
> node scripts/dbw.js <<'SQL'
> INSERT INTO tasks (title, description, status, agent_creator_id, scope, effort, priority)
> VALUES ('fix: my title', 'Description with backticks', 'todo', 1, 'global', 1, 'normal');
> SQL
> \`\`\`

---

## Reusable SQL Primitives

\`\`\`sql
-- Add a comment to a ticket
INSERT INTO task_comments (task_id, agent_id, content) VALUES (:task_id, :agent_id, '<content>');

-- Log (optional)
INSERT INTO agent_logs (session_id, agent_id, level, action, detail) VALUES (:session_id, :agent_id, 'info', '<action>', '<detail>');
\`\`\`

---

## Status transitions

\`\`\`sql
-- Start task
UPDATE tasks SET status='in_progress', started_at=CURRENT_TIMESTAMP WHERE id=:id;

-- Complete task
UPDATE tasks SET status='done', completed_at=CURRENT_TIMESTAMP WHERE id=:id;

-- Archive task
UPDATE tasks SET status='archived' WHERE id=:id;
\`\`\`

---

## Session lifecycle

\`\`\`sql
-- Start session
INSERT INTO sessions (agent_id, status) VALUES (:agent_id, 'started');

-- Close session
UPDATE sessions SET status='completed', ended_at=CURRENT_TIMESTAMP, summary=:summary WHERE id=:session_id;
\`\`\`
`
