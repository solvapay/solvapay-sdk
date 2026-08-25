# frozen_string_literal: true

require "json"
require "mcp"
require "solvapay"
require "solvapay/mcp"

module PaidMcp
  class MockClient
    attr_reader :tracked

    def initialize(within_limits:)
      @within_limits = within_limits
      @tracked = []
    end

    def check_limits(params:)
      _ = params
      {
        "withinLimits" => @within_limits,
        "remaining" => @within_limits ? 5 : 0,
        "meterName" => "requests",
        "checkoutUrl" => "https://pay.example/x",
      }
    end

    def track_usage(params:)
      @tracked << params
      { "ok" => true }
    end

    def get_customer(params:)
      { "customerRef" => params["customerRef"] || "cus_demo" }
    end

    def create_customer(params:)
      get_customer(params: params)
    end
  end

  module_function

  def run(within_limits:, message:)
    client = MockClient.new(within_limits: within_limits)
    solvapay = SolvaPay.create(api_client: client)
    server = ::MCP::Server.new(name: "paid-mcp-example")

    SolvaPay::Mcp.register_payable_tool(
      server,
      "echo_paid",
      solvapay: solvapay,
      product: "prd_demo",
      title: "Echo paid",
      handler: lambda do |args, ctx|
        text = args[:text] || args["text"] || message
        ctx.respond({ "echo" => text })
      end,
      get_customer_ref: ->(_args) { "cus_demo" },
    )

    server.handle_json(
      JSON.generate(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "paid-mcp", version: "0.0.0" },
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
          params: { name: "echo_paid", arguments: { text: message } },
        },
      ),
    )
    raise "tools/call returned no JSON" if raw.nil?

    dumped = JSON.parse(raw).fetch("result")
    projected = { "content" => dumped.fetch("content") }
    projected["structuredContent"] = dumped["structuredContent"] if dumped.key?("structuredContent")
    projected["isError"] = dumped["isError"] if dumped.key?("isError")
    projected
  end
end
