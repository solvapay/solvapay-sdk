# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require "solvapay/mcp"

class ResponseContextTest < Minitest::Test
  def setup
    @original = SolvaPay::NativeDispatch.method(:call_sync)
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) do |name, args|
      { "name" => name, "args" => args }
    end
  end

  def teardown
    original = @original
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) { |name, args| original.call(name, args) }
  end

  def context
    SolvaPay::Mcp::ResponseContext.new(
      customer: { "ref" => "cus_x" },
      product: { "reference" => "prd_demo" },
      product_ref: "prd_demo",
    )
  end

  def test_customer_and_product_readers
    ctx = context
    assert_equal "cus_x", ctx.customer["ref"]
    assert_equal "prd_demo", ctx.product["reference"]
  end

  def test_emit_queues_and_respond_delegates_to_make_response_result
    ctx = context
    ctx.emit({ "type" => "text", "text" => "queued" })
    result = ctx.respond({ "ok" => true }, { "text" => "hi" })
    assert_equal "make_response_result", result["name"]
    assert_equal({ "ok" => true }, result["args"]["data"])
    assert_equal({ "text" => "hi" }, result["args"]["options"])
    assert_equal [{ "type" => "text", "text" => "queued" }], result["args"]["emittedBlocks"]
  end

  def test_gate_raises_paywall_error_with_contract_structured_content
    error = assert_raises(SolvaPay::PaywallError) { context.gate }
    assert_equal "Payment required", error.message
    assert_equal(
      {
        "kind" => "payment_required",
        "product" => "prd_demo",
        "checkoutUrl" => "",
        "message" => "Payment required",
        "shortMessage" => "Payment required",
      },
      error.structured_content,
    )
  end

  def test_gate_uses_custom_reason
    error = assert_raises(SolvaPay::PaywallError) { context.gate("upgrade") }
    assert_equal "upgrade", error.message
    assert_equal "upgrade", error.structured_content["message"]
  end
end
