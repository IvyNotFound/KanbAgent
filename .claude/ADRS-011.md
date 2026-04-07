# ADRs — Architecture Decision Records (ADR-011)

> Continuation of `.claude/ADRS.md` · ADR-001 to ADR-003 → `ADRS.md` · ADR-004 to ADR-006 → `ADRS-004-006.md` · ADR-007 → `ADRS-007.md` · ADR-008 to ADR-009 → `ADRS-008-009.md` · ADR-010 → `ADRS-010.md`

---

## ADR-011 — Tailwind CSS → Vuetify 3 (Material Design 3) Migration

**Date:** 2026-04-05 | **Status:** accepted | **Author:** arch

### Context

KanbAgent's `front-vuejs` scope used Tailwind CSS for styling since project inception. ADR-004 had planned a migration from Tailwind v3 to v4 but was never executed.

The decision was made to adopt a full component library (Vuetify 3) to achieve Material Design 3 consistency, accelerate UX development, and eliminate the need for hand-crafting components from utility classes.

**Prior state:**
- `tailwindcss ^3.4.1` + `postcss.config.js` + `tailwind.config.ts`
- ~186 Tailwind utility classes across 21 Vue components
- No established component system — each component hand-built

**Motivation:**
- Material Design 3 (MD3) is the target design language for KanbAgent
- Vuetify 3 provides a complete MD3 component library out of the box (`v-btn`, `v-card`, `v-chip`, `v-dialog`, etc.)
- Eliminates design inconsistencies that arise from utility-class-based custom components
- `vite-plugin-vuetify` enables tree-shaking and auto-imports for zero-boilerplate integration with electron-vite

**Implementation branch:** `feat/material-design`

### Decision

**Replace Tailwind CSS with Vuetify 3** as the primary styling and component system for `renderer/`.

| Removed | Added |
|---|---|
| `tailwindcss`, `@tailwindcss/postcss`, `autoprefixer` | `vuetify`, `vite-plugin-vuetify`, `@mdi/font` |
| `tailwind.config.ts` | Vuetify plugin config in `vite.config.ts` |
| `postcss.config.js` | — |
| Tailwind utility classes | Vuetify `v-*` components + MD3 design tokens |

**Design system:** Material Design 3 — color tokens (`primary`, `secondary`, `surface`, `on-surface`, etc.), elevation, typography scale, and component states are managed by Vuetify's theming system.

**Agent rule:** `front-vuejs` agents must use Vuetify components and MD3 tokens. No Tailwind utility classes. Custom styles use `<style scoped>` with CSS variables from the Vuetify theme when needed.

### Consequences

- `CLAUDE.md` scope description updated: `Vue 3 + TS + Tailwind` → `Vue 3 + TS + Vuetify 3 (Material Design 3)`
- ADR-004 (Tailwind v3 → v4) marked as superseded — the planned migration was never needed
- Agents must use `v-*` prefixed Vuetify components; no Tailwind utility classes in `renderer/`
- Dark/light theming handled via Vuetify's `useTheme()` — no `dark:` Tailwind variant
- Custom color tokens defined in Vuetify plugin config (`src/renderer/src/plugins/vuetify.ts`)

### Risks

| Risk | Mitigation |
|---|---|
| Vuetify component styling overrides complex | Use `density`, `variant`, `color` props before custom CSS |
| electron-vite + vite-plugin-vuetify compatibility | Validated on `feat/material-design` branch |
| MD3 token names unfamiliar to agents | This ADR + CLAUDE.md update serve as canonical reference |
