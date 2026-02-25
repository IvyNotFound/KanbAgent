#!/bin/bash
set -e

# agent-viewer Release Script
# Usage: ./scripts/release.sh [patch|minor|major]

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

# Run pre-release checks
echo ""
echo "=== Pre-release Checks ==="
echo "Running npm install..."
npm install --silent 2>/dev/null

echo "Running build..."
npm run build

echo "Running lint..."
if ! npm run lint 2>&1 | grep -q "error\|warning\|0 warnings"; then
    echo "WARNING: Lint may have issues. Review above."
fi

# Bump version
echo ""
echo "=== Bumping Version ==="
NEW_VERSION=$(npm version "$BUMP_TYPE" --no-git-tag-version --allow-same-version)
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

# Generate conventional changelog and prepend to CHANGELOG.md
# Note: conventional-changelog-cli would be installed as devDependency
# For now, generate from git log
{
    echo "## [$NEW_VERSION] - $(date +%Y-%m-%d)"
    echo ""
    echo "### Changes"
    git log --pretty=format:"- %s (%h)" "v$CURRENT_VERSION"..HEAD 2>/dev/null || echo "- Initial release"
    echo ""
} > /tmp/changelog_entry.md

# Prepend entry to CHANGELOG.md
if [ -f CHANGELOG.md ]; then
    # Skip header lines when prepending
    head -6 CHANGELOG.md > /tmp/changelog_header.md
    cat /tmp/changelog_header.md /tmp/changelog_entry.md tail -n +7 CHANGELOG.md > /tmp/changelog_new.md
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

# Push to remote
echo ""
echo "=== Pushing ==="
git push origin main --tags

# Create GitHub Release
echo ""
echo "=== Creating GitHub Release ==="
# Extract changelog for this release
RELEASE_NOTES=$(sed -n '/## \[v'"$NEW_VERSION"'\]/,/## \[/p' CHANGELOG.md | head -20)
RELEASE_NOTES=$(echo "$RELEASE_NOTES" | sed 's/## \[v'"$NEW_VERSION"'\] - .*/## '"$NEW_VERSION"'/')

gh release create "v$NEW_VERSION" \
    --title "Release v$NEW_VERSION" \
    --notes "$RELEASE_NOTES" \
    --target main \
    --draft

echo ""
echo "=== Release v$NEW_VERSION Complete ==="
echo "Review the draft release at: https://github.com/$(gh repo --json name,owner --jq '.owner.login + "/" + .name')/releases"
echo "When ready, publish the release from the GitHub UI."
