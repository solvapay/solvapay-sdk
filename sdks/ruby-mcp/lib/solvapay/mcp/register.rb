# frozen_string_literal: true

require "json"
require "mcp"
require "solvapay"
require_relative "layer2"
require_relative "response_context"

module SolvaPay
  module Mcp
    class << self
      attr_accessor :format_gate_override

      # Test-only seam matching Python set_format_gate_override.
      # rubocop:disable Naming/AccessorMethodName
      def set_format_gate_override(format_gate)
        self.format_gate_override = format_gate
      end
      # rubocop:enable Naming/AccessorMethodName

      def register_payable_tool(
        server,
        name,
        solvapay:,
        product:,
        handler:,
        title: nil,
        description: nil,
        input_schema: nil,
        get_customer_ref: nil
      )
        empty_properties = {} #: Hash[Symbol, untyped]
        schema = input_schema.nil? ? { type: "object", properties: empty_properties } : input_schema
        mcp = self
        server.define_tool(
          name: name,
          title: title,
          description: description,
          input_schema: schema,
        ) do |server_context: nil, **args|
          _ = server_context
          mcp.send(
            :to_mcp_response,
            mcp.invoke_payable(
              solvapay: solvapay,
              product: product,
              handler: handler,
              get_customer_ref: get_customer_ref,
              args: args,
            ),
          )
        end
      end

      def invoke_payable(solvapay:, product:, handler:, get_customer_ref:, args:)
        started_ms = (Time.now.to_f * 1_000).to_i
        customer_ref = resolve_customer_ref(args, get_customer_ref)
        gate_result = solvapay.gate(customer_ref, product: product)
        case gate_result
        when SolvaPay::PayablePaywallResult
          gate = stringify_keys(gate_result.content)
          message = gate["message"]
          message = "Payment required" unless message.is_a?(String) && !message.empty?
          format_gate(message, gate)
        when SolvaPay::PayableAllowResult
          limits = limits_from_decision(gate_result.decision)
          ctx = ResponseContext.new(
            customer: {
              "ref" => gate_result.customer_ref,
              "balance" => limits.fetch("creditBalance", 0),
              "remaining" => limits["remaining"],
              "withinLimits" => limits.fetch("withinLimits", true),
              "plan" => limits["plan"],
            },
            product: { "reference" => product, "name" => product },
            product_ref: product,
          )
          begin
            returned = handler.call(args, ctx)
          rescue SolvaPay::PaywallError => e
            gate = stringify_keys(e.structured_content)
            return format_gate(e.message, gate)
          rescue StandardError => e
            elapsed = (Time.now.to_f * 1_000).to_i - started_ms
            gate_result.track_fail(e, duration: elapsed.negative? ? 0 : elapsed)
            return {
              "content" => [
                {
                  "type" => "text",
                  "text" => JSON.pretty_generate({ "success" => false, "error" => e.message }),
                },
              ],
              "isError" => true,
            }
          end
          envelope = Layer2.assert_response_result(returned)
          result = Layer2.build_payable_tool_result(envelope)
          elapsed = (Time.now.to_f * 1_000).to_i - started_ms
          gate_result.track_success(duration: elapsed.negative? ? 0 : elapsed)
          result
        else
          raise SolvaPay::SolvaPayError.new("unexpected gate result", code: "invalid_gate_result")
        end
      end

      private

      def resolve_customer_ref(args, get_customer_ref)
        return get_customer_ref.call(args) unless get_customer_ref.nil?

        raw = args[:customer_ref]
        return raw if raw.is_a?(String) && !raw.empty?

        "anonymous"
      end

      def format_gate(message, gate)
        override = format_gate_override
        return override.call(message, gate) unless override.nil?

        Layer2.paywall_tool_result(message, gate)
      end

      def limits_from_decision(decision)
        maybe = decision.is_a?(Hash) ? decision["limits"] : nil
        maybe.is_a?(Hash) ? stringify_keys(maybe) : {}
      end

      def stringify_keys(value)
        JSON.parse(JSON.generate(value))
      end

      def to_mcp_response(payload)
        payload = stringify_keys(payload)
        content = payload["content"]
        structured = payload["structuredContent"]
        if payload.key?("isError")
          ::MCP::Tool::Response.new(content, error: payload["isError"], structured_content: structured)
        else
          ::MCP::Tool::Response.new(content, structured_content: structured)
        end
      end
    end
  end
end
