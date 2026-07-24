#!/usr/bin/env bash
# Builds the WASI guest and writes the artifact under the Go module.
#
#   rust/bindings/go/scripts/build-wasm.sh
#
# Steps:
#   1. cargo build -p solvapay-go-wasm --target wasm32-wasip1 --profile wasm-release
#   2. wasm-opt -Oz (if available) → rust/bindings/go/solvapay_core.wasm
#      Falls back to copying the cargo artifact verbatim when wasm-opt is missing.
#
# Note: cargo's wasm32-wasip1 output is not bit-stable across hosts. Prefer
# regenerating on linux/amd64 (see go-binding CI job) before committing, and do
# not install wasm-opt if you need the blob to match CI (CI has no binaryen).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
go_dir="$(cd "${script_dir}/.." && pwd)"          # rust/bindings/go
rust_dir="$(cd "${go_dir}/../.." && pwd)"          # rust

crate="solvapay-go-wasm"
target="wasm32-wasip1"
profile="wasm-release"
out="${go_dir}/solvapay_core.wasm"

echo "==> Building ${crate} for ${target} (${profile})"
( cd "${rust_dir}" && cargo build -p "${crate}" --target "${target}" --profile "${profile}" )

# Resolve the target directory (respects CARGO_TARGET_DIR / sandbox overrides).
target_dir="$(cd "${rust_dir}" && cargo metadata --format-version 1 --no-deps \
  | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"
target_dir="${target_dir:-${rust_dir}/target}"
built="${target_dir}/${target}/${profile}/${crate//-/_}.wasm"

if [[ ! -f "${built}" ]]; then
  echo "error: expected artifact not found at ${built}" >&2
  exit 1
fi

if command -v wasm-opt >/dev/null 2>&1; then
  echo "==> Optimizing with wasm-opt -Oz"
  wasm-opt -Oz --enable-bulk-memory -o "${out}" "${built}"
else
  echo "==> wasm-opt not found; committing the cargo artifact verbatim"
  echo "    (install binaryen for a smaller module: https://github.com/WebAssembly/binaryen)"
  cp "${built}" "${out}"
fi

echo "==> Wrote ${out} ($(wc -c < "${out}") bytes)"
