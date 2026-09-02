#!/usr/bin/env ruby
# frozen_string_literal: true

# Pre-publish platform-gem artifact gate (Step 43 / redesign §7.7 / §10.3).
# Hard-fails when any expected rb-sys platform family is missing.

require "optparse"
require "pathname"

require "rubygems/package"
require "tmpdir"

MARKER = "SOLVAPAY_PANIC_PROBE".freeze

EXPECTED = [
  ["x86_64-linux", ->(n) { n.include?("x86_64-linux") && !n.include?("musl") }],
  ["aarch64-linux", ->(n) { n.include?("aarch64-linux") && !n.include?("musl") }],
  ["x86_64-linux-musl", ->(n) { n.include?("x86_64-linux-musl") }],
  ["aarch64-linux-musl", ->(n) { n.include?("aarch64-linux-musl") }],
  # Host platform gems use darwin-XX suffixes (e.g. arm64-darwin-25).
  ["x86_64-darwin", ->(n) { n.include?("x86_64-darwin") }],
  ["arm64-darwin", ->(n) { n.include?("arm64-darwin") }],
  # Windows prebuilt gems are not published: rb-sys-dock still has no working
  # x64-mingw-ucrt toolchain for this crate (same as Temporal). Consumers
  # install the source gem and compile via rb_sys/mkmf.
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

probe_hits = []
dir.glob("**/*.gem").each do |gem_path|
  Dir.mktmpdir do |tmpdir|
    Gem::Package.new(gem_path.to_s).extract_files(tmpdir)
    Dir.glob(File.join(tmpdir, "**/*.{so,bundle,dylib}")).each do |bin|
      next unless File.binread(bin).include?(MARKER)

      probe_hits << "#{gem_path.basename}:#{File.basename(bin)}"
    end
  end
end
unless probe_hits.empty?
  warn "check-gems: HARD FAIL — panic-probe marker in release artifact:"
  probe_hits.each { |hit| warn "  - #{hit}" }
  exit 1
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
