# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require "solvapay/mcp"

class Layer2Test < Minitest::Test
  def setup
    @calls = []
    @original = SolvaPay::NativeDispatch.method(:call_sync)
    calls = @calls
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) do |name, args|
      calls << [name, args]
      { "ok" => true, "via" => name }
    end
  end

  def teardown
    original = @original
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) { |name, args| original.call(name, args) }
  end

  def test_paywall_tool_result_hits_native_name_and_keys
    SolvaPay::Mcp::Layer2.paywall_tool_result("Payment required", { "kind" => "payment_required" })
    name, args = @calls.last
    assert_equal "paywall_tool_result", name
    assert args.key?("message")
    assert args.key?("structuredContent")
  end

  def test_make_response_result_omits_empty_emitted_blocks
    SolvaPay::Mcp::Layer2.make_response_result({ "ok" => true }, { "text" => "hi" }, [])
    name, args = @calls.last
    assert_equal "make_response_result", name
    assert args.key?("data")
    assert args.key?("options")
    refute args.key?("emittedBlocks")
  end

  def test_make_response_result_includes_emitted_blocks
    SolvaPay::Mcp::Layer2.make_response_result({ "ok" => true }, nil, [{ "type" => "text", "text" => "x" }])
    _name, args = @calls.last
    refute args.key?("options")
    assert args.key?("emittedBlocks")
  end

  def test_assert_and_build_hit_native_names
    SolvaPay::Mcp::Layer2.assert_response_result({ "content" => [] })
    assert_equal "assert_response_result", @calls.last[0]
    assert @calls.last[1].key?("value")
    SolvaPay::Mcp::Layer2.build_payable_tool_result({ "content" => [] })
    assert_equal "build_payable_tool_result", @calls.last[0]
    assert @calls.last[1].key?("envelope")
  end

  def test_raises_when_native_result_is_not_a_hash
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) { |_name, _args| "nope" }
    assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::Mcp::Layer2.assert_response_result({ "raw" => true })
    end
  end
end
