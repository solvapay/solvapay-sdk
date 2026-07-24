#!/usr/bin/env bash
# Cross-compile a platform gem via rb-sys-dock with the rust/ workspace mounted
# so path deps (solvapay-core/dto/transport) resolve inside the container.
#
# NOTE (Step 43): current `rbsys/*:0.9.128` images expose a Ruby 4.0 host and
# incomplete 3.3 toolchains; Magnus 0.7 fails to compile against those bindings.
# Prefer native `rake native gem` on CI hosts for the scaffold. Revisit at
# Step 45 once the dock image / Magnus stack align.
set -euo pipefail

platform="${1:?usage: dock-build.sh <rb-sys-platform>}"
ruby_versions="${2:-3.1}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
gem_dir="$(cd "$script_dir/.." && pwd)"
rust_dir="$(cd "$gem_dir/../.." && pwd)"

cd "$rust_dir"
bundle exec --gemfile "$gem_dir/Gemfile" rb-sys-dock \
  --platform "$platform" \
  --ruby-versions "$ruby_versions" \
  --directory "$rust_dir" \
  -- \
  "cd bindings/ruby && bundle install && RUBY_CC_VERSION=${ruby_versions} bundle exec rake native:${platform} gem"
