#!/usr/bin/env bash
#
# Smoke-test a published SolvaPay preview.
#
# Creates a scratch directory, installs all 8 publishable packages from npm
# at the target version, then verifies:
#   - each package.json in node_modules reports the expected version
#   - the `preview` dist-tag points to the expected version (if target=preview)
#   - every public subpath export (./primitives, ./styles.css) resolves
#
# Does NOT execute package code, only resolves it — so missing peer deps
# (react, next, supabase-js) don't cause spurious failures.
#
# Usage:
#   ./scripts/verify-preview.sh                   # tests @preview dist-tag
#   ./scripts/verify-preview.sh 1.0.8-preview.1   # tests exact version

set -uo pipefail

TARGET="${1:-preview}"

PACKAGES=(
  "@solvapay/auth"
  "@solvapay/core"
  "@solvapay/next"
  "@solvapay/react"
  "@solvapay/react-supabase"
  "@solvapay/server"
  "@solvapay/supabase"
  "solvapay"
)

# Subpaths to check via require.resolve (export map verification)
RESOLVE_CHECKS=(
  "@solvapay/core"
  "@solvapay/auth"
  "@solvapay/server"
  "@solvapay/next"
  "@solvapay/react"
  "@solvapay/react/primitives"
  "@solvapay/react/styles.css"
  "@solvapay/react-supabase"
  "@solvapay/supabase"
)

echo "=== verify-preview: target = $TARGET ==="

# Resolve target to exact version via npm
RESOLVED=$(npm view "@solvapay/react@$TARGET" version 2>/dev/null | tail -1)
if [ -z "$RESOLVED" ]; then
  echo "error: no npm version found for @solvapay/react@$TARGET" >&2
  exit 1
fi
echo "resolved: $TARGET -> $RESOLVED"
echo ""

# If target is "preview", sanity-check that all 8 packages share the same
# preview dist-tag value
if [ "$TARGET" = "preview" ]; then
  echo "=== dist-tag sanity ==="
  TAG_DRIFT=0
  for pkg in "${PACKAGES[@]}"; do
    TAG=$(npm view "$pkg" dist-tags.preview 2>/dev/null | tail -1)
    if [ -z "$TAG" ]; then
      TAG="<none>"
    fi
    if [ "$TAG" = "$RESOLVED" ]; then
      echo "  ok:    $pkg @preview -> $TAG"
    else
      echo "  DRIFT: $pkg @preview -> $TAG (expected $RESOLVED)"
      TAG_DRIFT=1
    fi
  done
  echo ""
  if [ $TAG_DRIFT -ne 0 ]; then
    echo "warning: some packages have a different preview dist-tag. install may still work via exact version pin." >&2
    echo ""
  fi
fi

# Scratch dir
TMPDIR=$(mktemp -d -t solvapay-preview-verify-XXXXXX)
echo "=== scratch dir: $TMPDIR ==="
echo ""

cd "$TMPDIR"
cat > package.json <<EOF
{
  "name": "solvapay-preview-verify",
  "version": "0.0.0",
  "private": true
}
EOF

# Install all 8 packages at the resolved version plus react/react-dom peers
# so @solvapay/react's peer tree is quiet. We don't actually execute any
# package code, only resolve export maps, so other peers (next, supabase-js)
# are skipped intentionally.
INSTALL_ARGS=()
for pkg in "${PACKAGES[@]}"; do
  INSTALL_ARGS+=("$pkg@$RESOLVED")
done
INSTALL_ARGS+=("react@^19.0.0" "react-dom@^19.0.0")

echo "=== npm install ==="
echo "installing: ${PACKAGES[*]} (+ react, react-dom) at $RESOLVED"
if ! npm install "${INSTALL_ARGS[@]}" --no-audit --no-fund --loglevel=error 2>&1 | tail -20; then
  echo ""
  echo "ERROR: npm install failed" >&2
  echo "scratch dir kept for inspection: $TMPDIR" >&2
  exit 1
fi
echo "  install succeeded"
echo ""

# Version sanity: each installed package.json should match the resolved version
echo "=== installed version sanity ==="
VERSION_FAIL=0
for pkg in "${PACKAGES[@]}"; do
  PKG_JSON="node_modules/$pkg/package.json"
  if [ ! -f "$PKG_JSON" ]; then
    echo "  MISSING: $PKG_JSON"
    VERSION_FAIL=1
    continue
  fi
  V=$(node -p "require('./$PKG_JSON').version")
  if [ "$V" = "$RESOLVED" ]; then
    echo "  ok: $pkg $V"
  else
    echo "  WRONG: $pkg $V (expected $RESOLVED)"
    VERSION_FAIL=1
  fi
done
echo ""

# Subpath resolution
echo "=== subpath export resolution ==="
RESOLVE_FAIL=0
for target in "${RESOLVE_CHECKS[@]}"; do
  if node -e "require.resolve('$target')" 2>/dev/null; then
    echo "  ok: require.resolve('$target')"
  else
    echo "  FAIL: require.resolve('$target')"
    RESOLVE_FAIL=1
  fi
done
echo ""

echo "=== scratch dir kept at: $TMPDIR ==="
echo "cd $TMPDIR  # to inspect or ad-hoc test"
echo ""

if [ $VERSION_FAIL -ne 0 ] || [ $RESOLVE_FAIL -ne 0 ]; then
  echo "verification FAILED" >&2
  exit 1
fi

echo "all checks passed. $RESOLVED is installable and exports resolve."
