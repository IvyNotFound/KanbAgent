---
name: feature-planning
description: Break down feature requests into detailed, implementable plans with clear tasks. Activates when user requests a new feature, enhancement, or complex change requiring planning. Use when user says things like "add X", "implement Y", "I want Z functionality", "plan how to build X".
---

# Feature Planning Skill

Decompose feature requests into structured, actionable implementation plans tailored to the agent-viewer stack (Electron + Vue 3 + TypeScript + SQLite).

## When to Use

- User requests a new feature or enhancement
- User describes desired functionality without a clear implementation path
- Complex changes touching multiple layers (main process, renderer, DB, IPC)
- User says "plan", "design", "how should I implement", "break down"

## Process

### 1. Clarify Before Planning
Ask targeted questions to remove ambiguity:
- Scope: which layer is affected? (Electron main / Vue renderer / SQLite / IPC)
- UI needed? (Kanban view, panel, modal, sidebar)
- Does it touch the agent orchestration logic or just the viewer?
- Any existing patterns to follow in the codebase?

### 2. Explore the Codebase
Before writing the plan:
- Check existing component structure in `src/renderer`
- Check IPC handlers in `src/main`
- Check DB schema in `src/db` or equivalent
- Identify reusable patterns (stores, composables, services)

### 3. Generate the Plan
Structure the plan as discrete, ordered tasks:

```
## Feature: [Name]

### Context
[What exists, what changes, why]

### Tasks
- [ ] Task 1: [concrete action] — [file/layer affected]
- [ ] Task 2: ...
- [ ] Task N: ...

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Risks / Notes
- [Any gotcha or dependency to watch]
```

### 4. Review with User
Present the plan and confirm before any implementation begins.

## Stack Conventions
- Vue 3 Composition API + `<script setup>`
- TypeScript strict mode
- Pinia for state management
- SQLite via better-sqlite3 (sync API)
- IPC: use typed channels, never raw strings
- Conventional commits for all git operations
