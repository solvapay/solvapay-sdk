# frozen_string_literal: true

require "solvapay"

module SolvaPay
  module Mcp
    module Layer2
      class << self
        def paywall_tool_result(message, gate)
          as_object_map(
            SolvaPay::NativeDispatch.call_sync(
              "paywall_tool_result",
              { "message" => message, "structuredContent" => gate },
            ),
          )
        end

        def make_response_result(data, options, emitted_blocks)
          args = { "data" => data }
          args["options"] = options unless options.nil?
          args["emittedBlocks"] = emitted_blocks unless emitted_blocks.empty?
          as_object_map(SolvaPay::NativeDispatch.call_sync("make_response_result", args))
        end

        def assert_response_result(value)
          as_object_map(SolvaPay::NativeDispatch.call_sync("assert_response_result", { "value" => value }))
        end

        def build_payable_tool_result(envelope)
          as_object_map(
            SolvaPay::NativeDispatch.call_sync("build_payable_tool_result", { "envelope" => envelope }),
          )
        end

        def as_object_map(value)
          return value if value.is_a?(Hash)

          raise SolvaPay::SolvaPayError, "native call returned unexpected value"
        end
      end
    end
  end
end
