# frozen_string_literal: true

require "minitest/autorun"
require_relative "../paid_mcp"

class PaidMcpTest < Minitest::Test
  def test_allow_round_trip
    result = PaidMcp.run(within_limits: true, message: "hello")
    assert_equal '{"echo":"hello"}', result["content"][0]["text"]
    assert_equal({ "echo" => "hello" }, result["structuredContent"])
  end

  def test_gate_round_trip
    result = PaidMcp.run(within_limits: false, message: "hello")
    assert_equal false, result["isError"]
    assert_equal "payment_required", result["structuredContent"]["kind"]
    assert_includes result["content"][0]["text"], "upgrade"
  end
end
