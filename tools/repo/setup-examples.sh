#!/usr/bin/env bash
# Prepares this machine to run the example MCP servers (`pnpm test:examples:mcp`):
# installs the toolchains the examples need, then builds every SDK from this checkout.
#
#   pnpm setup:examples            install what is missing, then build
#   pnpm setup:examples --check    report only; install and build nothing
#
# macOS installs through Homebrew. On Linux nothing is installed: the script
# reports what is missing and stops.
set -euo pipefail

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RUBY_MIN="3.3.0"
UV_MIN="0.12.3"
WORKER_BUILD_LINE="0.8"
RUST_TARGETS="wasm32-unknown-unknown wasm32-wasip1"

OS="$(uname -s)"
HAVE_BREW=0
command -v brew >/dev/null 2>&1 && HAVE_BREW=1

MISSING=""
miss() { MISSING="${MISSING}  - $1
"; }

say() { printf '%s\n' "$*"; }
row() { printf '  %-22s %-9s %s\n' "$1" "$2" "$3"; }

# version_ge A B: true when version A >= version B.
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$2" ]
}

add_path() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) [ -d "$1" ] && PATH="$1:$PATH" ;;
  esac
  return 0
}

refresh_path() {
  add_path "$HOME/.cargo/bin"
  if [ "$HAVE_BREW" = 1 ]; then
    add_path "$(brew --prefix)/opt/ruby/bin"
  fi
  export PATH
}

brew_install() {
  if [ "$CHECK_ONLY" = 1 ]; then return 1; fi
  if [ "$HAVE_BREW" != 1 ]; then return 1; fi
  say "  installing $1 with Homebrew"
  brew install "$1" >/dev/null
  refresh_path
}

brew_upgrade() {
  if [ "$CHECK_ONLY" = 1 ] || [ "$HAVE_BREW" != 1 ]; then return 1; fi
  say "  upgrading $1 with Homebrew"
  brew upgrade "$1" >/dev/null || brew install "$1" >/dev/null
  refresh_path
}

ruby_version() { ruby -e 'print RUBY_VERSION' 2>/dev/null || true; }
uv_version() { uv --version 2>/dev/null | awk '{print $2}' || true; }

refresh_path

say "SolvaPay examples setup ($OS)"
say ""
say "Toolchain"

if [ "$OS" = "Darwin" ] && [ "$HAVE_BREW" != 1 ]; then
  row "homebrew" "missing" "install from https://brew.sh, then rerun"
  exit 1
fi

# Node and pnpm run this script's caller; report them for the record.
row "node" "ok" "$(node --version)"
row "pnpm" "ok" "$(pnpm --version)"

# Rust: rustup owns the toolchain pinned in rust-toolchain.toml.
if ! command -v rustup >/dev/null 2>&1; then
  if ! brew_install rustup; then miss "rustup (https://rustup.rs)"; fi
  if command -v rustup-init >/dev/null 2>&1 && ! command -v cargo >/dev/null 2>&1; then
    rustup-init -y --no-modify-path >/dev/null
    refresh_path
  fi
fi
if command -v cargo >/dev/null 2>&1; then
  row "cargo" "ok" "$(cargo --version)"
  for target in $RUST_TARGETS; do
    if rustup target list --installed 2>/dev/null | grep -qx "$target"; then
      row "rust target" "ok" "$target"
    elif [ "$CHECK_ONLY" = 1 ]; then
      row "rust target" "missing" "$target"
      miss "rust target $target"
    else
      rustup target add "$target" >/dev/null 2>&1
      row "rust target" "added" "$target"
    fi
  done
else
  row "cargo" "missing" "not on PATH"
  miss "cargo"
fi

# Go.
if ! command -v go >/dev/null 2>&1; then brew_install go || miss "go"; fi
command -v go >/dev/null 2>&1 && row "go" "ok" "$(go version | awk '{print $3}')" || row "go" "missing" ""

# Ruby 3.3+. The macOS system Ruby is 2.6; Homebrew's is keg-only, so this
# script and the examples suite put it on PATH themselves.
have="$(ruby_version)"
if [ -z "$have" ] || ! version_ge "$have" "$RUBY_MIN"; then
  brew_install ruby || true
  have="$(ruby_version)"
fi
if [ -n "$have" ] && version_ge "$have" "$RUBY_MIN"; then
  row "ruby" "ok" "$have ($(command -v ruby))"
  if ruby -e 'require "puma"' >/dev/null 2>&1; then
    row "puma gem" "ok" ""
  elif [ "$CHECK_ONLY" = 1 ]; then
    row "puma gem" "missing" ""
    miss "puma gem"
  else
    gem install puma --no-document >/dev/null
    row "puma gem" "installed" ""
  fi
else
  row "ruby" "missing" "found ${have:-none}, need >= $RUBY_MIN"
  miss "ruby >= $RUBY_MIN"
fi

# uv builds the Python SDK and runs both Python examples.
have="$(uv_version)"
if [ -z "$have" ]; then
  brew_install uv || true
elif ! version_ge "$have" "$UV_MIN"; then
  brew_upgrade uv || true
fi
have="$(uv_version)"
if [ -n "$have" ] && version_ge "$have" "$UV_MIN"; then
  row "uv" "ok" "$have"
else
  row "uv" "missing" "found ${have:-none}, need >= $UV_MIN"
  miss "uv >= $UV_MIN"
fi

# wasm-opt shrinks the WASM builds.
if ! command -v wasm-opt >/dev/null 2>&1; then brew_install binaryen || miss "wasm-opt (binaryen)"; fi
command -v wasm-opt >/dev/null 2>&1 && row "wasm-opt" "ok" "$(wasm-opt --version | head -n1)" || row "wasm-opt" "missing" ""

# worker-build compiles the Rust Workers example. Its line must match the
# example's `worker` crate, so it is pinned here and in the example's wrangler.jsonc.
if command -v cargo >/dev/null 2>&1; then
  have="$(worker-build --version 2>/dev/null | awk '{print $NF}' || true)"
  case "$have" in
    "$WORKER_BUILD_LINE".*) row "worker-build" "ok" "$have" ;;
    *)
      if [ "$CHECK_ONLY" = 1 ]; then
        row "worker-build" "missing" "found ${have:-none}, need $WORKER_BUILD_LINE.x"
        miss "worker-build $WORKER_BUILD_LINE.x"
      else
        say "  installing worker-build $WORKER_BUILD_LINE.x (compiles from source)"
        cargo install -q "worker-build@^$WORKER_BUILD_LINE"
        row "worker-build" "installed" "$(worker-build --version | awk '{print $NF}')"
      fi
      ;;
  esac
fi

say ""
if [ -n "$MISSING" ]; then
  say "Missing:"
  printf '%b' "$MISSING"
  [ "$CHECK_ONLY" = 1 ] && say "Run \`pnpm setup:examples\` to install and build." || say "Install the items above, then rerun."
  exit 1
fi

if [ "$CHECK_ONLY" = 1 ]; then
  say "Toolchain complete. Run \`pnpm setup:examples\` to build."
  exit 0
fi

say "Installing packages"
pnpm install --frozen-lockfile

say ""
say "Building every SDK"
pnpm build:all --native

say ""
say "Ready. Run: pnpm test:examples:mcp"
