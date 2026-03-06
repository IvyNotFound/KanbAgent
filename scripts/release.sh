#!/bin/bash
set -e

# agent-viewer Release Script
# Usage: ./scripts/release.sh [patch|minor|major]
#
# This script bumps the version, generates CHANGELOG, commits and tags,
# then pushes to trigger GitHub Actions (which handles all builds and release creation).

BUMP_TYPE="${1:-patch}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo "=== Release Workflow ==="
echo "Current version: $CURRENT_VERSION"
echo "Bump type: $BUMP_TYPE"
echo "Branch: $BRANCH"

# Check we're on main
if [ "$BRANCH" != "main" ]; then
    echo "ERROR: Must be on 'main' branch to release. Current: $BRANCH"
    exit 1
fi

# Check working tree is clean
if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: Working tree is not clean. Commit or stash changes first."
    git status --short
    exit 1
fi

# Check for unmerged upstream commits
git fetch origin main 2>/dev/null || true
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main 2>/dev/null)" ]; then
    echo "WARNING: Local main is not up to date with origin/main"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "=== Pre-release Checks ==="
echo "Running npm install..."
npm install --silent 2>/dev/null

echo "Checking i18n completeness..."
node scripts/check-i18n.js || { echo "ERROR: i18n check failed. Fix missing keys before releasing."; exit 1; }

echo "Checking CI status on HEAD..."
HEAD_SHA=$(git rev-parse HEAD)

# Block if ANY workflow is still running on HEAD
PENDING_RUNS=$(gh run list --branch=main --limit=20 --json headSha,status,workflowName \
  --jq "[.[] | select(.headSha == \"$HEAD_SHA\") | select(.status == \"in_progress\" or .status == \"queued\")] | map(.workflowName) | join(\", \")")
if [ -n "$PENDING_RUNS" ]; then
  echo "ERROR: Workflows still running on HEAD ($HEAD_SHA): $PENDING_RUNS"
  echo "Wait for all CI runs to complete before releasing."
  exit 1
fi

# Require E2E success
E2E_STATUS=$(gh run list --workflow=e2e.yml --branch=main --limit=5 --json headSha,conclusion,status \
  --jq "[.[] | select(.headSha == \"$HEAD_SHA\")] | if length == 0 then \"not_found\" elif all(.[]; .conclusion == \"success\") then \"success\" else \"failure\" end")

case "$E2E_STATUS" in
  success)
    echo "CI E2E tests passed on HEAD."
    ;;
  not_found)
    echo "WARNING: No CI E2E run found for HEAD ($HEAD_SHA)."
    read -p "No CI run found — release anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi
    ;;
  *)
    echo "ERROR: CI E2E tests FAILED on HEAD ($HEAD_SHA). Fix tests before releasing."
    gh run list --workflow=e2e.yml --branch=main --limit=3
    exit 1
    ;;
esac

# Warn (non-blocking) if mutation tests failed
MUTATION_STATUS=$(gh run list --workflow=mutation.yml --branch=main --limit=5 --json headSha,conclusion,status \
  --jq "[.[] | select(.headSha == \"$HEAD_SHA\")] | if length == 0 then \"not_found\" elif all(.[]; .conclusion == \"success\") then \"success\" else \"failure\" end")
if [ "$MUTATION_STATUS" = "failure" ]; then
  echo "WARNING: Mutation tests failed on HEAD ($HEAD_SHA). Review score before releasing."
fi

# Bump version
echo ""
echo "=== Bumping Version ==="
NEW_VERSION=$(npm version "$BUMP_TYPE" --no-git-tag-version --allow-same-version)
# Strip leading 'v' prefix from npm version output to avoid double-v (vv0.x.0)
NEW_VERSION="${NEW_VERSION#v}"
echo "New version: $NEW_VERSION"

# Generate/update CHANGELOG.md
echo ""
echo "=== Generating CHANGELOG.md ==="
if [ ! -f CHANGELOG.md ]; then
    echo "# Changelog" > CHANGELOG.md
    echo "" >> CHANGELOG.md
    echo "All notable changes to this project will be documented in this file." >> CHANGELOG.md
    echo "" >> CHANGELOG.md
fi

{
    echo "## [$NEW_VERSION] - $(date +%Y-%m-%d)"
    echo ""
    echo "### Changes"
    git log --pretty=format:"- %s (%h)" "v$CURRENT_VERSION"..HEAD 2>/dev/null || echo "- Initial release"
    echo ""
} > /tmp/changelog_entry.md

if [ -f CHANGELOG.md ]; then
    head -6 CHANGELOG.md > /tmp/changelog_header.md
    { cat /tmp/changelog_header.md /tmp/changelog_entry.md; tail -n +7 CHANGELOG.md; } > /tmp/changelog_new.md
    mv /tmp/changelog_new.md CHANGELOG.md
else
    cat > CHANGELOG.md << 'EOF'
# Changelog

All notable changes to this project will be documented in this file.

EOF
    cat /tmp/changelog_entry.md >> CHANGELOG.md
fi

echo "CHANGELOG.md updated"

# Commit version bump
echo ""
echo "=== Committing ==="
git add -A
git commit -m "release: v$NEW_VERSION"

# Create annotated tag
echo ""
echo "=== Creating Tag ==="
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

# Push to remote (triggers GitHub Actions release workflow)
echo ""
echo "=== Pushing ==="
git push origin main --tags

echo ""
echo "=== Release v$NEW_VERSION Triggered ==="
echo "GitHub Actions will now:"
echo "  1. Build installers for Windows, macOS, and Linux"
echo "  2. Create a draft GitHub Release with all installers attached"
echo ""
REPO=$(gh repo --json name,owner --jq '.owner.login + "/" + .name' 2>/dev/null || echo 'your-org/agent-viewer')
echo "Monitor the build at: https://github.com/$REPO/actions"
echo "When builds complete, publish the draft release from the GitHub UI."
