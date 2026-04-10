import type { MigrationDb } from '../migration-db-adapter'

/**
 * Migration v25: normalize all French column/table names to English (T1016).
 *
 * Renames French column names (titre→title, statut→status, etc.) and table
 * names (perimetres→scopes) to their English equivalents. Also rebuilds FTS
 * table and patches stored agent prompts.
 *
 * Idempotent: each rename is guarded by hasCol/hasTable checks.
 */
export function runI18nNormalizationMigration(db: MigrationDb): void {
  const hasCol = (table: string, col: string): boolean => {
    const r = db.exec(`PRAGMA table_info(${table})`)
    return r.length > 0 && r[0].values.some((row: unknown[]) => row[1] === col)
  }
  const hasTable = (name: string): boolean => {
    const r = db.exec(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${name}'`)
    return (r[0]?.values[0][0] as number) > 0
  }

  // agents.perimetre → scope
  if (hasCol('agents', 'perimetre')) db.run('ALTER TABLE agents RENAME COLUMN perimetre TO scope')

  // sessions.statut → status
  if (hasCol('sessions', 'statut')) db.run('ALTER TABLE sessions RENAME COLUMN statut TO status')

  // tasks: rename all French columns
  if (hasCol('tasks', 'titre'))             db.run('ALTER TABLE tasks RENAME COLUMN titre TO title')
  if (hasCol('tasks', 'statut'))            db.run('ALTER TABLE tasks RENAME COLUMN statut TO status')
  if (hasCol('tasks', 'agent_createur_id')) db.run('ALTER TABLE tasks RENAME COLUMN agent_createur_id TO agent_creator_id')
  if (hasCol('tasks', 'agent_assigne_id'))  db.run('ALTER TABLE tasks RENAME COLUMN agent_assigne_id TO agent_assigned_id')
  if (hasCol('tasks', 'agent_valideur_id')) db.run('ALTER TABLE tasks RENAME COLUMN agent_valideur_id TO agent_validator_id')
  if (hasCol('tasks', 'perimetre'))         db.run('ALTER TABLE tasks RENAME COLUMN perimetre TO scope')

  // task_comments.contenu → content
  if (hasCol('task_comments', 'contenu')) db.run('ALTER TABLE task_comments RENAME COLUMN contenu TO content')

  // task_links: recreate with English CHECK values (ALTER CONSTRAINT not supported in SQLite)
  const tlSchema = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='task_links'")
  if (tlSchema.length > 0 && tlSchema[0].values.length > 0) {
    const tlSql = tlSchema[0].values[0][0] as string
    if (tlSql.includes('bloque') || tlSql.includes('dépend_de')) {
      db.run(`CREATE TABLE task_links_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        from_task  INTEGER NOT NULL REFERENCES tasks(id),
        to_task    INTEGER NOT NULL REFERENCES tasks(id),
        type       TEXT NOT NULL CHECK(type IN ('blocks','depends_on','related_to','duplicates')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`)
      db.run(`INSERT INTO task_links_new (id, from_task, to_task, type, created_at)
        SELECT id, from_task, to_task,
          CASE type
            WHEN 'bloque'    THEN 'blocks'
            WHEN 'dépend_de' THEN 'depends_on'
            WHEN 'lié_à'     THEN 'related_to'
            WHEN 'duplique'  THEN 'duplicates'
            ELSE type
          END,
          created_at
        FROM task_links`)
      db.run('DROP TABLE task_links')
      db.run('ALTER TABLE task_links_new RENAME TO task_links')
      db.run('CREATE INDEX IF NOT EXISTS idx_task_links_from_task ON task_links(from_task)')
      db.run('CREATE INDEX IF NOT EXISTS idx_task_links_to_task ON task_links(to_task)')
    }
  }

  // locks.fichier → file
  if (hasCol('locks', 'fichier')) db.run('ALTER TABLE locks RENAME COLUMN fichier TO file')

  // agent_logs.niveau → level, agent_logs.fichiers → files
  if (hasCol('agent_logs', 'niveau'))   db.run('ALTER TABLE agent_logs RENAME COLUMN niveau TO level')
  if (hasCol('agent_logs', 'fichiers')) db.run('ALTER TABLE agent_logs RENAME COLUMN fichiers TO files')

  // perimetres columns + table rename → scopes
  if (hasTable('perimetres')) {
    if (hasCol('perimetres', 'dossier')) db.run('ALTER TABLE perimetres RENAME COLUMN dossier TO folder')
    if (hasCol('perimetres', 'actif'))   db.run('ALTER TABLE perimetres RENAME COLUMN actif TO active')
    if (!hasTable('scopes'))             db.run('ALTER TABLE perimetres RENAME TO scopes')
  }

  // Rebuild tasks_fts with new column name 'title' (was 'titre')
  db.run('DROP TRIGGER IF EXISTS tasks_fts_ai')
  db.run('DROP TRIGGER IF EXISTS tasks_fts_au')
  db.run('DROP TRIGGER IF EXISTS tasks_fts_ad')
  db.run('DROP TABLE IF EXISTS tasks_fts')
  db.run('CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts4(title, description)')
  db.run(`CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
  END`)
  db.run(`CREATE TRIGGER tasks_fts_au AFTER UPDATE ON tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.id;
    INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
  END`)
  db.run(`CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.id;
  END`)
  db.run('INSERT INTO tasks_fts(rowid, title, description) SELECT id, title, description FROM tasks')

  // Patch stored agent prompts: replace French column/table refs with English equivalents
  // system_prompt_suffix (shared suffix + scoped agent suffixes)
  db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'agent_id, contenu,', 'agent_id, content,') WHERE system_prompt_suffix IS NOT NULL")
  db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'agent_id, contenu)', 'agent_id, content)') WHERE system_prompt_suffix IS NOT NULL")
  db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'SET statut=''', 'SET status=''') WHERE system_prompt_suffix IS NOT NULL")
  db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, '(fichier, agent_id', '(file, agent_id') WHERE system_prompt_suffix IS NOT NULL")
  db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'statut, effort, perimetre', 'status, effort, scope') WHERE system_prompt_suffix IS NOT NULL")
  db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'agent_createur_id, agent_assigne_id, agent_valideur_id', 'agent_creator_id, agent_assigned_id, agent_validator_id') WHERE system_prompt_suffix IS NOT NULL")
  // system_prompt (dev agent locks line, task-creator INSERT/field names)
  db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '(fichier, agent_id, session_id)', '(file, agent_id, session_id)') WHERE system_prompt IS NOT NULL")
  db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '(titre, description, statut, agent_createur_id, agent_assigne_id, perimetre', '(title, description, status, agent_creator_id, agent_assigned_id, scope') WHERE system_prompt IS NOT NULL")
  db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- titre :', '- title :') WHERE system_prompt IS NOT NULL")
  db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- titre:', '- title:') WHERE system_prompt IS NOT NULL")
  db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- agent_assigne_id :', '- agent_assigned_id :') WHERE system_prompt IS NOT NULL")
  db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- agent_assigne_id:', '- agent_assigned_id:') WHERE system_prompt IS NOT NULL")
}
