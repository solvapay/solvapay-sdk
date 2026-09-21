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
        output_schema: nil,
        get_customer_ref: nil,
        usage_type: "requests"
      )
        schema = compile_input_schema(input_schema)
        paid = append_paid_description(description)
        unioned = union_output_schema(output_schema)
        mcp = self
        define_kwargs = {
          name: name,
          title: title,
          description: paid,
          input_schema: schema,
        }
        define_kwargs[:output_schema] = unioned unless unioned.nil?
        server.define_tool(**define_kwargs) do |server_context: nil, **args|
          mcp.send(
            :to_mcp_response,
            mcp.invoke_payable(
              solvapay: solvapay,
              product: product,
              handler: handler,
              get_customer_ref: get_customer_ref,
              usage_type: usage_type,
              args: args,
              server_context: server_context,
            ),
          )
        end
      end

      def invoke_payable(
        solvapay:,
        product:,
        handler:,
        get_customer_ref:,
        args:,
        usage_type: "requests",
        server_context: nil,
        mcp_extra_customer_ref: nil
      )
        customer_ref = resolve_customer_ref(
          args,
          get_customer_ref,
          server_context,
          mcp_extra_customer_ref,
        )
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

      FINISHED_SCHEMA_KEYS = %w[
        type properties required oneOf anyOf allOf $schema items additionalProperties
      ].freeze

      private

      def resolve_customer_ref(args, get_customer_ref, server_context, mcp_extra_customer_ref)
        hook_ref = nil
        unless get_customer_ref.nil?
          resolved = get_customer_ref.call(args)
          hook_ref = resolved if resolved.is_a?(String) && !resolved.strip.empty?
        end
        headers = request_headers(server_context)
        auth_args = hash_lookup(args, :auth)
        result = SolvaPay::Mcp::Core.call(
          "resolveCustomerRef",
          {
            "hookRef" => hook_ref,
            "verifiedJwtSub" => nil,
            "headerUserId" => header_string(headers, "x-user-id"),
            "headerCustomerRef" => header_string(headers, "x-customer-ref"),
            "mcpExtraCustomerRef" => mcp_extra_customer_ref || mcp_extra_from_context(server_context),
            "argsAuthCustomerRef" => hash_lookup(auth_args, :customer_ref),
            "argsCustomerRef" => hash_lookup(args, :customer_ref),
          },
        )
        return result.strip if result.is_a?(String) && !result.strip.empty? && result.strip != "anonymous"

        raise SolvaPay::SolvaPayError.new(
          "customer_ref missing from MCP auth context",
          code: "unauthorized",
        )
      end

      def compile_input_schema(input_schema)
        return input_schema if finished_json_schema?(input_schema)

        compiled = SolvaPay::NativeDispatch.call_sync(
          "compile_string_field_input_schema_json",
          { "fields" => input_schema },
        )
        return compiled if compiled.is_a?(Hash)

        raise SolvaPay::SolvaPayError.new(
          "compile_string_field_input_schema_json did not return an object",
          code: "invalid_schema",
        )
      end

      def append_paid_description(description)
        paid = SolvaPay.append_paid_tool_description(description: description)
        return paid if paid.is_a?(String)

        raise SolvaPay::SolvaPayError.new(
          "append_paid_tool_description did not return a string",
          code: "invalid_schema",
        )
      end

      def union_output_schema(schema)
        return nil if schema.nil?

        union = {
          "type" => "object",
          "oneOf" => [schema, SolvaPay.paywall_structured_content_schema],
        }
        stamped = SolvaPay::NativeDispatch.call_sync(
          "ensure_output_schema_object_type",
          { "schema" => union },
        )
        return stamped if stamped.is_a?(Hash)

        raise SolvaPay::SolvaPayError.new(
          "ensure_output_schema_object_type did not return an object",
          code: "invalid_schema",
        )
      end

      def finished_json_schema?(schema)
        return false unless schema.is_a?(Hash)

        FINISHED_SCHEMA_KEYS.any? { |key| schema.key?(key) || schema.key?(key.to_sym) }
      end

      def hash_lookup(value, key)
        return nil unless value.is_a?(Hash)

        found = value[key]
        found = value[key.to_s] if found.nil?
        found = value[key.to_sym] if found.nil?
        found.is_a?(String) ? found : nil
      end

      def context_lookup(context, *names)
        return nil if context.nil?

        names.each do |name|
          if context.is_a?(Hash)
            found = context[name]
            found = context[name.to_s] if found.nil?
            found = context[name.to_sym] if found.nil?
            return found unless found.nil?
          end
          if context.respond_to?(name)
            found = context.public_send(name)
            return found unless found.nil?
          end
          next unless context.respond_to?(:[])

          found = context[name]
          found = context[name.to_s] if found.nil?
          found = context[name.to_sym] if found.nil?
          return found unless found.nil?
        end
        nil
      end

      def request_headers(context)
        headers = context_lookup(context, :headers)
        return headers unless headers.nil?

        request = context_lookup(context, :request)
        headers = context_lookup(request, :headers)
        return headers unless headers.nil?

        context_lookup(context, :env) || context_lookup(request, :env)
      end

      def header_string(headers, name)
        return nil if headers.nil?

        rack_key = "HTTP_#{name.upcase.tr('-', '_')}"
        [name, name.downcase, rack_key].each do |key|
          value = if headers.is_a?(Hash)
                    headers[key] || headers[key.to_sym]
                  elsif headers.respond_to?(:[])
                    headers[key]
                  end
          value = value.first if value.is_a?(Array)
          return value if value.is_a?(String) && !value.strip.empty?
        end
        return nil unless headers.respond_to?(:get)

        value = headers.get(name)
        value.is_a?(String) && !value.strip.empty? ? value : nil
      end

      def mcp_extra_from_context(context)
        http = context_lookup(context, :http)
        from_http = customer_ref_from_auth(context_lookup(http, :auth_info, :authInfo))
        return from_http unless from_http.nil?

        customer_ref_from_auth(context_lookup(context, :auth_info, :authInfo))
      end

      def customer_ref_from_auth(auth_info)
        ref = context_lookup(context_lookup(auth_info, :extra), :customer_ref)
        ref.is_a?(String) && !ref.strip.empty? ? ref.strip : nil
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
          message = SolvaPay::PAYMENT_REQUIRED unless message.is_a?(String) && !message.empty?
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
        # Only the handler call is guarded: a handler raising is a runtime
        # failure the loop reports as `err`, but a handler returning something
        # other than `ctx.respond(...)` breaks the contract and must surface.
        begin
          returned = @handler.call(@args, ctx)
        rescue SolvaPay::PaywallError => e
          gate = SolvaPay::Mcp.send(:stringify_keys, e.structured_content)
          return { kind: :return, result: format_gate(e.message, gate) } unless @format_gate_override.nil?

          { kind: :paywall, gate: gate, message: e.message }
        rescue StandardError => e
          { kind: :err, message: e.message }
        else
          { kind: :ok, envelope: Layer2.assert_response_result(returned) }
        end
      end

      def track_usage(request)
        @solvapay.track_usage(params: request) if request.is_a?(Hash)
      end

      private

      def format_gate(message, gate)
        override = @format_gate_override
        return override.call(message, gate) unless override.nil?

        Layer2.paywall_tool_result(message, gate)
      end
    end
  end
end
