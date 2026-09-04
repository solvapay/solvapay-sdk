#!/usr/bin/env bash
# Cross-compile a platform gem via rb-sys-dock with the cargo workspace mounted
# so path deps (solvapay-core/dto/transport) resolve inside the container.
#
# Magnus 0.8 is the working Temporal pattern
# (temporalio/sdk-ruby `.github/workflows/build-gems.yml`). Gemfile.lock
# pins `rb_sys 0.9.128`, so `rbsys/*:0.9.128` is the image in use.
# Magnus 0.8 builds against that image's cross rubies; the old blocker
# was Magnus 0.7.
#
# rust-toolchain.toml pins the workspace to 1.96.0. `--mount-toolchains`
# only installs cross std onto the container's default stable toolchain,
# so cargo still cannot find `core` for aarch64/Darwin. Derive the rust
# triple from the pinned rb_sys gem and `rustup target add` it inside
# the container so rustup honours the pin.
#
# Windows `x64-mingw-ucrt` stays source-gem-only: the dock mingw image still
# fails rb-sys/bindgen inside LLVM AVX10.2/AMX headers (same as Temporal).
set -euo pipefail

platform="${1:?usage: dock-build.sh <rb-sys-platform> [ruby-versions]}"
ruby_versions="${2:-3.1:3.2:3.3:3.4}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
gem_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$gem_dir/../.." && pwd)"

rust_target="$(bundle exec --gemfile "$gem_dir/Gemfile" ruby \
  -rrb_sys -e 'puts RbSys::ToolchainInfo.new(ARGV[0]).rust_target' "$platform")"

cd "$repo_root"
bundle exec --gemfile "$gem_dir/Gemfile" rb-sys-dock \
  --platform "$platform" \
  --ruby-versions "$ruby_versions" \
  --directory "$repo_root" \
  --mount-toolchains \
  -- \
  "rustup target add ${rust_target} && cd sdks/ruby && bundle install && bundle exec rake native:${platform} gem"
