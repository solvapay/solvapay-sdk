# frozen_string_literal: true

require "time"

module SolvaPay
  CUSTOMER_CACHE_TTL_MS = 60_000
  DEFAULT_LIMITS_CACHE_TTL_MS = 10_000

  class Facade
    BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"

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
      started_ms = @clock.call
      state = nil
      event = {
        "kind" => "start",
        "customerRef" => customer_ref,
        "product" => product,
        "usageType" => usage_type,
        "startedMs" => started_ms,
      }
      action = {} #: Hash[String, untyped]
      loop do
        out = NativeDispatch.call_sync("gate_next", { "state" => state, "event" => event })
        unless out.is_a?(Hash)
          raise SolvaPay::SolvaPayError.new("gate_next returned unexpected value", code: "internal_error")
        end

        state = out["state"]
        next_action = out["action"]
        unless next_action.is_a?(Hash)
          raise SolvaPay::SolvaPayError.new("gate_next returned unexpected action", code: "internal_error")
        end

        action = next_action
        case action["kind"]
        when "ensureCustomer"
          backend = ensure_customer(action["customerRef"])
          event = { "kind" => "customerResolved", "backendRef" => backend, "nowMs" => @clock.call }
        when "lookupCache"
          key = action["key"]
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
          event = { "kind" => "cacheMiss", "nowMs" => now }
          if cached.is_a?(Hash)
            event = {
              "kind" => "cacheHit",
              "remaining" => cached.fetch(:remaining),
              "limits" => cached[:limits],
              "nowMs" => now,
            }
          end
        when "checkLimits"
          if action["cacheDeleteKey"].is_a?(String)
            @mutex.synchronize { @limits_cache.delete(action["cacheDeleteKey"]) }
          end
          limits = @client.check_limits(
            params: {
              "customerRef" => action["customerRef"],
              "productRef" => action["productRef"],
              "meterName" => action["meterName"],
              "includeCheckoutSession" => action["includeCheckoutSession"],
            },
          )
          unless limits.is_a?(Hash)
            limits = {} #: Hash[String, untyped]
          end
          event = { "kind" => "limitsResult", "limits" => limits, "nowMs" => @clock.call }
        when "done"
          apply_gate_cache(action["cache"])
          break
        else
          raise SolvaPay::SolvaPayError.new("gate_next returned unknown action kind", code: "internal_error")
        end
      end

      unless action.is_a?(Hash)
        raise SolvaPay::SolvaPayError.new("gate_next returned unexpected action", code: "internal_error")
      end

      backend_ref = action["customerRef"]
      meter_name = action["meterName"] || usage_type
      if action["track"].is_a?(Hash)
        track_usage_call(
          customer_ref: backend_ref,
          product_ref: product,
          action: meter_name,
          outcome: "paywall",
          duration_ms: action["track"]["durationMs"] || 0,
        )
      end
      if action["outcome"] == "gate"
        gate = action["gate"]
        return PayablePaywallResult.new(content: gate)
      end

      build_allow_result(
        backend_ref: backend_ref,
        product: product,
        usage_type: usage_type,
        decision: { "outcome" => "allow", "limits" => action["limits"] },
        meter_name: meter_name,
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

    def apply_gate_cache(cache)
      return unless cache.is_a?(Hash)

      key = cache["key"]
      return unless key.is_a?(String)

      @mutex.synchronize do
        case cache["op"]
        when "delete"
          @limits_cache.delete(key)
        when "updateRemaining"
          entry = @limits_cache[key]
          entry[:remaining] = cache["remaining"] if entry.is_a?(Hash)
        when "set"
          @limits_cache[key] = {
            timestamp: cache["timestamp"] || @clock.call,
            remaining: cache["remaining"],
            limits: cache["limits"],
          }
        end
      end
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

    def resolved_meter_name(product, usage_type)
      resolved = NativeDispatch.call_sync(
        "resolve_check_limits_params",
        { "productRef" => product, "usageType" => usage_type },
      )
      meter = resolved.is_a?(Hash) ? resolved["meterName"] : nil
      return meter if meter.is_a?(String)

      raise SolvaPayError, "resolve_check_limits_params returned unexpected value"
    end

    def generate_request_id
      suffix = +""
      9.times do
        char = BASE36[Random.rand(36)]
        raise SolvaPayError, "request id generation failed" if char.nil?

        suffix << char
      end
      "solvapay_#{@clock.call}_#{suffix}"
    end

    def iso8601_timestamp
      Time.now.utc.iso8601(3).sub("+00:00", "Z")
    end

    def track_usage_call(customer_ref:, product_ref:, action:, outcome:, duration_ms:)
      @client.track_usage(
        params: {
          "customerRef" => customer_ref,
          "actionType" => "api_call",
          "units" => 1,
          "outcome" => outcome,
          "productRef" => product_ref,
          "duration" => duration_ms,
          "metadata" => { "action" => action, "requestId" => generate_request_id },
          "timestamp" => iso8601_timestamp,
        },
      )
    end

    def build_allow_result(backend_ref:, product:, usage_type:, decision:, meter_name:)
      _ = usage_type
      track_success = lambda do |duration: nil, metadata: nil|
        _ = metadata
        track_usage_call(
          customer_ref: backend_ref,
          product_ref: product,
          action: meter_name,
          outcome: "success",
          duration_ms: duration.nil? ? 0 : duration,
        )
        nil
      end
      track_fail = lambda do |error, duration: nil, metadata: nil|
        _ = error
        _ = metadata
        track_usage_call(
          customer_ref: backend_ref,
          product_ref: product,
          action: meter_name,
          outcome: "fail",
          duration_ms: duration.nil? ? 0 : duration,
        )
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
