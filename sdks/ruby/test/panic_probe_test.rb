# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"

# Asserts our catch_unwind envelope fires before Magnus ≥0.8 raises `fatal`.
class PanicProbeTest < Minitest::Test
  def test_panic_probe_raises_rescued_error
    unless SolvaPay.respond_to?(:panic_probe)
      flunk "panic_probe is missing — compile with RB_SYS_CARGO_FEATURES=panic-probe"
    end

    err = assert_raises(SolvaPay::Error) { SolvaPay.panic_probe }
    assert_equal "internal_error", err.code
    assert_match(/SOLVAPAY_PANIC_PROBE/, err.message)
  end
end
