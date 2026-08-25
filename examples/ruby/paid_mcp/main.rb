# frozen_string_literal: true

require "json"
require_relative "paid_mcp"

gate = ARGV.include?("--gate")
message_index = ARGV.index("--message")
message = message_index ? ARGV[message_index + 1] : "hello"
message = "hello" if message.nil?

result = PaidMcp.run(within_limits: !gate, message: message)
puts JSON.pretty_generate(result)
