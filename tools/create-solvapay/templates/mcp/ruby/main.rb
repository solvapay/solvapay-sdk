# frozen_string_literal: true

require "solvapay"
require "solvapay/mcp"
require_relative "tools"
require_relative "http"

def load_dotenv(path = ".env")
  return unless File.exist?(path)

  File.foreach(path) do |line|
    line = line.strip
    next if line.empty? || line.start_with?("#") || !line.include?("=")

    key, value = line.split("=", 2)
    key = key.strip
    value = value.strip
    ENV[key] = value if !key.empty? && ENV[key].nil?
  end
end

load_dotenv
mode_index = ARGV.index("--mode")
mode = mode_index ? ARGV[mode_index + 1] : "http"
mode = "http" if mode.nil?

case mode
when "http"
  __RUBY_MODULE__.serve_http!
else
  raise ArgumentError, "unknown --mode #{mode.inspect} (expected http)"
end
