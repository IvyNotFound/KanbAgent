# KanbAgent — Schéma de base de données (v6)

> Généré depuis le schéma SQLite v6. À mettre à jour après chaque migration majeure.

```mermaid
erDiagram
    agents {
        INTEGER id PK
        TEXT name
        TEXT type
        TEXT scope
        TEXT system_prompt
        TEXT system_prompt_suffix
        TEXT thinking_mode
        TEXT allowed_tools
        TEXT permission_mode
        INTEGER auto_launch
        INTEGER max_sessions
        INTEGER worktree_enabled
        DATETIME created_at
    }

    scopes {
        INTEGER id PK
        TEXT name
        TEXT folder
        TEXT techno
        TEXT description
        INTEGER active
        DATETIME created_at
    }

    sessions {
        INTEGER id PK
        INTEGER agent_id FK
        TEXT status
        TEXT summary
        TEXT claude_conv_id
        INTEGER tokens_in
        INTEGER tokens_out
        INTEGER tokens_cache_read
        INTEGER tokens_cache_write
        DATETIME started_at
        DATETIME ended_at
        DATETIME updated_at
    }

    tasks {
        INTEGER id PK
        TEXT title
        TEXT description
        TEXT status
        INTEGER agent_creator_id FK
        INTEGER agent_assigned_id FK
        INTEGER agent_validator_id FK
        INTEGER parent_task_id FK
        INTEGER session_id FK
        TEXT scope
        INTEGER effort
        TEXT priority
        DATETIME created_at
        DATETIME updated_at
        DATETIME started_at
        DATETIME completed_at
        DATETIME validated_at
    }

    task_comments {
        INTEGER id PK
        INTEGER task_id FK
        INTEGER agent_id FK
        TEXT content
        DATETIME created_at
    }

    task_agents {
        INTEGER id PK
        INTEGER task_id FK
        INTEGER agent_id FK
        TEXT role
        TEXT assigned_at
    }

    task_links {
        INTEGER id PK
        INTEGER from_task FK
        INTEGER to_task FK
        TEXT type
        DATETIME created_at
    }

    agent_groups {
        INTEGER id PK
        INTEGER parent_id FK
        TEXT name
        INTEGER sort_order
        TEXT created_at
    }

    agent_group_members {
        INTEGER id PK
        INTEGER group_id FK
        INTEGER agent_id FK
        INTEGER sort_order
    }

    agent_logs {
        INTEGER id PK
        INTEGER session_id FK
        INTEGER agent_id FK
        TEXT level
        TEXT action
        TEXT detail
        TEXT files
        DATETIME created_at
    }

    config {
        TEXT key PK
        TEXT value
        DATETIME updated_at
    }

    agents ||--o{ sessions : "runs"
    agents ||--o{ tasks : "creates (agent_creator_id)"
    agents ||--o{ tasks : "assigned (agent_assigned_id)"
    agents ||--o{ task_comments : "writes"
    agents ||--o{ task_agents : "participates"
    agents ||--o{ agent_logs : "emits"
    agents ||--o{ agent_group_members : "member of"

    sessions ||--o{ tasks : "linked to"
    sessions ||--o{ agent_logs : "contains"

    tasks ||--o{ task_comments : "has"
    tasks ||--o{ task_agents : "has"
    tasks ||--o{ task_links : "links from"
    tasks ||--o{ task_links : "links to"
    tasks ||--o{ tasks : "subtasks (parent_task_id)"

    agent_groups ||--o{ agent_group_members : "contains"
    agent_groups ||--o{ agent_groups : "hierarchy (parent_id)"
```

## Relations détaillées

| Table | Colonne FK | Référence | Contrainte |
|---|---|---|---|
| `sessions` | `agent_id` | `agents.id` | NOT NULL |
| `tasks` | `agent_creator_id` | `agents.id` | NOT NULL |
| `tasks` | `agent_assigned_id` | `agents.id` | NOT NULL |
| `tasks` | `agent_validator_id` | `agents.id` | nullable |
| `tasks` | `parent_task_id` | `tasks.id` | nullable (auto-référence) |
| `tasks` | `session_id` | `sessions.id` | nullable |
| `task_comments` | `task_id` | `tasks.id` | NOT NULL |
| `task_comments` | `agent_id` | `agents.id` | NOT NULL |
| `task_agents` | `task_id` | `tasks.id` | NOT NULL, CASCADE DELETE |
| `task_agents` | `agent_id` | `agents.id` | NOT NULL |
| `task_links` | `from_task` | `tasks.id` | NOT NULL |
| `task_links` | `to_task` | `tasks.id` | NOT NULL |
| `agent_logs` | `session_id` | `sessions.id` | NOT NULL |
| `agent_logs` | `agent_id` | `agents.id` | NOT NULL |
| `agent_group_members` | `group_id` | `agent_groups.id` | NOT NULL |
| `agent_group_members` | `agent_id` | `agents.id` | NOT NULL |
| `agent_groups` | `parent_id` | `agent_groups.id` | nullable (hiérarchie) |

## Index notables

| Index | Table | Colonnes |
|---|---|---|
| `idx_sessions_agent_id` | `sessions` | `agent_id` |
| `idx_sessions_started_at` | `sessions` | `started_at DESC` |
| `idx_sessions_agent_started` | `sessions` | `agent_id, started_at DESC` |
| `idx_sessions_status` | `sessions` | `status` |
| `idx_sessions_agent_status` | `sessions` | `agent_id, status, started_at DESC` |
| `idx_task_agents_task_id` | `task_agents` | `task_id` |
| `idx_task_agents_agent_id` | `task_agents` | `agent_id` |
| `idx_task_comments_task_id` | `task_comments` | `task_id` |
| `idx_task_comments_agent_id` | `task_comments` | `agent_id` |
| `idx_task_links_from_task` | `task_links` | `from_task` |
| `idx_task_links_to_task` | `task_links` | `to_task` |
| `idx_agm_group` | `agent_group_members` | `group_id` |

## Contraintes CHECK notables

| Table | Colonne | Valeurs autorisées |
|---|---|---|
| `tasks` | `status` | `todo`, `in_progress`, `done`, `archived` |
| `tasks` | `priority` | `low`, `normal`, `high`, `critical` |
| `tasks` | `effort` | `1`, `2`, `3` |
| `sessions` | `status` | `started`, `completed`, `blocked` |
| `agents` | `thinking_mode` | `auto`, `disabled` |
| `agents` | `permission_mode` | `default`, `auto` |
| `task_agents` | `role` | `primary`, `support`, `reviewer` |
| `task_links` | `type` | `blocks`, `depends_on`, `related_to`, `duplicates` |
| `agent_logs` | `level` | `info`, `warn`, `error`, `debug` |
