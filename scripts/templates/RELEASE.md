# RELEASE.md — Release Workflow

> Reference for project releases. Responsible agent: `devops`.

---

## Commands

| Command | Description |
|---|---|
| `npm run release` | Patch release (default) |
| `npm run release:patch` | Patch release |
| `npm run release:minor` | Minor release |
| `npm run release:major` | Major release |

---

## Prerequisites

- `main` branch clean (working tree clean)
- 0 tickets `todo` / `in_progress`
- `npm run build` OK
- Doc ticket updated (README + JSDoc) → validated by review

---

## What the Script Does

branch check → build + lint → version bump → CHANGELOG → commit + tag → push → draft GitHub Release

---

## Post-release

1. Check the GitHub Release draft
2. Publish manually
3. Attach binaries (.exe, .dmg) if available

---

## Bump Rules

| Type | When | Example |
|---|---|---|
| PATCH | fix, perf, refactor (no breaking change) | 1.0.0 → 1.0.1 |
| MINOR | backward-compatible feat | 1.0.0 → 1.1.0 |
| MAJOR | breaking change (DB schema, IPC overhaul) | 1.0.0 → 2.0.0 |

> MAJOR bump: interactive confirmation required — `arch` + lead validation required.

---

## v1.0.0 Criteria (stable)

| Criterion | Owner | Status |
|---|---|---|
| `doc` session completed and validated (README, CONTRIBUTING, minimal JSDoc) | `doc` | ⬜ |
| `security` session completed (OWASP audit, contextBridge, IPC, file access) | `arch` + `review` | ⬜ |
| 0 tickets `todo` / `in_progress` on doc and security | `review-master` | ⬜ |
| Build tested and functional (`npm run build` → installer) | `devops` | ⬜ |
