#!/usr/bin/env bash
#
# Deprecate a SolvaPay version on npm across all publishable packages.
#
# Use when npm refuses to unpublish (E405: has dependent packages in the registry).
# Deprecated versions stay installable by exact pin but display a warning to
# anyone who runs `npm install` against them.
#
# Covers all 8 publishable packages: @solvapay/{auth,core,next,react,react-supabase,server,supabase}
# and the flagship `solvapay` (from packages/cli). Packages that don't have the
# requested version on npm are skipped automatically.
#
# Auth modes:
#   1. Granular access token with "Bypass 2FA" enabled (set in ~/.npmrc) - no prompt
#   2. Authenticator-app TOTP - interactive OTP prompt
#
# Usage:
#   ./scripts/deprecate-version.sh <version> "<reason>"
#
# Example:
#   ./scripts/deprecate-version.sh 1.0.9-preview.1 "orphaned preview - use @preview tag"

set -uo pipefail

VERSION="${1:-}"
REASON="${2:-}"

if [ -z "$VERSION" ] || [ -z "$REASON" ]; then
  echo "error: version and reason required" >&2
  echo "" >&2
  echo "usage:   $0 <version> \"<reason>\"" >&2
  echo "example: $0 1.0.9-preview.1 \"orphaned preview - use @preview tag\"" >&2
  exit 1
fi

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

echo "=== Pre-flight ==="
if ! npm whoami > /dev/null 2>&1; then
  echo "error: not logged in to npm. run: npm login" >&2
  exit 1
fi
echo "logged in as: $(npm whoami)"
echo ""

echo "=== Discovery: checking which packages have $VERSION on npm ==="
TO_DEPRECATE=()
for pkg in "${PACKAGES[@]}"; do
  if npm view "$pkg@$VERSION" version > /dev/null 2>&1; then
    TO_DEPRECATE+=("$pkg")
    echo "  found: $pkg@$VERSION"
  else
    echo "  skip:  $pkg (no $VERSION on npm)"
  fi
done
echo ""

if [ ${#TO_DEPRECATE[@]} -eq 0 ]; then
  echo "nothing to deprecate."
  exit 0
fi

echo "=== Plan ==="
echo "will deprecate $VERSION on ${#TO_DEPRECATE[@]} package(s):"
for pkg in "${TO_DEPRECATE[@]}"; do
  echo "  - $pkg@$VERSION"
done
echo "reason: \"$REASON\""
echo ""
read -r -p "proceed? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "aborted."
  exit 0
fi
echo ""

# Probe auth mode on first package
FIRST_PKG="${TO_DEPRECATE[0]}"
echo "=== Probing auth mode on $FIRST_PKG ==="
PROBE_OUTPUT=$(npm deprecate "$FIRST_PKG@$VERSION" "$REASON" 2>&1)
PROBE_EXIT=$?

NEEDS_OTP=false
FAILED=()

if [ $PROBE_EXIT -eq 0 ]; then
  echo "  ok (token bypasses 2FA)"
  echo ""
elif echo "$PROBE_OUTPUT" | grep -qiE "one-time password|otp required|two-factor authentication|authenticator"; then
  NEEDS_OTP=true
  echo "  npm response:"
  echo "$PROBE_OUTPUT" | grep -v '^npm warn' | sed 's/^/    /'
  echo ""
  echo "  token does not bypass 2FA. falling back to interactive OTP."
  echo ""
else
  echo "  unexpected probe failure (exit $PROBE_EXIT):"
  echo "$PROBE_OUTPUT" | sed 's/^/    /'
  echo ""
  echo "error: aborting." >&2
  exit 1
fi

OTP=""
if [ "$NEEDS_OTP" = true ]; then
  read -r -p "npm 2FA code (TOTP from authenticator app): " OTP
  if [ -z "$OTP" ]; then
    echo "error: OTP required" >&2
    exit 1
  fi
  echo ""

  echo "=== Deprecating $FIRST_PKG with OTP ==="
  if npm deprecate "$FIRST_PKG@$VERSION" "$REASON" --otp="$OTP" 2>&1 | sed 's/^/  /'; then
    :
  else
    FAILED+=("$FIRST_PKG")
  fi
  echo ""
fi

echo "=== Deprecating remaining packages ==="
for pkg in "${TO_DEPRECATE[@]:1}"; do
  echo "deprecating $pkg@$VERSION..."
  if [ "$NEEDS_OTP" = true ]; then
    if npm deprecate "$pkg@$VERSION" "$REASON" --otp="$OTP" 2>&1 | sed 's/^/  /'; then
      :
    else
      FAILED+=("$pkg")
    fi
  else
    if npm deprecate "$pkg@$VERSION" "$REASON" 2>&1 | sed 's/^/  /'; then
      :
    else
      FAILED+=("$pkg")
    fi
  fi
done
echo ""

if [ ${#FAILED[@]} -gt 0 ] && [ "$NEEDS_OTP" = true ]; then
  echo "=== Retry ==="
  echo "${#FAILED[@]} package(s) failed (likely OTP expired mid-loop):"
  for pkg in "${FAILED[@]}"; do
    echo "  - $pkg"
  done
  echo ""
  read -r -p "fresh npm 2FA code: " OTP
  echo ""

  RETRY_FAILED=()
  for pkg in "${FAILED[@]}"; do
    echo "retrying $pkg@$VERSION..."
    if npm deprecate "$pkg@$VERSION" "$REASON" --otp="$OTP" 2>&1 | sed 's/^/  /'; then
      :
    else
      RETRY_FAILED+=("$pkg")
    fi
  done
  FAILED=("${RETRY_FAILED[@]+"${RETRY_FAILED[@]}"}")
  echo ""
fi

# Verify
echo "=== Verification ==="
NOT_DEPRECATED=()
for pkg in "${TO_DEPRECATE[@]}"; do
  DEPRECATED_MSG=$(npm view "$pkg@$VERSION" deprecated 2>/dev/null || true)
  if [ -n "$DEPRECATED_MSG" ]; then
    echo "  deprecated: $pkg@$VERSION"
  else
    echo "  NOT DEPRECATED: $pkg@$VERSION"
    NOT_DEPRECATED+=("$pkg")
  fi
done
echo ""

if [ ${#NOT_DEPRECATED[@]} -gt 0 ]; then
  echo "ERROR: ${#NOT_DEPRECATED[@]} package(s) were not deprecated:" >&2
  for pkg in "${NOT_DEPRECATED[@]}"; do
    echo "  - $pkg@$VERSION" >&2
  done
  exit 1
fi

echo "all $VERSION versions successfully deprecated."
