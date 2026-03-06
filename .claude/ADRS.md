# ADRs — Architecture Decision Records

> Validated architecture decisions. Any new ADR → `arch` agent, CLAUDE.md revision.
> Split across multiple files due to size: ADR-004 to ADR-006 → `ADRS-004-006.md` · ADR-007 → `ADRS-007.md` · ADR-008 to ADR-009 → `ADRS-008-009.md`

---

## ADR-001 — Operational Agent Naming

**Date:** 2026-02-24 | **Status:** accepted | **Author:** arch

### Context

The `git` agent covered a broader scope than pure git operations (CI/CD, releases, scripts). The name caused ambiguity. Large-scale projects require a separation between infra operations and production access.

### Decision

Rename `git` → `devops` and define three levels of operational agents:

| Agent | Scope | Autonomy |
|---|---|---|
| `devops` | Commits, branches, CI/CD, releases, scripts | Autonomous |
| `infra` | Servers, Docker, IaC, monitoring, configuration | Autonomous |
| `infra-prod` | Production only — irreversible or high-risk actions | Mandatory human validation |

`infra` and `infra-prod` are optional, created on demand.

### Consequences

- CLAUDE.md updated: `git` → `devops`, added `infra` and `infra-prod`
- DB: `UPDATE agents SET name='devops', type='devops' WHERE name='git';`
- Rule added: `infra-prod` can never act without explicit human confirmation

---

## ADR-002 — Thinking Mode per Agent

**Date:** 2026-02-25 | **Status:** revised 2026-02-25 | **Author:** arch

### Context

The Claude API supports multiple extended reasoning modes. Each agent type has a different complexity profile — disabling thinking for simple agents (test, doc, devops) significantly reduces costs.

**Audit of real levers (Claude Code docs 2026-02-25):**

| Lever | Availability | Control |
|---|---|---|
| `alwaysThinkingEnabled` | project/user `settings.json` | `true` / `false` |
| `CLAUDE_CODE_EFFORT_LEVEL` | env var / settings.json | `low/medium/high` — **Opus 4.6 only** |

There is **no** `--thinking disabled` flag or `budget_tokens` parameter in the `claude` CLI. The `budget_tokens` value stored in DB was anticipatory — it never had a CLI equivalent.

### Decision

Column `thinking_mode TEXT` on `agents` with values **`auto | disabled`** (NULL = auto). The value is read by the launcher (LaunchSessionModal / terminal.ts) and injected via `--settings`.

| DB Value | CLI Injection | Behavior |
|---|---|---|
| `NULL` or `'auto'` | *(no flag)* | Default mode — Claude decides |
| `'disabled'` | `--settings '{"alwaysThinkingEnabled":false}'` | Extended thinking disabled |

**Override rule:** DB value = default. User can modify per session via LaunchSessionModal.

### Consequences

- Column `thinking_mode` on `agents`: CHECK constraint → `('auto', 'disabled')` — `budget_tokens` removed
- `terminal.ts`: inject `--settings '{"alwaysThinkingEnabled":false}'` when `thinkingMode === 'disabled'`
- `LaunchSessionModal.vue`: 2-button UI — Auto / Disabled ("Budget" button removed)
- `CLAUDE_CODE_EFFORT_LEVEL` out of scope for agent-viewer (Opus only, not exposed via IPC)

---

## ADR-003 — WSL Consolidation: Single User, API Profile Selector

**Date:** 2026-02-25 | **Status:** accepted | **Author:** arch

### Context

Three distinct WSL users to isolate Claude Code API configurations: two Claude Pro (OAuth), one Minimax M2.5 (API key + compatible endpoint).

**Problems with multi-user:**
- nvm per user → risk of divergent Node versions
- duplicated node_modules → disk overhead
- Fragmented `~/.claude/` logs → difficult debugging

**Constraint:** API keys must not be in `project.db`.

**Real need:** choose the API profile at launch time (per-session, not per-agent).

### Decision

**Single WSL user.** API profile selectable in `LaunchSessionModal` via wrapper scripts in `~/bin/`.

```bash
# ~/bin/claude-pro2  (second OAuth account)
#!/bin/bash
export CLAUDE_CONFIG_DIR="$HOME/.claude-pro2"
exec claude "$@"

# ~/bin/claude-minimax  (MiniMax-M2.5 — ANTHROPIC_AUTH_TOKEN, NOT API_KEY)
#!/bin/bash
# ANTHROPIC_AUTH_TOKEN avoids the "Auth conflict" warning (≠ ANTHROPIC_API_KEY)
# Official Minimax base URL: https://api.minimax.io/anthropic (international)
# Docs: https://platform.minimax.io/docs/guides/text-ai-coding-tools
export ANTHROPIC_BASE_URL="https://api.minimax.io/anthropic"
export ANTHROPIC_AUTH_TOKEN="YOUR_MINIMAX_API_KEY"
export ANTHROPIC_MODEL="MiniMax-M2.5"
export ANTHROPIC_SMALL_FAST_MODEL="MiniMax-M2.5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="MiniMax-M2.5"
export ANTHROPIC_DEFAULT_OPUS_MODEL="MiniMax-M2.5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="MiniMax-M2.5"
exec claude "$@"
```

> The primary OAuth account needs no wrapper — bare `claude` uses `~/.claude/`.

**Why `ANTHROPIC_AUTH_TOKEN` and not `ANTHROPIC_API_KEY` for minimax?**
`ANTHROPIC_API_KEY` triggers the "Auth conflict" warning when OAuth is also present. `ANTHROPIC_AUTH_TOKEN` is the alternative variable recognized by the Anthropic SDK — it does not trigger this warning. Recommended by official Minimax documentation.

**Profile discovery:** `terminal:getClaudeProfiles` IPC lists `claude-*` entries in `~/bin/`. LaunchSessionModal displays a selector with these profiles + `claude` (default).

**`claudeCommand` security:** validated against the pattern `^claude(-[a-z0-9-]+)?$` before shell interpolation. Any non-conforming value → IPC error.

### Consequences

**No DB schema change.** Profile = session decision, not an agent attribute.

**`terminal.ts`**:
- IPC `terminal:getClaudeProfiles` → lists `claude-*` in WSL `~/bin/`
- `terminal:create` receives `claudeCommand?: string` (default: `'claude'`)
- Regex validation `^claude(-[a-z0-9-]+)?$` required

**`LaunchSessionModal.vue`**:
- "API Profile" selector populated via `terminal:getClaudeProfiles`
- Value passed to `tabsStore.addTerminal` → `TerminalView` → `terminal:create`

**Secondary OAuth setup:**
```bash
mkdir -p ~/.claude-pro2
ln -s ~/.claude/settings.json ~/.claude-pro2/settings.json  # optional
CLAUDE_CONFIG_DIR=~/.claude-pro2 claude auth login
```

**Minimax setup:**
```bash
mkdir -p ~/.claude-minimax
cp ~/.claude/settings.json ~/.claude-minimax/settings.json  # copy, not symlink
# Edit ~/bin/claude-minimax: fill in ANTHROPIC_API_KEY
chmod +x ~/bin/claude-minimax
```

**WSL migration:**
1. Backup `~/.claude/` from each WSL user to be removed
2. Keep the single primary WSL user (e.g. `cover`)
3. Create wrappers in `~/bin/`
4. Remove surplus WSL users

### Approach Comparison

| Approach | Status | Risks |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | ✅ Officially documented | No side effects |
| `HOME` override | ⚠️ Undocumented | Breaks nvm, `.bashrc`, node_modules paths |
| `ANTHROPIC_API_KEY` alone | ❌ Insufficient for OAuth | Conflict if OAuth token present |

---

## Known Git Anomalies

### Commit 3cda7ee — T987 label bundles T961 changes (2026-03-06)

**Commit:** `3cda7ee test: configure stryker mutation testing (T987)`

**Problem:** This commit contains changes from two distinct tickets:
- **T987** (stryker): `stryker.config.mjs`, `package.json` (`test:mutation` script)
- **T961** (language selector dropdown, 18 locales): `DbSelector.vue`, `SettingsModal.vue`, `SettingsModal.spec.ts`, `src/renderer/src/plugins/i18n.ts`, `src/renderer/src/stores/settings.ts`, `src/main/default-agents.ts`

**Context:** T961 was archived (code correct, in production). T987 was rejected for unrelated reasons but its code (stryker config) was merged. The commit message only references T987.

**Impact:** No code issue — all changes are in production and correct. Convention violation only: one commit should map to one ticket scope.

**Resolution:** Documented here. No code change required.
