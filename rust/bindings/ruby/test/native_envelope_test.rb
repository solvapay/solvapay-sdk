# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "solvapay"

class NativeEnvelopeTest < Minitest::Test
  def test_unwraps_success
    assert_equal({ "customerRef" => "cus_x" }, SolvaPay::NativeDispatch.unwrap(
      JSON.generate("ok" => true, "value" => { "customerRef" => "cus_x" }),
    ))
  end

  def test_rejects_invalid_and_malformed_envelopes
    error = assert_raises(SolvaPay::SolvaPayError) { SolvaPay::NativeDispatch.unwrap("not-json") }
    assert_match(/invalid JSON envelope/, error.message)

    error = assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::NativeDispatch.unwrap(JSON.generate("value" => 1))
    end
    assert_match(/malformed envelope/, error.message)
  end

  def test_reconstructs_api_error
    error = assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::NativeDispatch.unwrap(JSON.generate(
        "ok" => false,
        "error" => {
          "kind" => "Api",
          "message" => "bad request",
          "status" => 400,
          "code" => "invalid_request",
        },
      ))
    end
    assert_equal 400, error.status
    assert_equal "invalid_request", error.code
  end

  def test_reconstructs_paywall_without_changing_gate
    gate = {
      "kind" => "payment_required",
      "product" => "prd_x",
      "nested" => { "remaining" => 0 },
    }
    error = assert_raises(SolvaPay::PaywallError) do
      SolvaPay::NativeDispatch.unwrap(JSON.generate(
        "ok" => false,
        "error" => { "kind" => "Paywall", "message" => "blocked", "gate" => gate },
      ))
    end
    assert_equal gate, error.structured_content
  end

  def test_reconstructs_webhook_and_transport_errors
    webhook = SolvaPay::NativeDispatch.reconstruct_error(
      "kind" => "Webhook",
      "message" => "bad signature",
      "code" => "invalid_signature",
    )
    assert_equal "invalid_signature", webhook.code

    transport = SolvaPay::NativeDispatch.reconstruct_error(
      "kind" => "Transport",
      "message" => "native binding panicked",
      "retryable" => false,
    )
    assert_equal false, transport.retryable
  end

  def test_rejects_unknown_dispatch_methods_before_calling_bridge
    bridge = Object.new
    def bridge.method_missing(*) = raise("must not dispatch")

    assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::NativeDispatch.call_client(bridge, "not_a_method", {})
    end
    assert_raises(SolvaPay::SolvaPayError) do
      SolvaPay::NativeDispatch.call_sync("not_a_method", {})
    end
  end
end
