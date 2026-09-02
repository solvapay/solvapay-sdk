#!/usr/bin/env bash
# Cross-compile a platform gem via rb-sys-dock with the cargo workspace mounted
# so path deps (solvapay-core/dto/transport) resolve inside the container.
#
# Magnus 0.8 + `--mount-toolchains` is the working Temporal pattern
# (temporalio/sdk-ruby `.github/workflows/build-gems.yml`). The older
# `rbsys/*:0.9.128` + Magnus 0.7 combination shipped a Ruby 4.0 host with
# incomplete 3.3 toolchains and is no longer the recorded path.
#
# Windows `x64-mingw-ucrt` stays source-gem-only: the dock mingw image still
# fails rb-sys/bindgen inside LLVM AVX10.2/AMX headers (same as Temporal).
set -euo pipefail

platform="${1:?usage: dock-build.sh <rb-sys-platform>}"
ruby_versions="${2:-3.3}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
gem_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$gem_dir/../.." && pwd)"

cd "$repo_root"
bundle exec --gemfile "$gem_dir/Gemfile" rb-sys-dock \
  --platform "$platform" \
  --ruby-versions "$ruby_versions" \
  --directory "$repo_root" \
  --mount-toolchains \
  -- \
  "cd sdks/ruby && bundle install && RUBY_CC_VERSION=${ruby_versions} bundle exec rake native:${platform} gem"
