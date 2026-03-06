/**
 * Seed script: inserts demo data into .claude/project.db.
 *
 * Creates sample agents, sessions, tasks, and locks for local development.
 * Intended for development/testing only — not executed at runtime.
 *
 * @example
 * ```bash
 * npx tsx src/main/seed.ts .claude/project.db
 * ```
 *
 * @module seed
 */
import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

async function main() {
  const dbPath = process.argv[2] ?? join(process.cwd(), '.claude/project.db')
  const SQL = await initSqlJs()
  const buffer = readFileSync(dbPath)
  const db = new SQL.Database(buffer)

  db.run(`
INSERT OR IGNORE INTO agents (name, type, scope) VALUES
  ('dev-front-vuejs', 'dev', 'front-vuejs'),
  ('dev-back-electron', 'dev', 'back-electron'),
  ('review', 'review', NULL),
  ('git', 'git', NULL);

INSERT INTO sessions (agent_id, status) VALUES
  ((SELECT id FROM agents WHERE name = 'dev-front-vuejs'), 'started'),
  ((SELECT id FROM agents WHERE name = 'dev-back-electron'), 'completed');

UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, summary = 'Done: IPC handlers. Next: renderer store.'
WHERE agent_id = (SELECT id FROM agents WHERE name = 'dev-back-electron') AND status = 'completed';

INSERT INTO tasks (title, description, status, agent_creator_id, agent_assigned_id, scope) VALUES
  ('Setup Electron + Vite config', 'Configurer electron-vite, tsconfig, tailwind', 'archived',
    (SELECT id FROM agents WHERE name = 'dev-back-electron'),
    (SELECT id FROM agents WHERE name = 'dev-back-electron'), 'back-electron'),
  ('IPC handlers better-sqlite3', 'query-db, select-db-file, window controls', 'done',
    (SELECT id FROM agents WHERE name = 'dev-back-electron'),
    (SELECT id FROM agents WHERE name = 'dev-back-electron'), 'back-electron'),
  ('Composant BoardView', 'Board Trello 4 colonnes status', 'in_progress',
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'), 'front-vuejs'),
  ('Composant TaskCard', 'Carte tâche avec badges agent et périmètre', 'in_progress',
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'), 'front-vuejs'),
  ('Store Pinia + polling', 'Auto-refresh toutes les 5s', 'todo',
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'), 'front-vuejs'),
  ('Dark mode Tailwind', 'Palette zinc + violet, classe dark permanente', 'todo',
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'),
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'), 'front-vuejs');

INSERT INTO locks (file, agent_id) VALUES
  ('src/renderer/src/components/BoardView.vue',
    (SELECT id FROM agents WHERE name = 'dev-front-vuejs'));
`)

  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
  console.log('Seed OK —', dbPath)
  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
