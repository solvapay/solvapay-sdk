# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require "solvapay/mcp"
require_relative "mcp_authoring/mock_backend"

class UncoveredPathsTest < Minitest::Test
  def test_raw_handler_return_fails_through_assert_response_result
    backend = McpAuthoring::MockBackend.new(
      "withinLimits" => true,
      "remaining" => 5,
      "meterName" => "requests",
    )
    solvapay = SolvaPay.create(api_client: backend)
    error = assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::Mcp.invoke_payable(
        solvapay: solvapay,
        product: "prd_demo",
        handler: ->(_args, _ctx) { { "raw" => true } },
        get_customer_ref: ->(_args) { "cus_from_hook" },
        args: {},
      )
    end
    message = error.message.downcase
    assert(message.include?("respond") || message.include?("raw"))
  end

  def test_unresolvable_customer_ref_raises
    backend = McpAuthoring::MockBackend.new(
      "withinLimits" => true,
      "remaining" => 5,
      "meterName" => "requests",
    )
    solvapay = SolvaPay.create(api_client: backend)
    error = assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::Mcp.invoke_payable(
        solvapay: solvapay,
        product: "prd_demo",
        handler: ->(_args, ctx) { ctx.respond({ "ok" => true }) },
        get_customer_ref: nil,
        args: {},
      )
    end
    assert_match(/customer_ref missing/, error.message)
    assert_empty backend.tracked
  end
end
