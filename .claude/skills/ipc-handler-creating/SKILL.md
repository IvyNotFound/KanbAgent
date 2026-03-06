---
name: ipc-handler-creating
description: Create a new typed IPC handler in agent-viewer following the full stack pattern. Activates when user or agent needs to add a new IPC channel, expose a new API to the renderer, or wire a new feature across main/preload/renderer. Triggers on "add IPC", "new handler", "expose to renderer", "nouveau canal IPC", "créer un handler".
---

# IPC Handler Creating Skill

Full end-to-end creation of a typed IPC handler in agent-viewer, covering all 4 layers in order.

## When to Use

- A new feature requires communication between main process and renderer
- User says "add IPC channel", "expose X to renderer", "new handler for Y"
- An agent needs to persist data or call Node.js APIs from Vue components
- Any new `ipcMain.handle()` / `window.electronAPI.*` addition

## ⚠ Rule: New Structuring IPC → ticket arch first

If the new channel changes an existing contract or introduces a cross-scope dependency → create an `arch` ticket before implementing. Don't implement IPC contracts unilaterally.

## The 4-Layer Pattern (always in this order)

### Layer 1 — Type declaration (`src/types/index.ts` or equivalent)

Add the channel name as a const and the request/response types:

```typescript
// Channel name — always kebab-case with domain prefix
export const MY_CHANNEL = 'domain:action' as const

// Request / Response types
export interface MyChannelRequest {
  param: string
}
export interface MyChannelResponse {
  result: string
  error?: string
}
```

### Layer 2 — Main process handler (`src/main/ipc-<domain>.ts`)

```typescript
import { ipcMain } from 'electron'
import { MY_CHANNEL, MyChannelRequest, MyChannelResponse } from '../types'

export function registerMyHandler(): void {
  ipcMain.handle(MY_CHANNEL, async (_event, req: MyChannelRequest): Promise<MyChannelResponse> => {
    // 1. Validate input — never trust renderer
    if (!req.param || typeof req.param !== 'string') {
      return { result: '', error: 'Invalid param' }
    }
    // 2. Business logic
    try {
      const result = doSomething(req.param)
      return { result }
    } catch (err) {
      return { result: '', error: String(err) }
    }
  })
}
```

### Layer 3 — Preload (`src/preload/index.ts`)

Expose via `contextBridge` — minimal surface, typed:

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing handlers ...
  myAction: (req: MyChannelRequest): Promise<MyChannelResponse> =>
    ipcRenderer.invoke(MY_CHANNEL, req),
})
```

> ⚠ Never expose `ipcRenderer` itself — only typed wrapper functions.

### Layer 4 — Renderer (`src/renderer/src/`)

In the relevant Pinia store or composable:

```typescript
// store or composable
const result = await window.electronAPI.myAction({ param: 'value' })
if (result.error) {
  // handle error
}
```

> Never call `window.electronAPI` directly from components — always go through a store or composable.

## Naming Conventions

| Layer | Convention | Example |
|---|---|---|
| Channel name | `domain:action` kebab-case | `agent:list`, `session:close`, `db:query` |
| Handler file | `ipc-<domain>.ts` | `ipc-agents.ts` |
| Registration | `register<Domain>Handlers()` in `ipc.ts` | `registerAgentHandlers()` |
| Preload key | camelCase action | `listAgents`, `closeSession` |

## Security Checklist

- [ ] Input validated in main process (type guard or explicit checks)
- [ ] No path traversal risk if file paths are involved
- [ ] No `eval()` or dynamic code execution
- [ ] Response always typed `{ result, error? }` — never throws to renderer
- [ ] Handler registered in `ipc.ts` via `register*()` call

## Test

Add a test in `src/main/ipc-<domain>.spec.ts` following the existing pattern:

```typescript
it('handles myAction with valid input', async () => {
  const result = await invokeHandler(MY_CHANNEL, { param: 'test' })
  expect(result.error).toBeUndefined()
  expect(result.result).toBe(...)
})

it('rejects invalid input', async () => {
  const result = await invokeHandler(MY_CHANNEL, { param: null })
  expect(result.error).toBeDefined()
})
```
