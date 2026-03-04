#!/usr/bin/env node
/**
 * init-project.js — Bootstrap complet d'un nouveau projet agent-viewer
 *
 * Usage: node scripts/init-project.js [/path/to/project.db]
 *        (défaut : .claude/project.db)
 *
 * Ce que le script fait :
 *   1. Crée la base SQLite avec le schéma complet (toutes les tables)
 *   2. Insère les agents avec leurs system_prompt complets (depuis agents-data.json)
 *   3. Insère les périmètres (front-vuejs, back-electron, global)
 *   4. Insère la config initiale (schema_version, claude_md_commit)
 *   5. Copie les fichiers template dans le répertoire cible
 *
 * Prérequis : npm install (sql.js disponible)
 * Note : utilise sql.js (async) — better-sqlite3 non installé dans ce projet
 * Exit 0 : succès | Exit 1 : erreur
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

// ─── Agents (depuis agents-data.json — copie exacte de la DB post-cleanup) ───

const AGENTS = require('./agents-data.json')

// ─── Périmètres ───────────────────────────────────────────────────────────────

const PERIMETRES = [
  { name: 'front-vuejs', dossier: 'renderer/', techno: 'Vue 3 + TypeScript + Tailwind CSS', description: 'Interface utilisateur Electron', actif: 1 },
  { name: 'back-electron', dossier: 'main/', techno: 'Electron + Node.js + SQLite', description: 'Process principal, IPC, accès DB', actif: 1 },
  { name: 'global', dossier: '', techno: '—', description: 'Transversal, aucun périmètre spécifique', actif: 1 },
]

// ─── Config initiale ──────────────────────────────────────────────────────────

const CONFIG = [
  { key: 'schema_version', value: '7' },
  { key: 'claude_md_commit', value: '' },
]

// ─── Schéma SQL ───────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT,
  perimetre TEXT,
  system_prompt TEXT,
  system_prompt_suffix TEXT,
  thinking_mode TEXT,
  allowed_tools TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER REFERENCES agents(id),
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  statut TEXT DEFAULT 'started' CHECK(statut IN ('started','completed','blocked')),
  summary TEXT,
  claude_conv_id TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  tokens_cache_read INTEGER,
  tokens_cache_write INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  description TEXT,
  statut TEXT DEFAULT 'todo',
  agent_createur_id INTEGER REFERENCES agents(id),
  agent_assigne_id INTEGER REFERENCES agents(id),
  agent_valideur_id INTEGER REFERENCES agents(id),
  parent_task_id INTEGER REFERENCES tasks(id),
  session_id INTEGER REFERENCES sessions(id),
  perimetre TEXT,
  effort INTEGER CHECK(effort IN (1,2,3)),
  priority TEXT DEFAULT 'normal',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  validated_at TEXT
);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  agent_id INTEGER REFERENCES agents(id),
  contenu TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_task INTEGER REFERENCES tasks(id),
  to_task INTEGER REFERENCES tasks(id),
  type TEXT CHECK(type IN ('bloque','dépend_de','lié_à','duplique')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fichier TEXT,
  agent_id INTEGER REFERENCES agents(id),
  session_id INTEGER REFERENCES sessions(id),
  created_at TEXT DEFAULT (datetime('now')),
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id),
  agent_id INTEGER REFERENCES agents(id),
  niveau TEXT,
  action TEXT,
  detail TEXT,
  fichiers TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS perimetres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  dossier TEXT,
  techno TEXT,
  description TEXT,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  agent_id INTEGER REFERENCES agents(id),
  role TEXT CHECK(role IN ('primary','support','reviewer')),
  assigned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(task_id, agent_id)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`\nERREUR: ${msg}`)
  process.exit(1)
}

function log(msg) {
  console.log(`    ${msg}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const dbPath = path.resolve(process.cwd(), process.argv[2] || '.claude/project.db')
const targetDir = path.dirname(dbPath)

console.log(`\nagent-viewer — init-project.js`)
console.log(`Cible DB  : ${dbPath}`)
console.log(`Cible dir : ${targetDir}`)

// Guard : abort si la DB existe déjà
if (fs.existsSync(dbPath)) {
  die(
    `La base de données existe déjà : ${dbPath}\n` +
    `Supprimez-la manuellement si vous souhaitez réinitialiser le projet.`
  )
}

// Créer le répertoire cible si nécessaire
fs.mkdirSync(targetDir, { recursive: true })

initSqlJs().then((SQL) => {
  // Créer une nouvelle DB vide
  const db = new SQL.Database()

  // ── 1. Schéma ──────────────────────────────────────────────────────────────
  console.log('\n[1/5] Création du schéma...')
  db.run(SCHEMA_SQL)
  const schemaVersion = CONFIG.find(c => c.key === 'schema_version').value
  log(`Tables créées (schéma v${schemaVersion})`)

  // ── 2. Agents ──────────────────────────────────────────────────────────────
  console.log('\n[2/5] Insertion des agents...')
  const stmtAgent = db.prepare(`
    INSERT INTO agents (id, name, type, perimetre, system_prompt, system_prompt_suffix, thinking_mode, allowed_tools)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const a of AGENTS) {
    stmtAgent.run([
      a.id,
      a.name,
      a.type ?? null,
      a.perimetre ?? null,
      a.system_prompt ?? null,
      a.system_prompt_suffix ?? null,
      a.thinking_mode ?? null,
      a.allowed_tools ?? null,
    ])
    log(`Agent ${String(a.id).padStart(3)}: ${a.name} (${a.type ?? '-'})`)
  }
  stmtAgent.free()

  // ── 3. Périmètres ──────────────────────────────────────────────────────────
  console.log('\n[3/5] Insertion des périmètres...')
  const stmtPeri = db.prepare(`
    INSERT INTO perimetres (name, dossier, techno, description, actif)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const p of PERIMETRES) {
    stmtPeri.run([p.name, p.dossier, p.techno, p.description, p.actif])
    log(`Périmètre: ${p.name}`)
  }
  stmtPeri.free()

  // ── 4. Config ──────────────────────────────────────────────────────────────
  console.log('\n[4/5] Insertion de la config initiale...')
  const stmtConfig = db.prepare(`INSERT INTO config (key, value) VALUES (?, ?)`)
  for (const c of CONFIG) {
    stmtConfig.run([c.key, c.value])
    log(`config.${c.key} = '${c.value}'`)
  }
  stmtConfig.free()

  // Persister la DB sur disque
  const dbBuf = Buffer.from(db.export())
  fs.writeFileSync(dbPath, dbBuf)
  db.close()
  log(`DB persistée : ${dbBuf.length} octets`)

  // ── 5. Templates ───────────────────────────────────────────────────────────
  console.log('\n[5/5] Copie des fichiers template...')
  const templatesDir = path.resolve(__dirname, 'templates')

  // Les 3 fichiers .claude/ vont dans targetDir (ex: /path/to/.claude/)
  // CLAUDE.md va dans le répertoire parent de targetDir (racine du projet)
  const projectRoot = path.dirname(targetDir)
  const templates = [
    { src: 'ADRS.md',    dest: path.join(targetDir, 'ADRS.md') },
    { src: 'WORKFLOW.md', dest: path.join(targetDir, 'WORKFLOW.md') },
    { src: 'RELEASE.md', dest: path.join(targetDir, 'RELEASE.md') },
    { src: 'CLAUDE.md',  dest: path.join(projectRoot, 'CLAUDE.md') },
  ]

  for (const tpl of templates) {
    const srcPath = path.join(templatesDir, tpl.src)
    if (!fs.existsSync(srcPath)) {
      console.warn(`    AVERTISSEMENT: template manquant : ${srcPath}`)
      continue
    }
    if (fs.existsSync(tpl.dest)) {
      log(`SKIP (existe déjà) : ${path.relative(process.cwd(), tpl.dest)}`)
    } else {
      fs.copyFileSync(srcPath, tpl.dest)
      log(`Copié : ${tpl.src} → ${path.relative(process.cwd(), tpl.dest)}`)
    }
  }

  console.log('\n✓ Initialisation terminée.')
  console.log('\nProchaines étapes :')
  console.log(`  1. Personnaliser CLAUDE.md (nom du projet, stack, lead)`)
  console.log(`  2. node scripts/dbstart.js setup`)
  console.log(`  3. node scripts/dbstart.js arch  (pour créer les premières ADRs)`)
  process.exit(0)
}).catch((err) => {
  die(`Erreur sql.js : ${err.message}\n${err.stack}`)
})
