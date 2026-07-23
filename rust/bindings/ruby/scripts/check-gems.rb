#!/usr/bin/env ruby
# frozen_string_literal: true

# Pre-publish platform-gem artifact gate (Step 43 / redesign §7.7 / §10.3).
# Hard-fails when any expected rb-sys platform family is missing.

require "optparse"
require "pathname"

EXPECTED = [
  ["x86_64-linux", ->(n) { n.include?("x86_64-linux") && !n.include?("musl") }],
  ["aarch64-linux", ->(n) { n.include?("aarch64-linux") || n.include?("arm64-linux") }],
  # Host platform gems use darwin-XX suffixes (e.g. arm64-darwin-25).
  ["x86_64-darwin", ->(n) { n.include?("x86_64-darwin") }],
  ["arm64-darwin", ->(n) { n.include?("arm64-darwin") }],
  ["x64-mingw", ->(n) { n.include?("x64-mingw") || n.include?("x86_64-mingw") || n.include?("mingw") }],
].freeze

dir = Pathname("gems")
OptionParser.new do |opts|
  opts.on("--dir DIR", "Directory containing built .gem files") { |v| dir = Pathname(v) }
end.parse!

unless dir.directory?
  warn "check-gems: HARD FAIL — directory missing: #{dir}"
  exit 1
end

gems = dir.glob("**/*.gem").map { |p| p.basename.to_s.downcase }
present = []
missing = []

EXPECTED.each do |label, pred|
  matches = gems.select { |g| pred.call(g) }
  if matches.empty?
    missing << label
  else
    present << label
  end
end

if missing.empty?
  puts "check-gems: OK — #{present.size}/#{EXPECTED.size} platform gem families present"
  exit 0
end

warn "check-gems: HARD FAIL — missing platform gem families:"
missing.each { |m| warn "  - #{m}" }
warn "present: #{present.size}/#{EXPECTED.size}"
warn "found gems:"
(gems.empty? ? ["(none)"] : gems.sort).each { |g| warn "  - #{g}" }
exit 1
