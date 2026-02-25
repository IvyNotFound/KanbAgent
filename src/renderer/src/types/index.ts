export interface Agent {
  id: number
  name: string
  type: string
  perimetre: string | null
  system_prompt: string | null
  system_prompt_suffix: string | null
  thinking_mode: 'auto' | 'disabled' | 'budget_tokens' | null
  allowed_tools: string | null
  created_at: string
  session_statut?: 'en_cours' | 'terminé' | 'bloqué' | null
  session_started_at?: string | null
  last_log_at?: string | null
}

export interface Task {
  id: number
  titre: string
  description: string | null
  commentaire: string | null
  statut: 'a_faire' | 'en_cours' | 'terminé' | 'archivé'
  agent_assigne_id: number | null
  agent_createur_id: number | null
  agent_name: string | null
  agent_createur_name: string | null
  agent_perimetre: string | null
  perimetre: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  effort: 1 | 2 | 3 | null
}

export interface TaskComment {
  id: number
  task_id: number
  agent_id: number | null
  agent_name: string | null
  contenu: string
  created_at: string
}

export interface Lock {
  id: number
  fichier: string
  agent_id: number
  agent_name: string
  session_id: number | null
  created_at: string
  released_at: string | null
}

export interface Stats {
  a_faire: number
  en_cours: number
  terminé: number
  archivé: number
}

export interface Perimetre {
  id: number
  name: string
  dossier: string | null
  techno: string | null
  description: string | null
  actif: number
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface AgentLog {
  id: number
  session_id: number
  agent_id: number
  agent_name: string | null
  agent_type: string | null
  niveau: 'info' | 'warn' | 'error' | 'debug'
  action: string
  detail: string | null
  fichiers: string | null
  created_at: string
}
