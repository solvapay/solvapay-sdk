# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"

class FacadeTest < Minitest::Test
  class StubClient
    attr_reader :checks, :gets, :creates, :tracked

    def initialize(within_limits: true, remaining: 3, customer_ref: "cus_stub", lookup_delay: 0)
      @within_limits = within_limits
      @remaining = remaining
      @customer_ref = customer_ref
      @lookup_delay = lookup_delay
      @checks = 0
      @gets = 0
      @creates = 0
      @tracked = []
    end

    def check_limits(params:)
      @checks += 1
      {
        "withinLimits" => @within_limits,
        "remaining" => @remaining,
        "checkoutUrl" => "https://pay.example/checkout",
      }
    end

    def track_usage(params:)
      @tracked << params
      { "ok" => true }
    end

    def get_customer(params:)
      @gets += 1
      sleep(@lookup_delay)
      { "customerRef" => @customer_ref, "externalRef" => params["externalRef"] }
    end

    def create_customer(params:)
      @creates += 1
      { "customerRef" => @customer_ref, "externalRef" => params["externalRef"] }
    end
  end

  def setup
    @decisions = SolvaPay::NativeDispatch.method(:call_sync)
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) do |name, args|
      case name
      when "classify_customer_ref"
        args["customerRef"].start_with?("cus_") ? "backend" : "external"
      when "evaluate_cached_limits"
        remaining = args["remaining"]
        { "withinLimits" => remaining.positive?, "remaining" => [remaining - 1, 0].max, "evict" => remaining <= 0 }
      when "evaluate_fresh_limits"
        { "withinLimits" => args["withinLimits"], "remaining" => args["remaining"] }
      when "decide_paywall_outcome"
        if args["withinLimits"]
          { "outcome" => "allow", "limits" => args["limits"] }
        else
          {
            "outcome" => "gate",
            "gate" => {
              "kind" => "payment_required",
              "product" => args["product"],
              "checkoutUrl" => args["checkoutUrl"],
              "message" => "Payment required",
            },
          }
        end
      when "build_create_customer_params"
        { "externalRef" => args["externalRef"], "email" => "#{args["customerRef"]}@example.test" }
      when "extract_backend_customer_ref"
        args["response"]["customerRef"] || args["fallback"]
      else
        raise "unexpected decision #{name}"
      end
    end
  end

  def teardown
    original = @decisions
    SolvaPay::NativeDispatch.define_singleton_method(:call_sync) { |name, args| original.call(name, args) }
  end

  def test_create_requires_key_without_injected_client
    original = ENV.delete("SOLVAPAY_SECRET_KEY")
    error = assert_raises(SolvaPay::SolvaPayError) { SolvaPay.create }
    assert_equal "missing_api_key", error.code
  ensure
    ENV["SOLVAPAY_SECRET_KEY"] = original if original
  end

  def test_gate_allows_and_tracks_success_and_failure
    client = StubClient.new
    facade = SolvaPay.create(api_client: client)
    result = facade.gate("cus_123", product: "prd_x")

    assert_instance_of SolvaPay::PayableAllowResult, result
    result.track_success(duration: 12, metadata: { "source" => "test" })
    result.track_fail(RuntimeError.new("boom"), duration: 7)
    assert_equal 2, client.tracked.length
    assert_equal "boom", client.tracked.last["metadata"]["error"]
  end

  def test_gate_returns_exact_paywall_content
    client = StubClient.new(within_limits: false, remaining: 0)
    result = SolvaPay.create(api_client: client).gate("cus_123", product: "prd_x")

    assert_instance_of SolvaPay::PayablePaywallResult, result
    assert_equal "payment_required", result.content["kind"]
    assert_equal "prd_x", result.content["product"]
  end

  def test_external_customer_lookup_is_true_single_flight
    client = StubClient.new(lookup_delay: 0.05)
    facade = SolvaPay.create(api_client: client)
    threads = 8.times.map do |index|
      Thread.new { facade.gate("user@example.test", product: "prd_#{index}").customer_ref }
    end

    assert_equal Array.new(8, "cus_stub"), threads.map(&:value)
    assert_equal 1, client.gets
    assert_equal 0, client.creates
  end

  def test_limits_cache_uses_default_ttl_and_decrements
    now = 1_000
    client = StubClient.new(remaining: 3)
    facade = SolvaPay.create(api_client: client, clock: -> { now })

    2.times { facade.gate("cus_123", product: "prd_x") }
    assert_equal 1, client.checks
    now += 10_001
    facade.gate("cus_123", product: "prd_x")
    assert_equal 2, client.checks
  end

  def test_protect_skips_paywalled_block_and_tracks_allowed_calls
    blocked = false
    paywall = SolvaPay.create(api_client: StubClient.new(within_limits: false, remaining: 0))
    protected = paywall.payable(product: "prd_x").protect { blocked = true }
    assert_raises(SolvaPay::PaywallError) { protected.call(customer_ref: "cus_123") }
    assert_equal false, blocked

    client = StubClient.new
    allowed = SolvaPay.create(api_client: client)
    callable = allowed.payable(product: "prd_x").protect { |value:, **| value * 2 }
    assert_equal 6, callable.call(value: 3, customer_ref: "cus_123")
    assert_equal 1, client.tracked.length
  end
end
