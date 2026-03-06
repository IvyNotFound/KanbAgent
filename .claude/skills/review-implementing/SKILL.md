---
name: review-implementing
description: Process and implement code review feedback systematically. Activates when user provides reviewer comments, PR feedback, agent review output, or says "implement this review", "address these comments", "fix review feedback", "apply review suggestions".
---

# Review Implementing Skill

Systematically process and implement code review feedback, including output from Claude Code review agents.

## When to Use

- User pastes PR/code review comments
- User shares output from a review agent (e.g. agent role `review` or `security`)
- User says "implement this feedback", "address these comments", "apply review notes"
- After a `review` or `security` agent run in the multi-agent workflow

## Process

### 1. Parse the Feedback
Extract all actionable items from the review. Categorize as:
- 🔴 **Critical**: bugs, security issues, broken logic → fix immediately
- 🟡 **Important**: performance, type safety, architecture concerns → fix in this pass
- 🟢 **Minor**: style, naming, docs → fix if quick, otherwise defer
- 💬 **Discussion**: questions or suggestions needing decision → flag for user

### 2. Create a Todo List
```
## Review Implementation Plan

### Critical
- [ ] [description] — [file:line]

### Important  
- [ ] [description] — [file:line]

### Minor
- [ ] [description] — [file:line]

### Deferred / Discussion
- [ ] [description] — reason
```

Present this list to user before implementing. Confirm scope.

### 3. Implement Systematically
- Work through Critical → Important → Minor in order
- After each fix, mark as done in the todo list
- Keep fixes focused: don't refactor unrelated code while fixing review items

### 4. Validate
After all fixes:
- Run TypeScript compiler: `tsc --noEmit`
- Run tests if available
- Quick sanity check on affected components

### 5. Report
Summary of what was implemented, what was deferred, and why.

## Special Cases for agent-viewer

### When feedback comes from a `security` agent:
- Treat all security findings as Critical regardless of severity label
- Check IPC input validation (never trust renderer input in main process)
- Check SQLite queries for injection risks (use parameterized queries)

### When feedback comes from a `review` agent:
- Pay special attention to TypeScript type coverage comments
- Check for Vue 3 reactivity pitfalls flagged (`.value` misuse, toRef vs toRefs)
- Verify IPC channel type consistency between main and renderer

### When feedback comes from a `rd` (R&D) agent:
- These are suggestions/experiments, not mandatory
- Flag each one as a potential ticket in agent-viewer itself
