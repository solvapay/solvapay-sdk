# frozen_string_literal: true

module SolvaPay
  CUSTOMER_CACHE_TTL_MS = 60_000
  DEFAULT_LIMITS_CACHE_TTL_MS = 10_000

  class Facade
    def initialize(
      api_key: nil,
      api_base_url: nil,
      limits_cache_ttl: DEFAULT_LIMITS_CACHE_TTL_MS,
      api_client: nil,
      clock: nil
    )
      @client = api_client || Client.new(api_key: api_key, api_base_url: api_base_url)
      @limits_cache_ttl = limits_cache_ttl
      @clock = clock || -> { (Time.now.to_f * 1_000).to_i }
      @mutex = Mutex.new
      @customer_cache = {} #: Hash[String, untyped]
      @customer_inflight = {} #: Hash[String, untyped]
      @limits_cache = {} #: Hash[String, untyped]
    end

    # Evaluate the paywall gate for a customer against a product.
    # @param customer_ref [String] Customer reference (backend, email, or anonymous).
    # @param product [String] Product reference used for the gate decision.
    # @param usage_type [String] Usage meter name (default: "requests").
    # @return [PayableAllowResult, PayablePaywallResult] Paywall or allow result with usage trackers.
    def gate(customer_ref, product:, usage_type: "requests")
      backend_ref = ensure_customer(customer_ref)
      limits_key = [backend_ref, product, usage_type].join(":")
      within_limits, remaining, limits = evaluate_limits(
        limits_key,
        customer_ref: backend_ref,
        product: product,
        usage_type: usage_type,
      )
      decision = NativeDispatch.call_sync(
        "decide_paywall_outcome",
        {
          "withinLimits" => within_limits,
          "product" => product,
          "limits" => limits,
          "checkoutUrl" => limits&.fetch("checkoutUrl", nil),
        },
      )
      if decision["outcome"] == "gate"
        gate = decision["gate"]
        gate ||= NativeDispatch.call_sync(
          "build_paywall_gate",
          { "productRef" => product, "limits" => limits || { "remaining" => remaining } },
        )
        return PayablePaywallResult.new(content: gate)
      end

      build_allow_result(
        backend_ref: backend_ref,
        product: product,
        usage_type: usage_type,
        decision: decision,
      )
    end

    # Return a wrapper that gates a callable behind paywall checks.
    # @param product [String] Product reference used for gating.
    # @param usage_type [String] Usage meter name (default: "requests").
    # @return [Payable] Wrapper that enforces the paywall before invocation.
    def payable(product:, usage_type: "requests")
      Payable.new(self, product: product, usage_type: usage_type)
    end

    private

    def evaluate_limits(key, customer_ref:, product:, usage_type:)
      now = @clock.call
      cached = @mutex.synchronize do
        value = @limits_cache[key]
        if value && now - value.fetch(:timestamp) < @limits_cache_ttl
          value.dup
        else
          @limits_cache.delete(key)
          nil
        end
      end

      if cached.is_a?(Hash)
        evaluation = NativeDispatch.call_sync(
          "evaluate_cached_limits",
          { "remaining" => cached.fetch(:remaining) },
        )
        @mutex.synchronize do
          if evaluation["evict"]
            @limits_cache.delete(key)
          elsif evaluation["withinLimits"]
            entry = @limits_cache[key]
            entry[:remaining] = evaluation["remaining"] if entry.is_a?(Hash)
          end
        end
        return [evaluation["withinLimits"], evaluation["remaining"], cached[:limits]]
      end

      limits = @client.check_limits(
        params: {
          "customerRef" => customer_ref,
          "productRef" => product,
          "meterName" => usage_type,
        },
      )
      unless limits.is_a?(Hash)
        limits = {} #: Hash[String, untyped]
      end
      evaluation = NativeDispatch.call_sync(
        "evaluate_fresh_limits",
        {
          # Coerce JSON truthiness to a bool for the decision core.
          "withinLimits" => !!limits["withinLimits"], # rubocop:disable Style/DoubleNegation
          "remaining" => limits.fetch("remaining", 0),
        },
      )
      @mutex.synchronize do
        @limits_cache[key] = {
          timestamp: now,
          remaining: evaluation["remaining"],
          limits: limits,
        }
      end
      [evaluation["withinLimits"], evaluation["remaining"], limits]
    end

    def ensure_customer(customer_ref)
      classification = NativeDispatch.call_sync(
        "classify_customer_ref",
        { "customerRef" => customer_ref },
      )
      return customer_ref if %w[backend anonymous].include?(classification) || customer_ref.start_with?("cus_")

      state, leader = acquire_customer_lookup(customer_ref)
      return await_customer_lookup(state) unless leader

      begin
        result = find_or_create_customer(customer_ref)
        publish_customer_lookup(customer_ref, state, result: result)
        result
      rescue StandardError => e
        publish_customer_lookup(customer_ref, state, error: e)
        raise
      end
    end

    def acquire_customer_lookup(customer_ref)
      @mutex.synchronize do
        cached = @customer_cache[customer_ref]
        if cached && @clock.call < cached.fetch(:expires_at)
          state = { done: true, result: cached.fetch(:value) }
          return [state, false]
        end
        @customer_cache.delete(customer_ref)

        inflight = @customer_inflight[customer_ref]
        return [inflight, false] if inflight

        state = { condition: ConditionVariable.new, done: false, result: nil, error: nil }
        @customer_inflight[customer_ref] = state
        [state, true]
      end
    end

    def await_customer_lookup(state)
      @mutex.synchronize do
        state.fetch(:condition).wait(@mutex) until state.fetch(:done)
        raise state[:error] if state[:error]

        state.fetch(:result)
      end
    end

    def publish_customer_lookup(customer_ref, state, result: nil, error: nil)
      @mutex.synchronize do
        state[:result] = result
        state[:error] = error
        state[:done] = true
        if error.nil?
          @customer_cache[customer_ref] = {
            value: result,
            expires_at: @clock.call + CUSTOMER_CACHE_TTL_MS,
          }
        end
        @customer_inflight.delete(customer_ref)
        state.fetch(:condition).broadcast
      end
    end

    def find_or_create_customer(customer_ref)
      existing = begin
        @client.get_customer(params: { "externalRef" => customer_ref })
      rescue SolvaPayError
        nil
      end
      return existing["customerRef"].to_s if existing.is_a?(Hash) && existing["customerRef"]

      params = NativeDispatch.call_sync(
        "build_create_customer_params",
        {
          "customerRef" => customer_ref,
          "externalRef" => customer_ref,
          "email" => customer_ref.include?("@") ? customer_ref : nil,
          "nowMs" => @clock.call,
        },
      )
      created = @client.create_customer(params: params)
      ref = NativeDispatch.call_sync(
        "extract_backend_customer_ref",
        { "response" => created, "fallback" => customer_ref },
      )
      unless ref.is_a?(String) && !ref.empty?
        raise SolvaPayError.new("create_customer did not return customerRef", code: "invalid_customer")
      end

      ref
    end

    def build_allow_result(backend_ref:, product:, usage_type:, decision:)
      track_success = lambda do |duration: nil, metadata: nil|
        payload = {
          "customerRef" => backend_ref,
          "action" => usage_type,
          "productRef" => product,
        }
        payload["duration"] = duration unless duration.nil?
        payload["metadata"] = metadata unless metadata.nil?
        @client.track_usage(params: payload)
        nil
      end
      track_fail = lambda do |error, duration: nil, metadata: nil|
        failure_metadata = {} #: Hash[String, untyped]
        failure_metadata.merge!(metadata) if metadata.is_a?(Hash)
        failure_metadata["error"] = error.to_s
        tracker = track_success #: untyped
        tracker.call(duration: duration, metadata: failure_metadata)
      end
      PayableAllowResult.new(
        customer_ref: backend_ref,
        decision: decision,
        track_success: track_success,
        track_fail: track_fail,
      )
    end
  end

  class Payable
    def initialize(facade, product:, usage_type:)
      @facade = facade
      @product = product
      @usage_type = usage_type
    end

    # Wrap a callable so each invocation runs through the paywall gate.
    # @yield [*args, **kwargs] The operation to protect.
    # @return [Proc] Callable that gates, invokes, and tracks usage.
    def protect(&operation)
      raise ArgumentError, "protect requires a block" unless operation

      lambda do |*args, **kwargs, &block|
        customer_ref = kwargs[:customer_ref] || "anonymous"
        result = @facade.gate(customer_ref, product: @product, usage_type: @usage_type)
        case result
        when PayablePaywallResult
          raise PaywallError.new("Payment required", result.content)
        when PayableAllowResult
          begin
            value = operation.call(*args, **kwargs, &block)
          rescue StandardError => e
            result.track_fail(e)
            raise
          end
          result.track_success
          value
        else
          raise SolvaPayError.new("unexpected gate result", code: "invalid_gate_result")
        end
      end
    end
  end

  module_function

  # Create the idiomatic high-level SolvaPay facade instance.
  # @param api_key [String, nil] Secret API key (defaults to ENV["SOLVAPAY_SECRET_KEY"]).
  # @param api_base_url [String, nil] Optional API base URL override.
  # @param limits_cache_ttl [Integer] Limits cache TTL in milliseconds.
  # @param api_client [Client, nil] Optional prebuilt client (tests / DI).
  # @param clock [Proc, nil] Optional clock returning epoch milliseconds.
  # @return [Facade] Configured facade instance.
  def create(
    api_key: nil,
    api_base_url: nil,
    limits_cache_ttl: DEFAULT_LIMITS_CACHE_TTL_MS,
    api_client: nil,
    clock: nil
  )
    Facade.new(
      api_key: api_key,
      api_base_url: api_base_url,
      limits_cache_ttl: limits_cache_ttl,
      api_client: api_client,
      clock: clock,
    )
  end
end
