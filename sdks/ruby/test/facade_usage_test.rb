# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"
require_relative "facade_test"

class FacadeUsageTest < Minitest::Test
  def setup
    @parent = FacadeTest.new("setup")
    @parent.setup
  end

  def teardown
    @parent.teardown
  end

  def assert_volatile_fields(payload)
    assert payload.key?("duration")
    assert payload.key?("timestamp")
    metadata = payload["metadata"]
    assert_instance_of Hash, metadata
    assert metadata.key?("requestId")
  end

  def test_allow_track_usage_matches_contract
    client = FacadeTest::StubClient.new
    facade = SolvaPay.create(api_client: client)
    result = facade.gate("cus_abc", product: "prd_demo")
    assert_instance_of SolvaPay::PayableAllowResult, result
    result.track_success(duration: 12)
    assert_equal 1, client.tracked.length
    payload = client.tracked[0]
    assert_equal "cus_abc", payload["customerRef"]
    assert_equal "api_call", payload["actionType"]
    assert_equal 1, payload["units"]
    assert_equal "success", payload["outcome"]
    assert_equal "prd_demo", payload["productRef"]
    assert_equal "requests", payload["metadata"]["action"]
    assert_volatile_fields(payload)
  end

  def test_handler_failure_track_usage_outcome_fail
    client = FacadeTest::StubClient.new
    facade = SolvaPay.create(api_client: client)
    result = facade.gate("cus_abc", product: "prd_demo")
    assert_instance_of SolvaPay::PayableAllowResult, result
    result.track_fail(RuntimeError.new("boom"), duration: 8)
    assert_equal 1, client.tracked.length
    payload = client.tracked[0]
    assert_equal "fail", payload["outcome"]
    assert_equal "api_call", payload["actionType"]
    assert_equal 1, payload["units"]
    assert_equal "requests", payload["metadata"]["action"]
    assert_volatile_fields(payload)
  end

  def test_pre_check_gate_tracks_paywall_outcome
    client = FacadeTest::StubClient.new(within_limits: false, remaining: 0)
    facade = SolvaPay.create(api_client: client)
    result = facade.gate("cus_abc", product: "prd_demo")
    assert_instance_of SolvaPay::PayablePaywallResult, result
    assert_equal 1, client.tracked.length
    payload = client.tracked[0]
    assert_equal "paywall", payload["outcome"]
    assert_equal "api_call", payload["actionType"]
    assert_equal 1, payload["units"]
    assert_equal "prd_demo", payload["productRef"]
    assert_equal "cus_abc", payload["customerRef"]
    assert_equal "requests", payload["metadata"]["action"]
    assert_volatile_fields(payload)
  end

  def test_track_usage_retries_customer_not_found
    client = FacadeTest::StubClient.new
    attempts = 0
    client.define_singleton_method(:track_usage) do |params:|
      attempts += 1
      raise SolvaPay::SolvaPayError.new("404 - Customer not found") if attempts == 1

      @tracked << params
      { "ok" => true }
    end
    facade = SolvaPay.create(api_client: client)
    result = facade.gate("cus_abc", product: "prd_demo")
    result.track_success(duration: 12)
    assert_equal 2, attempts
    assert_equal 1, client.tracked.length
  end
end
