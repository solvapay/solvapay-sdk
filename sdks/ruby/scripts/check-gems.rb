#!/usr/bin/env ruby
# frozen_string_literal: true

# Pre-publish platform-gem artifact gate.
# Hard-fails when any expected rb-sys platform family is missing, or when a
# platform gem does not carry one .so/.bundle per expected Ruby ABI.

require "json"
require "optparse"
require "pathname"

require "rubygems/package"
require "tmpdir"

MARKER = "SOLVAPAY_PANIC_PROBE".freeze

def repo_root
  Pathname.new(__dir__).parent.parent.parent
end

def load_matrix
  path = repo_root.join("contract/manifest/support-matrix.json")
  unless path.file?
    warn "check-gems: HARD FAIL — missing #{path}"
    exit 1
  end
  JSON.parse(path.read)
end

def matches?(name, rule)
  n = name.downcase
  Array(rule["filenameIncludes"]).each { |part| return false unless n.include?(part.downcase) }
  Array(rule["filenameExcludes"]).each { |part| return false if n.include?(part.downcase) }
  any_of = Array(rule["filenameAnyOf"])
  return false if any_of.any? && any_of.none? { |part| n.include?(part.downcase) }

  true
end

matrix = load_matrix
ruby = matrix.fetch("ruby")
rules = ruby.fetch("gems")
abis = ruby.fetch("abis")

dir = Pathname("gems")
OptionParser.new do |opts|
  opts.on("--dir DIR", "Directory containing built .gem files") { |v| dir = Pathname(v) }
end.parse!

unless dir.directory?
  warn "check-gems: HARD FAIL — directory missing: #{dir}"
  exit 1
end

gems = dir.glob("**/*.gem")
gem_names = gems.map { |p| p.basename.to_s.downcase }
present = []
missing = []

rules.each do |rule|
  matches = gem_names.select { |g| matches?(g, rule) }
  if matches.empty?
    missing << rule["id"]
  else
    present << rule["id"]
  end
end

probe_hits = []
abi_failures = []
gems.each do |gem_path|
  next if gem_path.basename.to_s.match?(/-(\d+\.){2}\d+\.gem\z/) &&
          rules.none? { |rule| matches?(gem_path.basename.to_s, rule) }

  platform_rule = rules.find { |rule| matches?(gem_path.basename.to_s, rule) }
  Dir.mktmpdir do |tmpdir|
    Gem::Package.new(gem_path.to_s).extract_files(tmpdir)
    Dir.glob(File.join(tmpdir, "**/*.{so,bundle,dylib}")).each do |bin|
      next unless File.binread(bin).include?(MARKER)

      probe_hits << "#{gem_path.basename}:#{File.basename(bin)}"
    end
    next unless platform_rule

    found_abis = abis.select do |abi|
      Dir.glob(File.join(tmpdir, "**", abi, "*.{so,bundle}")).any?
    end
    missing_abis = abis - found_abis
    unless missing_abis.empty?
      abi_failures << "#{gem_path.basename}: missing ABI #{missing_abis.join(', ')} (found #{found_abis.join(', ')})"
    end
  end
end

unless probe_hits.empty?
  warn "check-gems: HARD FAIL — panic-probe marker in release artifact:"
  probe_hits.each { |hit| warn "  - #{hit}" }
  exit 1
end

unless abi_failures.empty?
  warn "check-gems: HARD FAIL — platform gem missing expected Ruby ABIs (#{abis.join(':')}):"
  abi_failures.each { |hit| warn "  - #{hit}" }
  exit 1
end

if missing.empty?
  puts "check-gems: OK — #{present.size}/#{rules.size} platform gem families present, ABIs #{abis.join(':')}"
  exit 0
end

warn "check-gems: HARD FAIL — missing platform gem families:"
missing.each { |m| warn "  - #{m}" }
warn "present: #{present.size}/#{rules.size}"
warn "found gems:"
(gem_names.empty? ? ["(none)"] : gem_names.sort).each { |g| warn "  - #{g}" }
exit 1
