---
name: git-pushing
description: Automatically stage, commit with conventional commit messages, and push changes. Activates when user mentions pushing, committing, saving to remote, or says things like "push these changes", "commit and push", "let's save this", "ship it".
---

# Git Pushing Skill

Handle git operations with conventional commit messages, following the agent-viewer project standards.

## When to Use

- User says "push", "commit", "save to git/github/remote"
- After completing a feature or bugfix
- User says "ship it", "let's save this work", "commit that"

## Process

### 1. Assess What Changed
```bash
git status
git diff --stat
```

### 2. Group Changes Logically
If changes span multiple concerns, split into separate commits:
- DB schema changes → separate commit
- UI changes → separate commit  
- IPC/main process → separate commit
- Config/tooling → separate commit

### 3. Conventional Commit Format
```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

**Types:**
- `feat`: new feature
- `fix`: bug fix
- `refactor`: code change without feature/fix
- `style`: formatting, no logic change
- `test`: adding/fixing tests
- `docs`: documentation
- `chore`: build, config, deps
- `perf`: performance improvement

**Scopes for agent-viewer:**
- `kanban`: Kanban board UI
- `agents`: agent orchestration logic
- `db`: SQLite schema or queries
- `ipc`: Electron IPC channels
- `ui`: general UI components
- `electron`: main process
- `store`: Pinia stores

**Examples:**
```
feat(kanban): add drag-and-drop between columns
fix(db): correct agent status migration on startup
refactor(ipc): type all channel names as const enum
chore(deps): upgrade electron to v32
```

### 4. Execute
```bash
git add <files>
git commit -m "<conventional message>"
git push origin <current-branch>
```

### 5. Confirm
Report what was committed and pushed, with the commit hash.

## Rules
- Never `git add .` blindly — always review `git status` first
- Never force push to `main`
- If on `main` with unreviewed changes, suggest creating a branch first
- If tests exist, remind user to run them before pushing
