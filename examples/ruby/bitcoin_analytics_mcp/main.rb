# frozen_string_literal: true

require "json"
require_relative "bitcoin_analytics"

mode_index = ARGV.index("--mode")
mode = mode_index ? ARGV[mode_index + 1] : "demo"
mode = "demo" if mode.nil?

case mode
when "http"
  BitcoinAnalytics.serve_http!
when "demo"
  gate = ARGV.include?("--gate")
  source_value = ARGV.include?("--source") ? ARGV[ARGV.index("--source") + 1] : nil
  source = if BitcoinAnalytics.live_source?(source_value)
             BitcoinAnalytics::LiveSource.new
           else
             BitcoinAnalytics.default_fixture_source
           end
  server = BitcoinAnalytics.build_mcp_server(within_limits: !gate, source: source)
  server.handle_json(
    JSON.generate(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "bitcoin-analytics-demo", version: "0.0.0" },
        },
      },
    ),
  )
  server.handle_json(JSON.generate({ jsonrpc: "2.0", method: "notifications/initialized" }))
  raw = server.handle_json(
    JSON.generate(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "network_snapshot", arguments: {} },
      },
    ),
  )
  raise "tools/call returned no JSON" if raw.nil?

  dumped = JSON.parse(raw).fetch("result")
  puts JSON.pretty_generate(dumped)
else
  raise ArgumentError, "unknown --mode #{mode.inspect} (expected demo or http)"
end
