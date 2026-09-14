# frozen_string_literal: true

require "json"
require "mcp"
require "solvapay"
require_relative "core"
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
        get_customer_ref: nil,
        usage_type: "requests"
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
              usage_type: usage_type,
              args: args,
            ),
          )
        end
      end

      def invoke_payable(solvapay:, product:, handler:, get_customer_ref:, args:, usage_type: "requests")
        customer_ref = resolve_customer_ref(args, get_customer_ref)
        usage = usage_type.nil? || usage_type.to_s.empty? ? "requests" : usage_type.to_s
        host = PayableLoopHost.new(
          solvapay: solvapay,
          product: product,
          handler: handler,
          args: args,
          format_gate_override: format_gate_override,
        )
        result = SolvaPay::GeneratedPayableLoop.run(
          payable_next: lambda { |state, event|
            out = NativeDispatch.call_sync("invoke_payable_next", { "state" => state, "event" => event })
            unless out.is_a?(Hash)
              raise SolvaPay::SolvaPayError.new(
                "invoke_payable_next returned unexpected value",
                code: "invalid_invoke",
              )
            end
            out
          },
          host: host,
          start_event: {
            "kind" => "start",
            "customerRef" => customer_ref,
            "product" => product,
            "usageType" => usage,
            "startedMs" => (Time.now.to_f * 1_000).to_i,
          },
        )
        unless result.is_a?(Hash)
          raise SolvaPay::SolvaPayError.new(
            "invoke_payable_next done missing result",
            code: "invalid_invoke",
          )
        end
        stringify_keys(result)
      end

      private

      def resolve_customer_ref(args, get_customer_ref)
        hook_ref = nil
        unless get_customer_ref.nil?
          resolved = get_customer_ref.call(args)
          hook_ref = resolved if resolved.is_a?(String) && !resolved.strip.empty?
        end
        raw = args[:customer_ref]
        result = SolvaPay::Mcp::Core.call(
          "resolveCustomerRef",
          { "hookRef" => hook_ref, "argsCustomerRef" => raw },
        )
        return result.strip if result.is_a?(String) && !result.strip.empty? && result.strip != "anonymous"

        raise SolvaPay::SolvaPayError.new(
          "customer_ref missing from MCP auth context",
          code: "unauthorized",
        )
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

    class PayableLoopHost
      def initialize(solvapay:, product:, handler:, args:, format_gate_override:)
        @solvapay = solvapay
        @product = product
        @handler = handler
        @args = args
        @format_gate_override = format_gate_override
      end

      def now_ms
        (Time.now.to_f * 1_000).to_i
      end

      def random_unit
        rand
      end

      def run_gate(action)
        gate_result = @solvapay.gate(action["customerRef"], product: action["product"] || @product)
        case gate_result
        when SolvaPay::PayablePaywallResult
          gate = SolvaPay::Mcp.send(:stringify_keys, gate_result.content)
          message = gate["message"]
          message = "Payment required" unless message.is_a?(String) && !message.empty?
          return { kind: :return, result: format_gate(message, gate) } unless @format_gate_override.nil?

          { kind: :paywall, gate: gate, message: message }
        when SolvaPay::PayableAllowResult
          {
            kind: :allow,
            customerRef: gate_result.customer_ref,
            limits: SolvaPay::Mcp.send(:limits_from_decision, gate_result.decision),
          }
        else
          raise SolvaPay::SolvaPayError.new("unexpected gate result", code: "invalid_gate_result")
        end
      end

      def invoke_handler(action)
        empty_limits = {} #: Hash[String, untyped]
        limits = action["limits"].is_a?(Hash) ? SolvaPay::Mcp.send(:stringify_keys, action["limits"]) : empty_limits
        snapshot = NativeDispatch.call_sync(
          "build_customer_snapshot",
          { "customerRef" => action["customerRef"], "limits" => limits },
        )
        raise SolvaPay::SolvaPayError, "buildCustomerSnapshot did not return an object" unless snapshot.is_a?(Hash)

        ctx = ResponseContext.new(
          customer: snapshot,
          product: { "reference" => @product, "name" => @product },
          product_ref: @product,
          limits: limits,
        )
        returned = @handler.call(@args, ctx)
        { kind: :ok, envelope: Layer2.assert_response_result(returned) }
      rescue SolvaPay::PaywallError => e
        gate = SolvaPay::Mcp.send(:stringify_keys, e.structured_content)
        return { kind: :return, result: format_gate(e.message, gate) } unless @format_gate_override.nil?

        { kind: :paywall, gate: gate, message: e.message }
      rescue StandardError => e
        { kind: :err, message: e.message }
      end

      def track_usage(request)
        @solvapay.track_usage(params: request) if request.is_a?(Hash)
      end

      private

      def format_gate(message, gate)
        return @format_gate_override.call(message, gate) unless @format_gate_override.nil?

        Layer2.paywall_tool_result(message, gate)
      end
    end
  end
end
