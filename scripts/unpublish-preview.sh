#!/usr/bin/env bash
#
# Unpublish a SolvaPay preview version from npm across all publishable packages.
#
# Self-service unpublish works for versions less than 72h old. Older versions
# require an npm support ticket. Once unpublished, that exact version string
# is permanently blocked from being republished.
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
#   ./scripts/unpublish-preview.sh <version>
#
# Example:
#   ./scripts/unpublish-preview.sh 1.0.9-preview.1

set -uo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "error: version required" >&2
  echo "" >&2
  echo "usage:   $0 <version>" >&2
  echo "example: $0 1.0.9-preview.1" >&2
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
TO_UNPUBLISH=()
for pkg in "${PACKAGES[@]}"; do
  if npm view "$pkg@$VERSION" version > /dev/null 2>&1; then
    TO_UNPUBLISH+=("$pkg")
    echo "  found: $pkg@$VERSION"
  else
    echo "  skip:  $pkg (no $VERSION on npm)"
  fi
done
echo ""

if [ ${#TO_UNPUBLISH[@]} -eq 0 ]; then
  echo "nothing to unpublish."
  exit 0
fi

echo "=== Plan ==="
echo "will unpublish $VERSION from ${#TO_UNPUBLISH[@]} package(s):"
for pkg in "${TO_UNPUBLISH[@]}"; do
  echo "  - $pkg@$VERSION"
done
echo ""
read -r -p "proceed? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "aborted."
  exit 0
fi
echo ""

# Probe auth mode: try the first unpublish without an OTP. If the token has
# "Bypass 2FA" enabled, all subsequent unpublishes also skip the OTP prompt.
# If npm demands an OTP, fall back to the interactive TOTP path.
FIRST_PKG="${TO_UNPUBLISH[0]}"
echo "=== Probing auth mode on $FIRST_PKG ==="
PROBE_OUTPUT=$(npm unpublish "$FIRST_PKG@$VERSION" 2>&1)
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
  echo "  TIP: if you expected the token to bypass 2FA, check that"
  echo "       'Bypass 2FA for publishing' was enabled when the token was"
  echo "       created. See: https://www.npmjs.com/settings/<user>/tokens"
  echo ""
elif echo "$PROBE_OUTPUT" | grep -qi "E405\|has dependent packages\|no longer unpublish"; then
  echo "  npm response:"
  echo "$PROBE_OUTPUT" | grep -v '^npm warn' | sed 's/^/    /'
  echo ""
  echo "npm blocks unpublishing these versions because they depend on each other" >&2
  echo "in the registry (cross-package refs within @solvapay/*)." >&2
  echo "" >&2
  echo "Run the deprecate script instead:" >&2
  echo "  ./scripts/deprecate-version.sh $VERSION \"<reason>\"" >&2
  echo "" >&2
  echo "Deprecation keeps versions installable by exact pin but shows a warning." >&2
  echo "For your use case, the new publish's --tag preview still re-points the" >&2
  echo "preview dist-tag; deprecation is only for hygiene." >&2
  exit 1
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

  # Retry the first package with OTP
  echo "=== Unpublishing $FIRST_PKG with OTP ==="
  if npm unpublish "$FIRST_PKG@$VERSION" --otp="$OTP" 2>&1 | sed 's/^/  /'; then
    :
  else
    FAILED+=("$FIRST_PKG")
  fi
  echo ""
fi

echo "=== Unpublishing remaining packages ==="
for pkg in "${TO_UNPUBLISH[@]:1}"; do
  echo "unpublishing $pkg@$VERSION..."
  if [ "$NEEDS_OTP" = true ]; then
    if npm unpublish "$pkg@$VERSION" --otp="$OTP" 2>&1 | sed 's/^/  /'; then
      :
    else
      FAILED+=("$pkg")
    fi
  else
    if npm unpublish "$pkg@$VERSION" 2>&1 | sed 's/^/  /'; then
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
    if npm unpublish "$pkg@$VERSION" --otp="$OTP" 2>&1 | sed 's/^/  /'; then
      :
    else
      RETRY_FAILED+=("$pkg")
    fi
  done
  FAILED=("${RETRY_FAILED[@]+"${RETRY_FAILED[@]}"}")
  echo ""
fi

echo "=== Verification ==="
STILL_EXISTS=()
for pkg in "${TO_UNPUBLISH[@]}"; do
  if npm view "$pkg@$VERSION" version > /dev/null 2>&1; then
    echo "  STILL EXISTS: $pkg@$VERSION"
    STILL_EXISTS+=("$pkg")
  else
    echo "  gone: $pkg@$VERSION"
  fi
done
echo ""

if [ ${#STILL_EXISTS[@]} -gt 0 ]; then
  echo "ERROR: ${#STILL_EXISTS[@]} package(s) still resolve for $VERSION on npm:" >&2
  for pkg in "${STILL_EXISTS[@]}"; do
    echo "  - $pkg@$VERSION" >&2
  done
  exit 1
fi

echo "all $VERSION versions successfully unpublished."
