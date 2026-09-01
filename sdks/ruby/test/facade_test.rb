# frozen_string_literal: true

require "minitest/autorun"
require "solvapay"

class FacadeTest < Minitest::Test
  def self.fake_gate_next(args)
    event = args["event"].is_a?(Hash) ? args["event"] : {}
    state = args["state"].is_a?(Hash) ? args["state"] : {}
    kind = event["kind"]
    case kind
    when "start"
      ref = event["customerRef"].to_s
      product = event["product"]
      usage = event["usageType"] || "requests"
      started = event["startedMs"]
      if ref.start_with?("cus_") || ref == "anonymous"
        key = "#{ref}:#{product}:#{usage}"
        {
          "state" => {
            "product" => product,
            "meterName" => usage,
            "originalCustomerRef" => ref,
            "backendRef" => ref,
            "startedMs" => started,
            "limitsKey" => key,
            "limitsCacheTTLMs" => event["limitsCacheTTLMs"] || 10_000,
          },
          "action" => { "kind" => "readLimitsCache", "key" => key },
        }
      else
        {
          "state" => {
            "product" => product,
            "meterName" => usage,
            "originalCustomerRef" => ref,
            "startedMs" => started,
          },
          "action" => { "kind" => "ensureCustomer", "customerRef" => ref },
        }
      end
    when "customerResolved"
      backend = event["backendRef"]
      key = "#{backend}:#{state["product"]}:#{state["meterName"]}"
      {
        "state" => state.merge("backendRef" => backend, "limitsKey" => key),
        "action" => { "kind" => "readLimitsCache", "key" => key },
      }
    when "limitsCacheEntry"
      ttl = (state["limitsCacheTTLMs"] || 10_000).to_i
      now = (event["nowMs"] || 0).to_i
      ts = (event["timestampMs"] || 0).to_i
      stale = event["found"] && now - ts >= ttl
      unless event["found"] && !stale
        return {
          "state" => state,
          "action" => {
            "kind" => "checkLimits",
            "customerRef" => state["backendRef"],
            "productRef" => state["product"],
            "meterName" => state["meterName"],
            "includeCheckoutSession" => true,
            "cacheDeleteKey" => state["limitsKey"],
          },
        }
      end
      remaining = event["remaining"] || 0
      limits = event["limits"] || {}
      backend = state["backendRef"]
      if remaining.positive?
        {
          "state" => state,
          "action" => {
            "kind" => "allow",
            "customerRef" => backend,
            "product" => state["product"],
            "meterName" => state["meterName"],
            "limits" => limits,
            "cache" => {
              "op" => "updateRemaining",
              "key" => state["limitsKey"],
              "remaining" => [remaining - 1, 0].max,
            },
          },
        }
      else
        {
          "state" => state,
          "action" => {
            "kind" => "gate",
            "customerRef" => backend,
            "product" => state["product"],
            "meterName" => state["meterName"],
            "limits" => limits,
            "gate" => {
              "kind" => "payment_required",
              "product" => state["product"],
              "checkoutUrl" => "https://pay.example/x",
              "message" => "Payment required",
              "shortMessage" => "Payment required",
            },
          },
        }
      end
    when "limitsResult"
      limits = event["limits"].is_a?(Hash) ? event["limits"] : {}
      backend = state["backendRef"]
      if limits["withinLimits"]
        remaining = limits["remaining"] || 0
        {
          "state" => state,
          "action" => {
            "kind" => "allow",
            "customerRef" => backend,
            "product" => state["product"],
            "meterName" => state["meterName"],
            "limits" => limits,
            "cache" => {
              "op" => "set",
              "key" => state["limitsKey"],
              "remaining" => remaining.positive? ? [remaining - 1, 0].max : 0,
              "limits" => limits,
              "timestamp" => event["nowMs"],
            },
          },
        }
      else
        {
          "state" => state,
          "action" => {
            "kind" => "gate",
            "customerRef" => backend,
            "product" => state["product"],
            "meterName" => state["meterName"],
            "limits" => limits,
            "gate" => {
              "kind" => "payment_required",
              "product" => state["product"],
              "checkoutUrl" => limits["checkoutUrl"] || "https://pay.example/x",
              "message" => "Payment required",
              "shortMessage" => "Payment required",
            },
            "request" => fake_usage_request(state, "paywall"),
          },
        }
      end
    when "handlerSucceeded"
      {
        "state" => state,
        "action" => {
          "kind" => "emitUsage",
          "request" => fake_usage_request(state, "success", event["durationMs"] || 0),
        },
      }
    when "handlerFailed"
      if event["isPaywallError"]
        { "state" => state, "action" => { "kind" => "skipUsage" } }
      else
        {
          "state" => state,
          "action" => {
            "kind" => "emitUsage",
            "request" => fake_usage_request(state, "fail", event["durationMs"] || 0),
          },
        }
      end
    else
      raise "unexpected gate_next event #{kind}"
    end
  end

  def self.fake_ensure_customer_next(args)
    event = args["event"].is_a?(Hash) ? args["event"] : {}
    state = args["state"].is_a?(Hash) ? args["state"] : {}
    case event["kind"]
    when "start"
      ref = event["customerRef"].to_s
      {
        "state" => { "customerRef" => ref },
        "action" => { "kind" => "readCustomerCache", "key" => ref },
      }
    when "customerCacheEntry"
      if event["found"]
        {
          "state" => state,
          "action" => { "kind" => "resolved", "backendRef" => event["backendRef"] },
        }
      else
        {
          "state" => state,
          "action" => { "kind" => "getCustomer", "byExternalRef" => state["customerRef"] },
        }
      end
    when "customerLookupResult"
      if event["found"]
        ref = event.dig("customer", "customerRef")
        {
          "state" => state,
          "action" => {
            "kind" => "resolved",
            "backendRef" => ref,
            "cache" => {
              "key" => state["customerRef"],
              "backendRef" => ref,
              "timestampMs" => event["nowMs"],
            },
          },
        }
      else
        {
          "state" => state,
          "action" => {
            "kind" => "createCustomer",
            "params" => { "externalRef" => state["customerRef"] },
          },
        }
      end
    when "customerCreateResult"
      ref = event.dig("customer", "customerRef")
      {
        "state" => state,
        "action" => {
          "kind" => "resolved",
          "backendRef" => ref,
          "cache" => {
            "key" => state["customerRef"],
            "backendRef" => ref,
            "timestampMs" => event["nowMs"],
          },
        },
      }
    else
      raise "unexpected ensure_customer_next event #{event["kind"]}"
    end
  end

  def self.fake_usage_request(state, outcome, duration = 0)
    {
      "customerRef" => state["backendRef"],
      "actionType" => "api_call",
      "units" => 1,
      "outcome" => outcome,
      "productRef" => state["product"],
      "duration" => duration,
      "metadata" => { "action" => state["meterName"], "requestId" => "solvapay_test" },
      "timestamp" => "1970-01-01T00:00:00.000Z",
    }
  end

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
              "shortMessage" => "Payment required",
            },
          }
        end
      when "build_create_customer_params"
        { "externalRef" => args["externalRef"], "email" => "#{args["customerRef"]}@example.test" }
      when "extract_backend_customer_ref"
        args["response"]["customerRef"] || args["fallback"]
      when "resolve_check_limits_params"
        { "productRef" => args["productRef"], "meterName" => args["usageType"] }
      when "gate_next"
        FacadeTest.fake_gate_next(args)
      when "ensure_customer_next"
        FacadeTest.fake_ensure_customer_next(args)
      when "should_retry_usage_error"
        args["message"].to_s.include?("Customer not found")
      when "retry_next_delay_ms"
        attempt = args["attempt"].to_i
        max = args["maxRetries"].to_i
        attempt < max ? 0 : nil
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
    assert_equal "success", client.tracked.first["outcome"]
    assert_equal "fail", client.tracked.last["outcome"]
    refute client.tracked.last.fetch("metadata").key?("error")
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

  def test_customer_cache_evicts_past_max
    facade = SolvaPay.create(api_client: StubClient.new)
    assert_equal 1000, SolvaPay::CUSTOMER_DEDUP_MAX_CACHE_SIZE
    (SolvaPay::CUSTOMER_DEDUP_MAX_CACHE_SIZE + 1).times do |index|
      facade.send(:write_customer_cache, "k#{index}", "cus_#{index}", index)
    end
    cache = facade.instance_variable_get(:@customer_cache)
    refute cache.key?("k0")
    assert cache.key?("k#{SolvaPay::CUSTOMER_DEDUP_MAX_CACHE_SIZE}")
    assert_equal SolvaPay::CUSTOMER_DEDUP_MAX_CACHE_SIZE, cache.size
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
    assert_equal "Payment required", begin
      paywall.payable(product: "prd_x").protect { true }.call(customer_ref: "cus_123")
    rescue SolvaPay::PaywallError => error
      error.message
    end

    activation = SolvaPay.create(api_client: StubClient.new(within_limits: false, remaining: 0))
    def activation.gate(*, **)
      SolvaPay::PayablePaywallResult.new(
        content: {
          "kind" => "activation_required",
          "product" => "prd_x",
          "message" => "Activate a plan",
          "shortMessage" => "Activation required",
          "checkoutUrl" => "https://pay.example/x",
        },
      )
    end
    error = assert_raises(SolvaPay::PaywallError) do
      activation.payable(product: "prd_x").protect { true }.call(customer_ref: "cus_123")
    end
    assert_equal "Activation required", error.message

    client = StubClient.new
    allowed = SolvaPay.create(api_client: client)
    callable = allowed.payable(product: "prd_x").protect { |value:, **| value * 2 }
    assert_equal 6, callable.call(value: 3, customer_ref: "cus_123")
    assert_equal 1, client.tracked.length

    positional = allowed.payable(product: "prd_x").protect { |*_args, **| true }
    positional.call({ "auth" => { "customer_ref" => "cus_123" } })
    assert_equal 2, client.tracked.length
  end

  def test_gate_rejects_non_object_limits_body
    client = StubClient.new
    def client.check_limits(params:)
      @checks += 1
      []
    end
    facade = SolvaPay.create(api_client: client)
    error = assert_raises(SolvaPay::SolvaPayError) { facade.gate("cus_123", product: "prd_x") }
    assert_match(/non-object/, error.message)
  end
end
