/**
 * Generic project templates deployed on new project initialization.
 *
 * These strings are bundled at compile time and written to the project
 * directory by the `init-new-project` IPC handler — no network access required.
 *
 * ADR-012: CLI-agnostic — no reference to a specific CLI, framework, or stack.
 */

import type { AgentLanguage } from './default-agents'

// ── Project rules (CLAUDE.md / GEMINI.md / .codex/instructions.md) ──────────

interface ProjectRulesStrings {
  replaceProjectName: string
  replaceDescription: string
  readOnly: string
  configuration: string
  mode: string
  langConv: string
  langCode: string
  project: string
  describeProject: string
  dbAccess: string
  read: string
  write: string
  complexSql: string
  heredocRequired: string
  sessionStart: string
  ticketWorkflow: string
  ticketFlow: string
  step1: string
  step2: string
  step3: string
  step4: string
  seeWorkflow: string
  agents: string
  agentList: string
  agentAutonomy: string
  autonomyDesc: string
}

const STRINGS_EN: ProjectRulesStrings = {
  replaceProjectName: 'Replace [project-name] with the project name.',
  replaceDescription: '[Short project description.]',
  readOnly: 'Read-only except `setup` (init). Living state → `.claude/project.db`. Refs → `.claude/WORKFLOW.md`',
  configuration: 'Configuration',
  mode: 'MODE: solo',
  langConv: 'LANG_CONV: english',
  langCode: 'LANG_CODE: english',
  project: 'Project',
  describeProject: 'Describe your project here.',
  dbAccess: 'DB Access',
  read: 'read',
  write: 'write',
  complexSql: 'Complex SQL',
  heredocRequired: 'heredoc required',
  sessionStart: 'Session start',
  ticketWorkflow: 'Ticket Workflow',
  ticketFlow: 'Statuses',
  step1: '**review** creates ticket (title + description + risk comment)',
  step2: 'Agent starts immediately on assigned tickets',
  step3: 'Agent writes exit comment **FIRST** · then `done`',
  step4: '**review** archives or rejects (`todo` + precise reason)',
  seeWorkflow: 'See `.claude/WORKFLOW.md` for the full SQL protocol.',
  agents: 'Agents',
  agentList: 'Generic agents: **dev** (development) · **review** (code review) · **test** (testing) · **doc** (documentation) · **task-creator** (ticket creation)',
  agentAutonomy: 'Agent Autonomy',
  autonomyDesc: 'On startup, if `project.db` contains assigned `todo`or `in_progress` tasks → start immediately on **one task only**. After a task: STOP — close the session. One session = one task.',
}

const STRINGS_FR: ProjectRulesStrings = {
  replaceProjectName: 'Remplacer [project-name] par le nom du projet.',
  replaceDescription: '[Description courte du projet.]',
  readOnly: 'Lecture seule sauf `setup` (init). État vivant → `.claude/project.db`. Refs → `.claude/WORKFLOW.md`',
  configuration: 'Configuration',
  mode: 'MODE: solo',
  langConv: 'LANG_CONV: français',
  langCode: 'LANG_CODE: english',
  project: 'Projet',
  describeProject: 'Décrivez votre projet ici.',
  dbAccess: 'Accès DB',
  read: 'lecture',
  write: 'écriture',
  complexSql: 'SQL complexe',
  heredocRequired: 'heredoc obligatoire',
  sessionStart: 'Démarrage session',
  ticketWorkflow: 'Workflow tickets',
  ticketFlow: 'Statuts',
  step1: '**review** crée ticket (titre + description + commentaire risques)',
  step2: 'Agent démarre immédiatement sur ses tickets assignés',
  step3: 'Agent écrit commentaire de sortie **EN PREMIER** · puis `done`',
  step4: '**review** archive ou rejette (`todo` + motif précis)',
  seeWorkflow: 'Voir `.claude/WORKFLOW.md` pour le protocole SQL complet.',
  agents: 'Agents',
  agentList: 'Agents génériques : **dev** (développement) · **review** (revue de code) · **test** (tests) · **doc** (documentation) · **task-creator** (création de tickets)',
  agentAutonomy: 'Autonomie des agents',
  autonomyDesc: 'Au démarrage, si `project.db` contient des tâches assignées `todo` ou `in_progress` → démarrer immédiatement sur **une seule tâche**. Après une tâche : STOP — fermer la session. Une session = une tâche.',
}

const LANG_STRINGS: Record<string, ProjectRulesStrings> = {
  en: STRINGS_EN,
  fr: STRINGS_FR,
}

/**
 * Returns CLI-agnostic project rules content.
 * No reference to any specific CLI, framework, or tech stack.
 * Lists only the 5 generic agents (dev, review, test, doc, task-creator).
 *
 * @param lang - Agent language. Defaults to 'en'. Only 'fr' and 'en' produce
 *               localised content; all other values fall back to English.
 */
export function getProjectRules(lang: AgentLanguage = 'en'): string {
  const s = LANG_STRINGS[lang] ?? STRINGS_EN
  return `# CLAUDE.md — [project-name]

> ${s.replaceProjectName} ${s.readOnly}

---

## ${s.configuration}

${s.mode} · ${s.langConv} · ${s.langCode}

---

## ${s.project}

**[project-name]** — ${s.describeProject}

---

## ${s.agents}

${s.agentList}

---

## ${s.dbAccess}

\`node scripts/dbq.js "<SQL>"\` (${s.read}) · \`node scripts/dbw.js "<SQL>"\` (${s.write})

${s.complexSql} → **${s.heredocRequired}** :
\`\`\`
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content) VALUES (1, 2, 'text');
SQL
\`\`\`
${s.sessionStart} : \`node scripts/dbstart.js <agent-name>\`

---

## ${s.ticketWorkflow}

${s.ticketFlow} : \`todo\` → \`in_progress\` → \`done\` → \`archived\` (rejected → \`todo\`)

1. ${s.step1}
2. ${s.step2}
3. ${s.step3}
4. ${s.step4}

${s.seeWorkflow}

---

## ${s.agentAutonomy}

${s.autonomyDesc}
`
}

/**
 * Backward-compatible alias — returns English project rules.
 * @deprecated Use `getProjectRules(lang)` instead.
 */
export const CLAUDE_MD_TEMPLATE = getProjectRules('en')

// ── WORKFLOW.md template ────────────────────────────────────────────────────────

/** Template content for \`.claude/WORKFLOW.md\` written on initialization. */
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
locks           (id PK, file, agent_id→agents, session_id→sessions, created_at, released_at)
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

> **⚠ SQL containing backticks, \`$()\` or quotes**: do NOT pass as a positional argument.
> Use **stdin mode (heredoc)** to prevent bash from interpreting special characters:
>
> \`\`\`bash
> node scripts/dbw.js <<'SQL'
> INSERT INTO tasks (title, description, status, agent_creator_id, scope, effort, priority)
> VALUES ('fix: my title', 'Description with backticks \\\`code\\\` and $(variables)', 'todo', 1, 'global', 1, 'normal');
> SQL
> \`\`\`
>
> The \`<<'SQL'\` heredoc (quotes around delimiter) disables **all** shell interpretation.

---

## Reusable SQL Primitives

\`\`\`sql
-- Add a comment to a ticket
INSERT INTO task_comments (task_id, agent_id, content) VALUES (:task_id, :agent_id, '<content>');

-- Lock a file (BEFORE modification)
INSERT OR REPLACE INTO locks (file, agent_id, session_id) VALUES ('<file>', :agent_id, :session_id);

-- Release all locks
UPDATE locks SET released_at = CURRENT_TIMESTAMP WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;

-- Log (optional)
INSERT INTO agent_logs (session_id, agent_id, level, action, detail) VALUES (:session_id, :agent_id, 'info', '<action>', '<detail>');
\`\`\`

---

## Steps

### 1. Review creates the ticket

\`\`\`sql
INSERT INTO tasks (title, description, status, agent_creator_id, agent_assigned_id, scope)
VALUES ('<title>', '<full description>', 'todo',
  (SELECT id FROM agents WHERE name = '<review>'),
  (SELECT id FROM agents WHERE name = '<target-agent>'), '<scope>');
-- + comment (risks, dependencies) via primitive
\`\`\`

### 2. Agent starts their session

\`\`\`bash
node scripts/dbstart.js <agent> [type] [scope]
\`\`\`

> Does everything in one call: registers the agent, creates the session, displays \`agent_id\` + \`session_id\`, previous session, assigned tasks, active locks.

### 3. Agent takes the ticket

\`\`\`sql
SELECT title, description FROM tasks WHERE id = :task_id;
SELECT tc.content, a.name, tc.created_at FROM task_comments tc
  JOIN agents a ON a.id = tc.agent_id WHERE tc.task_id = :task_id ORDER BY tc.created_at DESC LIMIT 5;
UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + lock files via primitive
\`\`\`

### 4. Agent completes the ticket

> **⚠ Mandatory order: comment FIRST, then \`done\`.**
> If the session expires between the two calls, the comment is already persisted. Reversing the order risks \`done\` with no comment.

\`\`\`bash
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, content)
  VALUES (:task_id, :agent_id, 'files:lines · done · choices · remaining · to validate');
UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
SQL
\`\`\`

### 5. Agent closes their session

\`\`\`sql
-- 1. Record consumed tokens (REQUIRED before closing)
UPDATE sessions SET tokens_in=X, tokens_out=Y, tokens_cache_read=Z, tokens_cache_write=W WHERE id=:session_id;

-- 2. Release locks via primitive
UPDATE locks SET released_at = CURRENT_TIMESTAMP WHERE agent_id = :agent_id AND session_id = :session_id AND released_at IS NULL;

-- 3. Close the session
UPDATE sessions SET status = 'completed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
  summary = 'Done:<accomplished>. Pending:<tickets>. Next:<action>.' WHERE id = :session_id;
\`\`\`

> \`summary\` must be self-contained (max 200 chars).
> **⚠ Tokens required**: record tokens BEFORE closing (\`tokens_in\`, \`tokens_out\`, \`tokens_cache_read\`, \`tokens_cache_write\`). If unknown, set to 0.

### 6. Review validates or rejects

\`\`\`sql
-- OK: archive
UPDATE tasks SET status = 'archived', agent_validator_id = (SELECT id FROM agents WHERE name = '<review>'),
  validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + comment 'ARCHIVED — <observations>'

-- KO: reject
UPDATE tasks SET status = 'todo', updated_at = CURRENT_TIMESTAMP WHERE id = :task_id;
-- + comment 'REJECTED — <precise reason, expected corrections>'
\`\`\`

---

## Git Worktrees

When a worktree is active (\`WORKTREE_PATH\` is set or working directory is inside \`.claude/worktrees/\`):

- **Source code** → work exclusively from the worktree directory
- **DB scripts** (\`scripts/dbq.js\`, \`scripts/dbw.js\`, \`scripts/dbstart.js\`) → always run from the **main repo** root
- Before closing the session: \`git add -A && git commit\` in the worktree
- Do **not** push — review merges the worktree branch to main after validation
- Never modify source files from the main repo when a worktree is active
`
