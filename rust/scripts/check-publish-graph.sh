#!/usr/bin/env bash
# Step 48 — validate crates.io publish graph metadata before first index upload.
#
# Leaf crate `solvapay-dto` can `cargo publish --dry-run` today. Dependents
# (`solvapay-core` → `solvapay-transport` → `solvapay`) resolve versioned deps
# from crates.io, so full dry-run verify only works after those crates exist.
# This script locks the local graph shape so the publish train stays packageable.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "check-publish-graph: $*" >&2
  exit 1
}

check_crate() {
  local crate="$1"
  local toml="crates/${crate}/Cargo.toml"
  [[ -f "$toml" ]] || fail "missing $toml"

  grep -Eq '^publish = true' "$toml" || fail "$crate: publish must be true"
  grep -Eq '^version = "' "$toml" || fail "$crate: missing version"
  grep -Eq '^description = "' "$toml" || fail "$crate: missing description"
  grep -Eq '^readme = "README.md"' "$toml" || fail "$crate: missing readme"
  grep -Eq 'repository\.workspace = true' "$toml" || fail "$crate: missing repository.workspace"
  [[ -f "crates/${crate}/README.md" ]] || fail "$crate: README.md missing"
}

check_versioned_path_dep() {
  local crate="$1"
  local dep="$2"
  local toml="crates/${crate}/Cargo.toml"
  # e.g. solvapay-dto = { path = "../solvapay-dto", version = "0.1.0" }
  grep -Eq "${dep} = \{ path = \"../${dep}\", version = \"[^\"]+\" \}" "$toml" \
    || fail "$crate: ${dep} must be path+version"
}

check_crate solvapay-dto
check_crate solvapay-core
check_crate solvapay-transport
check_crate solvapay

check_versioned_path_dep solvapay-core solvapay-dto
check_versioned_path_dep solvapay-transport solvapay-dto
check_versioned_path_dep solvapay-transport solvapay-core
check_versioned_path_dep solvapay solvapay-dto
check_versioned_path_dep solvapay solvapay-core
check_versioned_path_dep solvapay solvapay-transport

# Non-published workspace members must stay unpublished.
for toml in \
  bindings/node/Cargo.toml \
  bindings/wasm/Cargo.toml \
  bindings/python/Cargo.toml \
  bindings/ruby/ext/solvapay/Cargo.toml \
  tools/dto-gen/Cargo.toml \
  tools/fixture-runner/Cargo.toml \
  tools/shadow-invoker/Cargo.toml \
  tools/live-contract/Cargo.toml
do
  grep -Eq '^publish = false' "$toml" || fail "$toml: expected publish = false"
done

echo "OK: publish graph metadata for solvapay-dto → core → transport → solvapay"
