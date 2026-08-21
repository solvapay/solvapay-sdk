#!/usr/bin/env bash
# Step 48 — validate crates.io publish graph metadata before first index upload.
#
# Leaf crate `solvapay-dto` can `cargo publish --dry-run` today. Dependents
# (`solvapay-core` → `solvapay-transport` → `solvapay`) resolve versioned deps
# from crates.io, so full dry-run verify only works after those crates exist.
# This script locks the local graph shape so the publish train stays packageable.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "check-publish-graph: $*" >&2
  exit 1
}

check_crate() {
  local crate="$1"
  local dir="$2"
  local toml="${dir}/Cargo.toml"
  [[ -f "$toml" ]] || fail "missing $toml"

  grep -Eq '^publish = true' "$toml" || fail "$crate: publish must be true"
  grep -Eq '^version = "' "$toml" || fail "$crate: missing version"
  grep -Eq '^description = "' "$toml" || fail "$crate: missing description"
  grep -Eq '^readme = "README.md"' "$toml" || fail "$crate: missing readme"
  grep -Eq 'repository\.workspace = true' "$toml" || fail "$crate: missing repository.workspace"
  [[ -f "${dir}/README.md" ]] || fail "$crate: README.md missing"
}

check_versioned_path_dep() {
  local toml="$1"
  local dep="$2"
  local path="$3"
  grep -Eq "${dep} = \{ path = \"${path}\", version = \"[^\"]+\" \}" "$toml" \
    || fail "${toml}: ${dep} must be path+version (${path})"
}

check_crate solvapay-dto core/solvapay-dto
check_crate solvapay-core core/solvapay-core
check_crate solvapay-transport core/solvapay-transport
check_crate solvapay sdks/rust

check_versioned_path_dep core/solvapay-core/Cargo.toml solvapay-dto "../solvapay-dto"
check_versioned_path_dep core/solvapay-transport/Cargo.toml solvapay-dto "../solvapay-dto"
check_versioned_path_dep core/solvapay-transport/Cargo.toml solvapay-core "../solvapay-core"
check_versioned_path_dep sdks/rust/Cargo.toml solvapay-dto "../../core/solvapay-dto"
check_versioned_path_dep sdks/rust/Cargo.toml solvapay-core "../../core/solvapay-core"
check_versioned_path_dep sdks/rust/Cargo.toml solvapay-transport "../../core/solvapay-transport"

# Non-published workspace members must stay unpublished.
for toml in \
  sdks/node-native/Cargo.toml \
  sdks/wasm/Cargo.toml \
  sdks/python/Cargo.toml \
  sdks/ruby/ext/solvapay/Cargo.toml \
  sdks/go/wasm/Cargo.toml \
  sdks/capi/Cargo.toml \
  tools/codegen/dto-gen/Cargo.toml \
  tools/conformance/fixture-runner/Cargo.toml \
  tools/conformance/shadow-invoker/Cargo.toml \
  tools/conformance/live-contract/Cargo.toml \
  tools/shared/repo-paths/Cargo.toml
do
  grep -Eq '^publish = false' "$toml" || fail "$toml: expected publish = false"
done

echo "OK: publish graph metadata for solvapay-dto → core → transport → solvapay"
