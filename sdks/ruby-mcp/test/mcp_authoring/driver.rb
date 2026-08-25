# frozen_string_literal: true

require "json"
require "mcp"
require "solvapay"
require "solvapay/mcp"
require_relative "mock_backend"
require_relative "scenario"

module McpAuthoring
  module Driver
    module_function

    def call_registered_payable(backend, scenario)
      solvapay = SolvaPay.create(api_client: backend)
      server = ::MCP::Server.new(name: "mcp-authoring-fixtures")
      get_customer_ref = nil
      if scenario.customer_ref_source == "hook"
        ref = scenario.customer_ref
        get_customer_ref = ->(_args) { ref }
      end

      SolvaPay::Mcp.register_payable_tool(
        server,
        scenario.tool.name,
        solvapay: solvapay,
        product: scenario.product,
        title: scenario.tool.title,
        description: scenario.tool.description,
        input_schema: input_schema(scenario),
        handler: compile_handler(scenario),
        get_customer_ref: get_customer_ref,
      )

      initialize_server(server)
      raw = server.handle_json(
        JSON.generate(
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: scenario.tool.name,
              arguments: scenario.tool.args,
            },
          },
        ),
      )
      raise "tools/call returned no JSON" if raw.nil?

      wire = JSON.parse(raw)
      raise "tools/call error: #{wire["error"].inspect}" if wire["error"]

      project_tool_result(wire.fetch("result"))
    end

    def compile_handler(scenario)
      spec = scenario.handler
      lambda do |_args, ctx|
        case spec
        when HandlerThrow
          raise spec.message
        when HandlerGate
          ctx.gate(spec.reason)
        when HandlerRespond
          if spec.emit.is_a?(Array)
            spec.emit.each { |block| ctx.emit(stringify(block)) }
          end
          options = spec.options.nil? ? nil : stringify(spec.options)
          ctx.respond(stringify(spec.data), options)
        else
          raise "unreachable handler kind"
        end
      end
    end

    def input_schema(scenario)
      raw = scenario.tool.input_schema
      return nil if raw.nil?

      raise "inputSchema must be an object" unless raw.is_a?(Hash)

      properties = {}
      required = []
      raw.each do |key, spec|
        unless spec.is_a?(Hash) && spec["type"] == "string"
          raise "unsupported inputSchema for field #{key}"
        end

        properties[key.to_sym] = { type: "string" }
        required << key.to_s
      end
      schema = { properties: properties }
      schema[:required] = required unless required.empty?
      schema
    end

    def initialize_server(server)
      server.handle_json(
        JSON.generate(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "mcp-authoring-fixtures", version: "0.0.0" },
            },
          },
        ),
      )
      server.handle_json(
        JSON.generate({ jsonrpc: "2.0", method: "notifications/initialized" }),
      )
    end

    def project_tool_result(dumped)
      dumped = stringify(dumped)
      projected = { "content" => dumped.fetch("content") }
      projected["structuredContent"] = dumped["structuredContent"] if dumped.key?("structuredContent")
      is_error = dumped["isError"]
      structured = dumped["structuredContent"]
      if is_error == true
        projected["isError"] = true
      elsif is_error == false && structured.is_a?(Hash) &&
            %w[payment_required activation_required].include?(structured["kind"])
        projected["isError"] = false
      end
      projected
    end

    def stringify(value)
      JSON.parse(JSON.generate(value))
    end
  end
end
