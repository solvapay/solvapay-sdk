#!/usr/bin/env bash
# Cross-compile a platform gem via rb-sys-dock with the cargo workspace mounted
# so path deps (solvapay-core/dto/transport) resolve inside the container.
#
# Recorded decision: do not invoke this script from CI or publish.
# Current `rbsys/*:0.9.128` images expose a Ruby 4.0 host and incomplete 3.3
# toolchains; Magnus 0.7 fails to compile against those bindings. Platform gems
# build on native runners (`rake native gem`). Windows `x64-mingw-ucrt` stays
# source-gem-only. Revisit when a dock image ships Ruby 3.3 + Magnus 0.7.
set -euo pipefail

platform="${1:?usage: dock-build.sh <rb-sys-platform>}"
ruby_versions="${2:-3.1}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
gem_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$gem_dir/../.." && pwd)"

cd "$repo_root"
bundle exec --gemfile "$gem_dir/Gemfile" rb-sys-dock \
  --platform "$platform" \
  --ruby-versions "$ruby_versions" \
  --directory "$repo_root" \
  -- \
  "cd sdks/ruby && bundle install && RUBY_CC_VERSION=${ruby_versions} bundle exec rake native:${platform} gem"
