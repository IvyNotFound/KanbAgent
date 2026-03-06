---
name: release-checklist
description: Execute a release in agent-viewer following the full devops + review protocol. Activates when agent devops receives a release ticket, when user says "release", "publier la version", "bump version", "npm run release". Covers prérequis, version bump, CI wait, GitHub Release publication.
---

# Release Checklist Skill

Step-by-step release process for agent-viewer, extracted from devops and review system prompts.

## Who Uses This

- Agent `devops` — executes the release
- Agent `review` — creates the release ticket and verifies post-release

## Release Ticket Context

Review creates the release ticket with:
- Title: `release: bump version X.Y.Z — T<ids>`
- `agent_assigne_id` = devops
- `agent_valideur_id` = review
- Listed tickets archived since last release
- Linked to a `doc` ticket (type `bloque`)

## Version Decision (review's job, before creating ticket)

| Commits since last release | Version bump |
|---|---|
| `fix`, `chore`, `refactor` only | **patch** (0.X.Y → 0.X.Y+1) |
| At least one `feat` | **minor** (0.X.Y → 0.X+1.0) |
| Breaking change or arch validation | **major** — requires human confirmation (IvyNotFound) |

## Step 1 — Prérequis (devops checks before anything)

```bash
# 1. Must be on main, clean working tree
git status
git branch --show-current

# 2. Zero todo/in_progress tickets
node scripts/dbq.js "SELECT COUNT(*) FROM tasks WHERE statut IN ('todo', 'in_progress')"

# 3. Build must pass
npm run build
```

> ⚠ If any prérequis fails → stop, comment the ticket, set statut=blocked.
> Never release with open tickets or a broken build.

## Step 2 — Version Bump

```bash
# patch (fix, chore only)
npm run release:patch

# minor (at least one feat)
npm run release:minor

# major (breaking change) — NEVER without explicit human confirmation from IvyNotFound
npm run release:major
```

This automatically: bumps version in package.json → updates CHANGELOG → commits + tag → pushes.

## Step 3 — Wait for CI

```bash
gh run watch $(gh run list --workflow=release.yml --limit=1 --json databaseId -q '.[0].databaseId')
```

Wait for it to complete successfully before going further.

## Step 4 — Verify GitHub Release Notes

```bash
# Check that release notes were auto-injected by CI
gh release view vX.Y.Z
```

If notes are **absent or empty**, inject manually:
```bash
gh release edit vX.Y.Z --notes-file <(awk "/^## \[VERSION\]/{f=1;next} f && /^## \[/{exit} f{print}" CHANGELOG.md)
```

Replace `VERSION` with the actual version number (e.g., `0.25.0`).

## Step 5 — Publish the Draft

```bash
gh release edit vX.Y.Z --draft=false
```

## Step 6 — Close the Ticket

```bash
node scripts/dbw.js <<'SQL'
INSERT INTO task_comments (task_id, agent_id, contenu)
  VALUES (<task_id>, <agent_id>, 'Released vX.Y.Z — CI passed — draft published');
UPDATE tasks SET statut='done', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=<task_id>;
SQL
```

## Step 7 — Close the Session

```bash
node scripts/dbw.js <<'SQL'
UPDATE sessions SET tokens_in=X, tokens_out=Y, tokens_cache_read=Z, tokens_cache_write=W,
  statut='completed', ended_at=datetime('now'),
  summary='Done:release vX.Y.Z. CI passed. Draft published.'
WHERE id=<session_id>;
SQL
```

## Hard Rules (from devops system prompt)

- **MAJOR bump**: explicit confirmation from IvyNotFound mandatory — never decide alone
- Never `--no-verify` or `--no-gpg-sign` without explicit lead request
- Never release with `todo` or `in_progress` tickets open
- Never release from a branch other than `main`
- Staged file by file — never `git add -A` without inspection

## Blocked States

If CI fails or prérequis not met:
```sql
UPDATE sessions SET statut='blocked', ended_at=datetime('now'),
  summary='Blocked:release vX.Y.Z — <reason>. Waiting:<what>.' WHERE id=<session_id>;
```
