# ADRs — Architecture Decision Records (ADR-007)

> Continuation of `.claude/ADRS.md` · ADR-001 to ADR-003 → `ADRS.md` · ADR-004 to ADR-006 → `ADRS-004-006.md` · ADR-008 to ADR-009 → `ADRS-008-009.md`

---

## ADR-007 — Native Windows Support for Claude Code Sessions

**Date:** 2026-02-26 | **Status:** accepted | **Author:** arch

### Context

Currently, agent-viewer can only launch Claude Code sessions via WSL (`wsl.exe` → `node-pty`). The need is to also support launching Claude Code installed natively on Windows (npm global → `claude.cmd`), without WSL.

**Existing code analysis:**

`terminal.ts` is 100% WSL-centric:
- `spawn('wsl.exe', args, ...)` — hard-coded
- `toWslPath()` — Windows → `/mnt/c/...` conversion
- `startMemoryMonitoring()` — runs `wsl.exe -- free -m`
- `terminal:getClaudeInstances` — scans WSL distros
- `terminal:getClaudeProfiles` — scans `~/bin/` in WSL
- Env vars `wslRequiredVars` — WSL-specific to `wsl.exe`
- `gracefulKillPty()` — sequence Ctrl+C → `exit\r` → kill (adapted for WSL bash)

**node-pty on Windows:**
node-pty natively supports Windows via ConPTY (Windows 10 1809+). `spawn('cmd.exe', ...)` or `spawn('powershell.exe', ...)` works without additional configuration. The current build already includes ConPTY (cf. MEMORY.md — Spectre mitigation fix).

### Decision

Add an `env: 'wsl' | 'windows'` parameter to the `terminal:create` IPC and a new `terminal:getWindowsClaudeInstances` handler for Windows detection.

#### 1. IPC `terminal:create` — New `env` Parameter

**Current signature:**
```ts
terminal:create(cols, rows, projectPath?, wslDistro?, systemPrompt?, userPrompt?, thinkingMode?, claudeCommand?, convId?)
```

**Problem:** adding `env` as a 10th positional parameter makes the API unreadable and fragile.

**Solution: migration to an options object.**

```ts
// New payload — single object instead of positional parameters
interface TerminalCreatePayload {
  cols: number
  rows: number
  env: 'wsl' | 'windows'        // NEW — default: 'wsl' for backward compatibility
  projectPath?: string
  wslDistro?: string             // ignored if env='windows'
  systemPrompt?: string
  userPrompt?: string
  thinkingMode?: string
  claudeCommand?: string
  convId?: string
}
```

**Backward compatibility:** the backend handler accepts both forms during a transition:
```ts
ipcMain.handle('terminal:create', async (event, ...args) => {
  // Object form (new)
  if (args.length === 1 && typeof args[0] === 'object') {
    const payload = args[0] as TerminalCreatePayload
    // ...
  }
  // Positional form (legacy) — env defaults to 'wsl'
  else {
    const [cols, rows, projectPath, wslDistro, ...rest] = args
    // ...
  }
})
```

**Preload impact:**
```ts
// Before — positional args
terminalCreate: (cols, rows, projectPath?, wslDistro?, ...) => ...

// After — object payload
terminalCreate: (payload: TerminalCreatePayload) => ipcRenderer.invoke('terminal:create', payload)

// Legacy compat — remove in 0.4.0
terminalCreateLegacy: (cols, rows, ...) => ipcRenderer.invoke('terminal:create', cols, rows, ...)
```

#### 2. Windows Branch in `terminal:create`

When `env === 'windows'`:

```ts
// Shell = cmd.exe (PowerShell has encoding quirks with node-pty)
const shell = 'cmd.exe'
const shellArgs: string[] = []

// Minimal env for native Windows
const ptyEnv: Record<string, string> = {
  TERM: 'xterm-256color',
  PATH: process.env.PATH || '',
  USERPROFILE: process.env.USERPROFILE || '',
  APPDATA: process.env.APPDATA || '',
  LOCALAPPDATA: process.env.LOCALAPPDATA || '',
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  HOME: process.env.HOME || process.env.USERPROFILE || '',
}

// CWD = projectPath as-is (no toWslPath)
const cwd = projectPath ?? process.env.USERPROFILE ?? 'C:\\'

const pty = spawn(shell, shellArgs, {
  name: 'xterm-256color',
  cols, rows, cwd,
  env: ptyEnv,
})
```

**Claude launch (agent session):**
```ts
// Windows: claude.cmd is in npm global PATH
// No bash -lc, no temp script — cmd.exe executes directly
const cmd = claudeCommand ?? 'claude'
const thinkingFlag = thinkingMode === 'disabled'
  ? ' --settings "{\\"alwaysThinkingEnabled\\":false}"'
  : ''

if (validConvId) {
  // Resume
  pty.write(`${cmd} --resume ${validConvId}${thinkingFlag}\r`)
} else if (systemPrompt && userPrompt) {
  // System prompt injection: base64 via certutil (native Windows)
  // certutil -decode is available on all Windows 10+ versions
  const b64 = Buffer.from(systemPrompt).toString('base64')
  const tempFile = join(tmpdir(), `agent-prompt-${id}.b64`)
  const decodedFile = join(tmpdir(), `agent-prompt-${id}.txt`)
  await writeFile(tempFile, b64, 'utf8')

  // cmd.exe sequence: decode → launch claude with content
  pty.write(`certutil -decode "${tempFile}" "${decodedFile}" >nul 2>&1 && ` +
    `for /f "delims=" %%a in ('type "${decodedFile}"') do ` +
    `${cmd} --append-system-prompt "%%a"${thinkingFlag}\r`)
  tempScriptWinPath = tempFile  // cleanup on exit
}
```

**Simplified alternative (recommended):** for Windows, write the system prompt to a text file and use `--append-system-prompt-file` (print mode only — **to be validated**). Otherwise, use the same approach as WSL with a temp file:

```ts
// Write prompt to a .txt file
const promptFile = join(tmpdir(), `agent-prompt-${id}.txt`)
await writeFile(promptFile, systemPrompt, 'utf8')
// Launch claude with file as argument
pty.write(`${cmd} --append-system-prompt "${systemPrompt.replace(/"/g, '\\"')}"${thinkingFlag}\r`)
```

> **Note:** the exact Windows system prompt injection mechanism must be validated during implementation. Both approaches (certutil decode, direct file) are viable. The key constraint is that system prompt may contain special CMD characters (`<`, `>`, `|`, `&`, `^`).

**Implementation recommendation:** write system prompt to a temporary `.txt` file, then use `--append-system-prompt` with a `type <file> | ...` pipe, or more simply use PowerShell for this step only:

```ts
// PowerShell one-liner for safe injection (no CMD escaping issues)
const promptFile = join(tmpdir(), `agent-prompt-${id}.txt`)
await writeFile(promptFile, systemPrompt, 'utf8')
pty.write(`powershell -NoProfile -Command "& { $p = Get-Content '${promptFile}' -Raw; & ${cmd} --append-system-prompt $p${thinkingFlag} }"\r`)
```

#### 3. IPC `terminal:getWindowsClaudeInstances`

New handler to detect Claude Code installed natively on Windows.

```ts
ipcMain.handle('terminal:getWindowsClaudeInstances', async () => {
  try {
    // where.exe claude → looks for claude.cmd in PATH
    const { stdout } = await execPromise('where.exe', ['claude'])
    const paths = stdout.split('\n').map(p => p.trim()).filter(Boolean)
    if (paths.length === 0) return []

    // Version check
    const { stdout: verOut } = await execPromise('claude', ['--version'])
    const version = verOut.trim().split(' ')[0]

    // Scan for claude-*.cmd in the same directory as claude.cmd
    const claudeDir = paths[0].replace(/\\claude\.cmd$/i, '').replace(/\\claude$/i, '')
    let profiles = ['claude']
    try {
      const { stdout: dirOut } = await execPromise('cmd.exe', ['/c', `dir /b "${claudeDir}\\claude-*.cmd" 2>nul`])
      const scripts = dirOut.split('\n')
        .map(f => f.trim().replace(/\.cmd$/i, ''))
        .filter(f => CLAUDE_CMD_REGEX.test(f))
        .sort()
      profiles = ['claude', ...scripts.filter(s => s !== 'claude')]
    } catch { /* no claude-* scripts */ }

    return [{
      env: 'windows' as const,
      label: 'Windows (native)',
      version,
      profiles,
    }]
  } catch {
    return []  // Claude not in PATH
  }
})
```

**Return type:**
```ts
interface WindowsClaudeInstance {
  env: 'windows'
  label: string
  version: string
  profiles: string[]
}
```

#### 4. Unified `ClaudeInstance` Type

Extend the existing `ClaudeInstance` type to support both environments:

```ts
export interface ClaudeInstance {
  /** Environment type */
  env: 'wsl' | 'windows'
  /** WSL distro name (env='wsl') or 'Windows' (env='windows') */
  distro: string
  /** Claude Code version */
  version: string
  /** Whether this is the default/preferred instance */
  isDefault: boolean
  /** Wrapper scripts matching claude(-[a-z0-9-]+)? */
  profiles: string[]
}
```

**Backward compatibility:** `terminal:getClaudeInstances` returns WSL instances with `env: 'wsl'` added. A new combined handler `terminal:getAllClaudeInstances` calls both in parallel and returns a unified array.

```ts
ipcMain.handle('terminal:getAllClaudeInstances', async () => {
  const [wslInstances, winInstances] = await Promise.all([
    getWslClaudeInstances(),   // existing code from terminal:getClaudeInstances
    getWindowsClaudeInstances()
  ])
  return [...winInstances, ...wslInstances]  // Windows first (faster to detect)
})
```

#### 5. Conditional Adaptations (env=windows)

| Component | WSL Behavior (unchanged) | Windows Behavior |
|---|---|---|
| `toWslPath()` | Converts `C:\...` → `/mnt/c/...` | Not called — native Windows path |
| `startMemoryMonitoring()` | `wsl.exe -- free -m` | Skip — no `free` on Windows |
| `gracefulKillPty()` | Ctrl+C x2 → `exit\r` → kill | Ctrl+C x2 → kill (no `exit`) |
| `CONV_ID_REGEX` | Unchanged | Unchanged (OS-agnostic) |
| `CLAUDE_CMD_REGEX` | `^claude(-[a-z0-9-]+)?$` | Identical — validates name, not extension |
| `PtyLaunchParams` | `wslDistro` stored | `env: 'windows'` stored |
| Temp script cleanup | `unlink()` | `unlink()` identical |

**New `PtyLaunchParams` field:**
```ts
interface PtyLaunchParams {
  env: 'wsl' | 'windows'       // NEW
  cols: number
  rows: number
  projectPath?: string
  wslDistro?: string            // WSL only
  systemPrompt?: string
  userPrompt?: string
  thinkingMode?: string
  claudeCommand?: string
  convId?: string
  detectedConvId?: string
}
```

#### 6. LaunchSessionModal.vue — Environment Selector

**UI flow:**

1. On mount, call `terminal:getAllClaudeInstances` (replaces `terminal:getClaudeInstances`)
2. The returned array contains mixed WSL and Windows instances
3. Display a `WSL` or `WIN` badge next to each instance
4. Selection automatically determines `env` + `distro`
5. If `env='windows'` is selected → hide WSL-only options (distro)
6. Pass `env` via `tabsStore.addTerminal` → `TerminalView` → `terminal:create`

**No separate Environment selector** — the environment is determined by the selected instance, simplifying UX (one choice instead of two).

#### 7. Store `tabs.ts` — `env` Propagation

Add `env` to the `Tab` interface:

```ts
export interface Tab {
  // ... existing fields ...
  env?: 'wsl' | 'windows'  // NEW — default 'wsl' for compat
}
```

`addTerminal()` accepts `env` and propagates it. `TerminalView` reads it to build the `terminal:create` payload.

### Required Modifications (summary)

| File | Action | Effort |
|---|---|---|
| `src/main/terminal.ts` | Windows branch in `terminal:create`, new handlers `getWindowsClaudeInstances`, `getAllClaudeInstances`, skip memoryCheck if env=windows, adapted gracefulKill | High |
| `src/preload/index.ts` | `terminalCreate` migrated to object payload, new `getAllClaudeInstances` | Medium |
| `src/renderer/src/types/index.ts` | `ClaudeInstance.env` added, `Tab.env` added | Low |
| `src/renderer/src/components/LaunchSessionModal.vue` | Call `getAllClaudeInstances`, env badge, `env` transmission | Medium |
| `src/renderer/src/components/TerminalView.vue` | Read `tab.env`, build object payload | Medium |
| `src/renderer/src/stores/tabs.ts` | `addTerminal` accepts `env` | Low |
| `src/main/terminal.spec.ts` | Tests for Windows branch (spawn, env vars, gracefulKill) | Medium |

### Risks

| Risk | Probability | Mitigation |
|---|---|---|
| `claude.cmd` not in Windows PATH | Medium | `where.exe claude` check + clear UI error message |
| System prompt escaping CMD (`<`, `>`, `\|`, `&`) | High | Temp file + PowerShell one-liner for injection |
| ConPTY incompatibility (Win 10 < 1809) | Very low | Electron requires Win 10+ anyway |
| node-pty UTF-8 encoding on cmd.exe | Low | `chcp 65001` injected at PTY startup |
| `gracefulKillPty` Windows: Ctrl+C may not be captured | Low | `pty.kill()` fallback after timeout (already in place) |

### Out of Scope

- Support for PowerShell as primary PTY shell (cmd.exe sufficient as wrapper)
- macOS/Linux native support (no `wsl.exe` on these platforms)
- Auto-installation of Claude Code if absent from PATH
- Migration of existing WSL `terminal:getClaudeInstances` (kept for compat)

### Consequences

- `terminal:create` migrates to an object payload — breaking change for the renderer but no IPC protocol change (still `invoke`)
- The positional → object migration is an opportunity to simplify signatures and avoid accumulation of optional parameters
- `ClaudeInstance` becomes polymorphic (`env: 'wsl' | 'windows'`) — the renderer does not need to know implementation details
- Implementation tickets to be created by `review`: one back-electron (terminal.ts + preload), one front-vuejs (LaunchSessionModal + TerminalView + tabs store), one test-back-electron (terminal.spec.ts)
