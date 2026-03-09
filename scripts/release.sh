#!/bin/bash
set -e

# KanbAgent Release Script
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
npm install --silent

echo "Checking i18n completeness..."
node scripts/check-i18n.js || { echo "ERROR: i18n check failed. Fix missing keys before releasing."; exit 1; }

echo "Running ESLint..."
npm run lint || { echo "ERROR: ESLint found errors. Fix lint issues before releasing."; exit 1; }

echo "CI E2E and i18n checks will run automatically in the release pipeline after push."

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

    REPO=$(gh repo --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo '')
    COMMITS=$(git log --pretty=format:"%s|||%h" "v$CURRENT_VERSION"..HEAD 2>/dev/null)

    format_commit() {
        if [ -n "$REPO" ]; then
            sed "s/|||/ ([/;s|$|](https://github.com/$REPO/commit/\0))|" | sed 's|\[.*\](.*\(.\{40\}\).*)| [\1]|'
            # simpler: just linkify the hash
        fi
    }

    print_section() {
        local title="$1"; local pattern="$2"
        local lines
        if [ -n "$REPO" ]; then
            lines=$(echo "$COMMITS" | grep -E "^$pattern" | \
                sed 's/\(.*\)|||\([0-9a-f]*\)/- \1 ([\2](https:\/\/github.com\/'"$REPO"'\/commit\/\2))/')
        else
            lines=$(echo "$COMMITS" | grep -E "^$pattern" | sed "s/|||/ (/;s/$/)/" | sed 's/^/- /')
        fi
        if [ -n "$lines" ]; then
            echo "### $title"
            echo "$lines"
            echo ""
        fi
    }

    if [ -z "$COMMITS" ]; then
        echo "### Changes"
        echo "- Initial release"
        echo ""
    else
        print_section "Features"       "feat"
        print_section "Bug Fixes"      "fix"
        print_section "Performance"    "perf"
        print_section "Refactoring"    "refactor"
        print_section "Tests"          "test"
        print_section "CI"             "ci"
        print_section "Documentation"  "docs"
        print_section "Chores"         "chore"
        # Catch-all for commits that don't follow conventional format
        if [ -n "$REPO" ]; then
            OTHER=$(echo "$COMMITS" | grep -vE "^(feat|fix|perf|refactor|test|ci|docs|chore)" | \
                sed 's/\(.*\)|||\([0-9a-f]*\)/- \1 ([\2](https:\/\/github.com\/'"$REPO"'\/commit\/\2))/')
        else
            OTHER=$(echo "$COMMITS" | grep -vE "^(feat|fix|perf|refactor|test|ci|docs|chore)" | sed "s/|||/ (/;s/$/)/" | sed 's/^/- /')
        fi
        if [ -n "$OTHER" ]; then
            echo "### Other"
            echo "$OTHER"
            echo ""
        fi
    fi
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
REPO=$(gh repo --json name,owner --jq '.owner.login + "/" + .name' 2>/dev/null || echo 'your-org/KanbAgent')
echo "Pipeline: i18n-check → E2E → build (win/mac/linux) → publish"
echo "Monitor: https://github.com/$REPO/actions"
echo "The GitHub Release will be published automatically when all jobs pass."
