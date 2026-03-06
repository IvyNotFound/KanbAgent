---
name: code-auditor
description: Comprehensive codebase analysis covering architecture, code quality, security, performance, and maintainability. Activates when user says "audit", "review the codebase", "check for issues", "technical debt", "security audit", "code quality check".
---

# Code Auditor Skill

Full audit of the agent-viewer codebase across 5 dimensions, adapted to the Electron + Vue 3 + TypeScript + SQLite stack.

## When to Use

- User says "audit the code", "check for issues", "review quality"
- Before a major release or refactor
- After a long development sprint
- When onboarding a new contributor

## Audit Dimensions

### 1. 🏗️ Architecture
- Is the Electron main/renderer separation clean? No business logic in renderer?
- Are IPC channels well-typed and documented?
- Is the Vue component hierarchy logical? (smart vs dumb components)
- Are Pinia stores scoped correctly? No God stores?
- Is the SQLite layer properly abstracted (repository pattern or equivalent)?

### 2. 🔒 Security
- Is all IPC input validated in the main process? (never trust renderer)
- Are SQLite queries parameterized? (no string interpolation in queries)
- Is `contextIsolation` enabled in Electron? Is `nodeIntegration` disabled in renderer?
- Are there any exposed sensitive data in IPC channels?
- Check `preload.ts` for unnecessary API surface exposure

### 3. ⚡ Performance
- Any synchronous operations blocking the main process?
- Large SQLite queries without pagination or indexes?
- Vue components re-rendering unnecessarily? (missing `computed`, `shallowRef`)
- Any memory leaks in IPC listeners? (listeners not cleaned up on component unmount)

### 4. 🧹 Code Quality
- TypeScript strict mode compliance? No `any` types?
- Vue 3 Composition API patterns consistent? (`<script setup>` everywhere)
- Dead code, commented-out code, unused imports?
- Functions too long (>50 lines)? Complex conditionals that need extraction?
- Consistent error handling across IPC calls?

### 5. 🧪 Maintainability
- Are components testable in isolation?
- Is there a clear naming convention for IPC channels?
- Are DB migrations versioned and reversible?
- Is the CLAUDE.md up to date with current architecture?

## Output Format

```
## Code Audit — agent-viewer
Date: [date]

### Summary
[2-3 sentence overall assessment]

### Critical Issues 🔴
- [issue] — [file/location] — [recommended fix]

### Important Issues 🟡
- [issue] — [file/location] — [recommended fix]

### Minor Issues 🟢
- [issue] — [file/location]

### Strengths ✅
- [what's working well]

### Recommended Next Steps
1. [priority action]
2. ...
```

## Notes
- Focus on actual issues found, not hypothetical ones
- Be specific: include file names and line numbers when possible
- Don't flag style preferences as issues unless they cause real problems
