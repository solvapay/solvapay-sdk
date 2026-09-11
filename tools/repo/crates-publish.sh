#!/usr/bin/env bash
# Idempotent crates.io / local-registry publish in train order.
# Probes the index first; skips an already-published crate+version; fails
# on any other error. Never swallows a dry-run or publish failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CRATES=(solvapay-export solvapay-dto solvapay-core solvapay-mcp-core solvapay-transport solvapay)
DRY_RUN=false
REGISTRY=""
VERSION="${SOLVAPAY_RELEASE_VERSION:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --registry) REGISTRY="${2:?}"; shift 2 ;;
    --version) VERSION="${2:?}"; shift 2 ;;
    *) echo "crates-publish: unknown arg $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "crates-publish: --version or SOLVAPAY_RELEASE_VERSION is required" >&2
  exit 1
fi

registry_args=()
search_args=()
if [[ -n "$REGISTRY" ]]; then
  registry_args+=(--registry "$REGISTRY")
  search_args+=(--registry "$REGISTRY")
fi

already_published() {
  local crate="$1"
  local version="$2"
  cargo search "$crate" "${search_args[@]}" --limit 1 2>/dev/null \
    | grep -q "^${crate} = \"${version}\""
}

for crate in "${CRATES[@]}"; do
  if already_published "$crate" "$VERSION"; then
    echo "crates-publish: skip ${crate}@${VERSION} (already on index)"
    continue
  fi
  if [[ "$DRY_RUN" == true ]]; then
    echo "crates-publish: dry-run ${crate}@${VERSION}"
    cargo publish -p "$crate" --dry-run --allow-dirty "${registry_args[@]}"
  else
    echo "crates-publish: publish ${crate}@${VERSION}"
    cargo publish -p "$crate" --allow-dirty "${registry_args[@]}"
  fi
done
