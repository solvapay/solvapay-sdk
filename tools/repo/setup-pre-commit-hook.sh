#!/bin/bash
# Install husky git hooks (pre-commit regen + pre-push gen/manifest/parity checks).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if ! command -v pnpm &> /dev/null; then
  echo "pnpm is required" >&2
  exit 1
fi

pnpm add -D husky
pnpm exec husky

chmod +x .husky/pre-commit .husky/pre-push

echo "Husky hooks installed:"
echo "  pre-commit — pnpm gen (+ re-stage) when manifest/snapshot staged"
echo "  pre-push   — pnpm gen:check + manifest:check + parity:check"
echo ""
echo "CI pnpm gen:check remains the authoritative drift gate."
