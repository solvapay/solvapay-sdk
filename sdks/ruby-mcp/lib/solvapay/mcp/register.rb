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
        customer_ref = resolve_customer_ref(args, get_customer_ref)
        state = nil
        event = {
          "kind" => "start",
          "customerRef" => customer_ref,
          "product" => product,
          "usageType" => "requests",
          "startedMs" => (Time.now.to_f * 1_000).to_i,
        }
        allow = nil
        loop do
          out = NativeDispatch.call_sync("invoke_payable_next", { "state" => state, "event" => event })
          unless out.is_a?(Hash)
            raise SolvaPay::SolvaPayError.new(
              "invoke_payable_next returned unexpected value",
              code: "invalid_invoke",
            )
          end

          state = out["state"]
          action = out["action"]
          unless action.is_a?(Hash)
            raise SolvaPay::SolvaPayError.new(
              "invoke_payable_next returned unexpected action",
              code: "invalid_invoke",
            )
          end

          kind = action["kind"]
          case kind
          when "runGate"
            gate_result = solvapay.gate(action["customerRef"], product: action["product"] || product)
            case gate_result
            when SolvaPay::PayablePaywallResult
              gate = stringify_keys(gate_result.content)
              message = gate["message"]
              message = "Payment required" unless message.is_a?(String) && !message.empty?
              return format_gate(message, gate) unless format_gate_override.nil?

              event = { "kind" => "gatePaywall", "gate" => gate, "message" => message }
            when SolvaPay::PayableAllowResult
              allow = gate_result
              limits = limits_from_decision(gate_result.decision)
              event = {
                "kind" => "gateAllow",
                "customerRef" => gate_result.customer_ref,
                "limits" => limits,
              }
            else
              raise SolvaPay::SolvaPayError.new("unexpected gate result", code: "invalid_gate_result")
            end
          when "invokeHandler"
            empty_limits = {} #: Hash[String, untyped]
            limits = action["limits"].is_a?(Hash) ? stringify_keys(action["limits"]) : empty_limits
            ctx = ResponseContext.new(
              customer: {
                "ref" => action["customerRef"],
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
              return format_gate(e.message, gate) unless format_gate_override.nil?

              event = { "kind" => "handlerPaywall", "gate" => gate, "message" => e.message }
            rescue StandardError => e
              event = {
                "kind" => "handlerErr",
                "message" => e.message,
                "nowMs" => (Time.now.to_f * 1_000).to_i,
              }
            else
              envelope = Layer2.assert_response_result(returned)
              event = {
                "kind" => "handlerOk",
                "envelope" => envelope,
                "nowMs" => (Time.now.to_f * 1_000).to_i,
              }
            end
          when "done"
            tracker = allow
            track = action["track"]
            if tracker.is_a?(SolvaPay::PayableAllowResult) && track.is_a?(Hash)
              duration = track["durationMs"].to_f
              if track["outcome"] == "success"
                tracker.track_success(duration: duration)
              else
                tracker.track_fail(track["outcome"], duration: duration)
              end
            end
            result = action["result"]
            unless result.is_a?(Hash)
              raise SolvaPay::SolvaPayError.new(
                "invoke_payable_next done missing result",
                code: "invalid_invoke",
              )
            end

            return stringify_keys(result)
          else
            raise SolvaPay::SolvaPayError.new(
              "invoke_payable_next unknown action kind: #{kind}",
              code: "invalid_invoke",
            )
          end
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
