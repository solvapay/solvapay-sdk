# frozen_string_literal: true

require "solvapay"
require_relative "core"
require_relative "layer2"

module SolvaPay
  module Mcp
    class ResponseContext
      attr_reader :customer, :product

      def initialize(customer:, product:, product_ref:)
        @customer = customer
        @product = product
        @product_ref = product_ref
        @emitted = []
      end

      def emit(block)
        @emitted << block
      end

      def respond(data, options = nil)
        Layer2.make_response_result(data, options, @emitted.dup)
      end

      def gate(reason = nil)
        args = { "product" => @product_ref }
        args["reason"] = reason unless reason.nil?
        content = Core.call("mcpDefaultGate", args)
        unless content.is_a?(Hash)
          raise SolvaPay::SolvaPayError, "mcpDefaultGate did not return an object"
        end

        message = content["message"]
        message = "Payment required" if message.nil? || message.to_s.empty?
        raise SolvaPay::PaywallError.new(message, content)
      end
    end
  end
end
