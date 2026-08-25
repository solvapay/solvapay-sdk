# frozen_string_literal: true

require "solvapay"
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
        message = reason.nil? || reason.empty? ? "Payment required" : reason
        raise SolvaPay::PaywallError.new(
          message,
          {
            "kind" => "payment_required",
            "product" => @product_ref,
            "checkoutUrl" => "",
            "message" => message,
          },
        )
      end
    end
  end
end
