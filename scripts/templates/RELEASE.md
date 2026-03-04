# RELEASE.md — Workflow de release

> Référence pour les releases du projet. Agent responsable : `devops`.

---

## Commandes

| Commande | Description |
|---|---|
| `npm run release` | Release patch (défaut) |
| `npm run release:patch` | Release patch |
| `npm run release:minor` | Release minor |
| `npm run release:major` | Release major |

---

## Prérequis

- Branche `main` propre (working tree clean)
- 0 ticket `todo` / `in_progress`
- `npm run build` OK
- Ticket doc mis à jour (README + JSDoc) → validé par review

---

## Ce que le script effectue

vérification branche → build + lint → bump version → CHANGELOG → commit + tag → push → draft GitHub Release

---

## Post-release

1. Vérifier le draft GitHub Release
2. Publier manuellement
3. Attacher les binaires (.exe, .dmg) si disponibles

---

## Règles de bump

| Type | Quand | Exemple |
|---|---|---|
| PATCH | fix, perf, refactor (sans breaking change) | 1.0.0 → 1.0.1 |
| MINOR | feat rétrocompatible | 1.0.0 → 1.1.0 |
| MAJOR | breaking change (schéma DB, refonte IPC) | 1.0.0 → 2.0.0 |

> MAJOR bump : confirmation interactive obligatoire — validation `arch` + lead requise.

---

## Critères v1.0.0 (stable)

| Critère | Responsable | Statut |
|---|---|---|
| Session `doc` réalisée et validée (README, CONTRIBUTING, JSDoc minimal) | `doc` | ⬜ |
| Session `sécu` réalisée (audit OWASP, contextBridge, IPC, accès fichiers) | `arch` + `review` | ⬜ |
| 0 ticket `todo` / `in_progress` sur doc et sécu | `review-master` | ⬜ |
| Build testé et fonctionnel (`npm run build` → installeur) | `devops` | ⬜ |
