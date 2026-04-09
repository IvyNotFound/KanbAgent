# ADRs — Architecture Decision Records (ADR-012)

> Continuation of `.claude/ADRS.md` · ADR-001 to ADR-003 → `ADRS.md` · ADR-004 to ADR-006 → `ADRS-004-006.md` · ADR-007 → `ADRS-007.md` · ADR-008 to ADR-009 → `ADRS-008-009.md` · ADR-010 → `ADRS-010.md` · ADR-011 → `ADRS-011.md`

---

## ADR-012 — CLI-Agnostic Project Rules, Worktrees, and Skills

**Date:** 2026-04-09
**Status:** Accepted
**Decider:** arch
**Ticket:** T1809-T1813 (generic template audit)

### Context

KanbAgent supports 6 coding agent CLIs (ADR-010: claude, codex, gemini, opencode, aider, goose). Three orthogonal features are currently Claude Code-specific but should be generalized:

**1. Project rules files** — project-wide instructions auto-loaded by the CLI

| CLI | Rules file(s) | Discovery |
|-----|---------------|-----------|
| Claude Code | `CLAUDE.md` (project root) | Auto-loaded at session start |
| Gemini CLI | `GEMINI.md` (project root) | Auto-loaded at session start |
| Codex | `.codex/instructions.md` | Auto-loaded; also `--instructions` flag |
| Aider | `.aider.conf.yml`, `--read` | Config file + explicit flag |
| OpenCode | No standard rules file | System prompt via config only |
| Goose | `~/.config/goose/config.yaml` | ACP protocol init or `--system-prompt` |

**Current problem:** `create-project-db` writes only `CLAUDE.md` — hardcoded French, KanbAgent-specific (Vue, Electron, agents that don't exist in generic set). No file generated for other CLIs.

**2. Git worktrees** — already CLI-agnostic at the code level

`worktree-manager.ts` creates/removes worktrees for any CLI. However, the **instructions** about worktrees are only in the SHARED_SUFFIX (Layer 2 — system prompt) which works for all CLIs. The rules file (Layer 1) doesn't mention worktrees at all. The WORKFLOW.md template deployed to new projects also lacks worktree instructions.

**3. Skills** — `.claude/skills/` reusable prompt snippets

Claude Code skills (`.claude/skills/<name>/SKILL.md`) are powerful: they encapsulate repeatable workflows (migration-creating, ticket-completing, git-pushing, etc.) and are auto-triggered by keywords. KanbAgent has 12 skills. **No other CLI has an equivalent mechanism** today:

| CLI | Equivalent to skills? | Notes |
|-----|----------------------|-------|
| Claude Code | `.claude/skills/` | Full support — keyword triggers, frontmatter metadata |
| Gemini CLI | None | No plugin/skill system |
| Codex | None | Only `instructions.md` (flat, no trigger) |
| Aider | None | Config-based, no dynamic prompt injection |
| OpenCode | None | No equivalent |
| Goose | Goose Toolkits (MCP) | Different paradigm — MCP tools, not prompt snippets |

**Two layers of context injection:**
- **Layer 1 — Rules file** (CLAUDE.md, GEMINI.md): project-wide, auto-loaded, human-readable. Contains workflow, DB access, agent list.
- **Layer 2 — System prompt** (`system_prompt` + `system_prompt_suffix` in agents table): agent-specific, injected via adapter's `prepareSystemPrompt`. Contains role, protocol, done checklist, worktree instructions.

Layer 2 already works for all CLIs (ADR-010). **Layer 1 is Claude-only and broken for generic projects. Skills are Claude-only with no cross-CLI path.**

### Decision

#### Part A — Project Rules: Canonical Source + Per-CLI Generation

**Introduce `getProjectRules(lang)` as the single source of truth for project rules content.**

```typescript
// src/main/project-templates.ts
export function getProjectRules(lang: AgentLanguage): string { ... }
```

Content is the current CLAUDE.md information, but:
- No CLI-specific references (no `claude` binary, no `--append-system-prompt`)
- No framework-specific references (no Vue, Electron, Tailwind)
- Agent list matches the actual generic set (dev, review, test, doc, task-creator)
- Language matches the user's selection
- Includes a section pointing to `.claude/WORKFLOW.md` for full SQL reference

**Generation at init (`create-project-db`):**
1. Always generate `CLAUDE.md` (primary CLI, safe default)
2. For each other CLI detected via `wsl:getCliInstances`: generate its rules file
3. If detection hasn't run yet: generate only `CLAUDE.md`; offer "Regenerate rules files" in UI later

| CLI detected | File generated |
|---|---|
| claude | `CLAUDE.md` (always) |
| gemini | `GEMINI.md` |
| codex | `.codex/instructions.md` |
| aider | System prompt only (no standard rules file) |
| opencode | System prompt only |
| goose | System prompt only |

**Regeneration:** when a new CLI is detected post-init, UI proposes "Generate GEMINI.md?" — no auto-generation (files at project root are git-visible).

#### Part B — Worktrees: Add to WORKFLOW.md Template

Worktree instructions are currently only in the agent `system_prompt_suffix` (Layer 2). Add a dedicated section to the `WORKFLOW_MD_TEMPLATE` so that:
1. The human can read the worktree protocol in the project docs
2. Any CLI (including those without `--system-prompt` support) can discover worktree instructions via the rules file

```markdown
## Git Worktrees (Agent Isolation)

When a session has a worktree active (WORKTREE_PATH in startup context):
- Source code: work exclusively from the worktree directory
- DB scripts: always run from the main repo (cd <main-repo> && node scripts/dbq.js ...)
- Before closing: git add -A && git commit -m "chore: work done — T<task_id>"
- Do not push — review will merge the branch after validation
```

This is a documentation improvement — the actual worktree creation/removal code in `worktree-manager.ts` is already CLI-agnostic and needs no changes.

#### Part C — Skills: No Cross-CLI Generation (Claude-Only)

**Skills remain Claude Code-exclusive.** Rationale:

1. **No other CLI supports a skills mechanism.** There is no file convention, no trigger system, no equivalent concept in any of the 5 other supported CLIs.
2. **System prompt injection (Layer 2) already covers the critical workflows.** The `system_prompt_suffix` contains the agent protocol, done checklist, worktree instructions — the most important parts of what skills encode.
3. **Skills are high-value for power users, not for initial project setup.** They are KanbAgent-specific (migration-creating, ipc-handler-creating) and would need complete rewriting for each new project anyway.

**However**, to future-proof:
- Skills metadata (name, description, trigger keywords) could be stored in `project.db` alongside agents — making them inspectable and manageable from the KanbAgent UI regardless of CLI
- If a CLI adds skill-like support in the future, the adapter contract (`CliAdapter`) can be extended with a `skillsDirectory?: string` field

**Concrete action for now:** Add a `## Skills` section to the generic CLAUDE.md template (Layer 1) pointing users to `.claude/skills/` with a note that this is Claude Code-specific:

```markdown
## Skills (Claude Code only)

Reusable workflow snippets in `.claude/skills/<name>/SKILL.md`.
Auto-triggered by keywords. See existing skills for examples.
Other CLIs use the system prompt (Layer 2) for equivalent functionality.
```

### Rejected alternatives

| Alternative | Reason for rejection |
|---|---|
| **Single AGENTS.md + symlinks** | Symlinks unreliable on Windows, inconsistent in git, CLIs may not follow them |
| **Only CLAUDE.md, rely on system_prompt for other CLIs** | Gemini CLI ignores `--system-prompt` and only reads GEMINI.md. Rules files are editable/versionable. |
| **Generate all CLI files unconditionally** | Pollutes root with files for CLIs not installed |
| **Template per CLI with unique content** | 6 templates x 14 languages = 84 files. Content is 95% identical. |
| **Transpile skills to other CLI formats** | No target format exists. Goose Toolkits are MCP-based (different paradigm). Aider has no plugin system. |
| **Inline all skill content into system_prompt** | Would exceed reasonable prompt size. Skills are on-demand, not always-injected. |
| **Store skills in project.db and inject per-session** | Overengineered for current state. No CLI besides Claude Code can use dynamic prompt snippets. Revisit when a second CLI adds skill support. |

### Consequences

**Positives:**
- Users of any supported CLI get a working rules file on init
- Single source of truth (`getProjectRules()`) — update once, all CLIs benefit
- Worktree protocol documented in Layer 1 (visible to all CLIs and humans)
- Skills stay simple (Claude-only files) without premature abstraction
- No wasted effort building cross-CLI skill transpilation that no CLI can use

**Negatives / trade-offs:**
- Multiple near-identical files at project root — mitigated by only generating for detected CLIs
- Skills are a competitive advantage for Claude Code users; other CLI users get a degraded experience — acceptable because the degradation matches the CLIs' actual capabilities
- Detection dependency at init time — safe default (CLAUDE.md only) with regeneration option

### Agent impact

| Agent | Impact |
|---|---|
| `dev-back-electron` | Implement `getProjectRules(lang)`, refactor `create-project-db`, add per-CLI generation, enrich `WORKFLOW_MD_TEMPLATE` with worktree section |
| `dev-front-vuejs` | Add "Regenerate rules files" button in project settings |
| `arch` | Update CLAUDE.md to note Layer 1 vs Layer 2 distinction |
| `doc` | Document multi-CLI rules in README |
| All generic agents | No change — Layer 2 (`system_prompt`) is unaffected |
