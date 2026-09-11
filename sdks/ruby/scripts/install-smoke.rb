#!/usr/bin/env ruby
# frozen_string_literal: true

# Install a published gem from a host and execute one real call.

require "optparse"

host = nil
name = "solvapay"
version = nil

OptionParser.new do |opts|
  opts.on("--host HOST", "RubyGems host") { |v| host = v }
  opts.on("--name NAME", "Gem name") { |v| name = v }
  opts.on("--version VERSION", "Gem version") { |v| version = v }
end.parse!

abort "install-smoke: --host and --version are required" if host.nil? || version.nil?

cmd = ["gem", "install", name, "--version", version, "--clear-sources", "--source", host]
warn cmd.join(" ")
system(*cmd) || abort("install-smoke: gem install failed")

code = <<~RUBY
  require "#{name == 'solvapay' ? 'solvapay' : 'solvapay/mcp'}"
  puts "install-smoke: #{name == 'solvapay' ? 'SolvaPay.version' : 'SolvaPay::Mcp::VERSION'}"
  puts #{name == 'solvapay' ? 'SolvaPay.version' : 'SolvaPay::Mcp::VERSION'}
RUBY
system("ruby", "-e", code) || abort("install-smoke: runtime call failed")
