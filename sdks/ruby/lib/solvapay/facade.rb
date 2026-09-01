# frozen_string_literal: true

require "time"
require_relative "defaults"

module SolvaPay
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
      started_ms = @clock.call
      state = nil
      event = {
        "kind" => "start",
        "customerRef" => customer_ref,
        "product" => product,
        "usageType" => usage_type,
        "startedMs" => started_ms,
        "limitsCacheTTLMs" => @limits_cache_ttl,
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
        when "readLimitsCache"
          key = action["key"]
          now = @clock.call
          cached = @mutex.synchronize { @limits_cache[key] }
          event = if cached.is_a?(Hash)
                    {
                      "kind" => "limitsCacheEntry",
                      "found" => true,
                      "remaining" => cached.fetch(:remaining),
                      "limits" => cached[:limits],
                      "timestampMs" => cached.fetch(:timestamp),
                      "nowMs" => now,
                      "randomUnit" => random_unit,
                    }
                  else
                    {
                      "kind" => "limitsCacheEntry",
                      "found" => false,
                      "nowMs" => now,
                      "randomUnit" => random_unit,
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
            raise SolvaPay::SolvaPayError.new("checkLimits returned a non-object body", code: "invalid_limits")
          end
          event = {
            "kind" => "limitsResult",
            "limits" => limits,
            "nowMs" => @clock.call,
            "randomUnit" => random_unit,
          }
        when "allow", "gate"
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
      post_usage_request(action["request"]) if action["request"].is_a?(Hash)
      if action["kind"] == "gate"
        gate = action["gate"]
        return PayablePaywallResult.new(content: gate)
      end

      build_allow_result(
        backend_ref: backend_ref,
        decision: { "outcome" => "allow", "limits" => action["limits"] },
        driver_state: state,
      )
    end

    # Return a wrapper that gates a callable behind paywall checks.
    # @param product [String] Product reference used for gating.
    # @param usage_type [String] Usage meter name (default: "requests").
    # @return [Payable] Wrapper that enforces the paywall before invocation.
    def payable(product:, usage_type: "requests")
      Payable.new(self, product: product, usage_type: usage_type)
    end

    # Record a usage event through the same retry path as `payable` handlers.
    # @param params [Hash] Track-usage request body.
    def track_usage(params:)
      post_usage_request(params)
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
          unless cache["timestamp"].is_a?(Numeric)
            raise SolvaPay::SolvaPayError.new("gate_next cache set missing timestamp", code: "internal_error")
          end

          @limits_cache[key] = {
            timestamp: cache["timestamp"],
            remaining: cache["remaining"],
            limits: cache["limits"],
            checkoutUrl: cache["checkoutUrl"],
            meterName: cache["meterName"],
          }
        end
      end
    end

    def ensure_customer(customer_ref)
      state, leader = acquire_customer_lookup(customer_ref)
      return await_customer_lookup(state) unless leader

      begin
        result = run_ensure_customer(customer_ref)
        publish_customer_lookup(customer_ref, state, result: result)
        result
      rescue StandardError => e
        publish_customer_lookup(customer_ref, state, error: e)
        raise
      end
    end

    def acquire_customer_lookup(customer_ref)
      @mutex.synchronize do
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
        @customer_inflight.delete(customer_ref)
        state.fetch(:condition).broadcast
      end
    end

    def run_ensure_customer(customer_ref)
      state = nil
      event = {
        "kind" => "start",
        "customerRef" => customer_ref,
        "canCreateCustomer" => true,
        "canUpdateCustomer" => true,
        "nowMs" => @clock.call,
      }
      loop do
        out = NativeDispatch.call_sync("ensure_customer_next", { "state" => state, "event" => event })
        unless out.is_a?(Hash)
          raise SolvaPay::SolvaPayError.new("ensure_customer_next returned unexpected value", code: "internal_error")
        end

        unless out["action"].is_a?(Hash)
          details = out["details"]
          details = out["error"] unless details.is_a?(String) && !details.empty?
          raise SolvaPay::SolvaPayError.new(details.to_s, code: "internal_error")
        end
        state = out["state"]
        action = out["action"]
        case action["kind"]
        when "readCustomerCache"
          key = action["key"].to_s
          cached = @mutex.synchronize { @customer_cache[key] }
          event = if cached.is_a?(Hash)
                    {
                      "kind" => "customerCacheEntry",
                      "found" => true,
                      "backendRef" => cached[:value],
                      "timestampMs" => cached[:timestamp_ms],
                      "nowMs" => @clock.call,
                    }
                  else
                    { "kind" => "customerCacheEntry", "found" => false, "nowMs" => @clock.call }
                  end
        when "getCustomer"
          params = if action["byExternalRef"]
                     { "externalRef" => action["byExternalRef"] }
                   else
                     { "email" => action["byEmail"] }
                   end
          begin
            existing = @client.get_customer(params: params)
            event = if existing.is_a?(Hash) && existing["customerRef"]
                      {
                        "kind" => "customerLookupResult",
                        "found" => true,
                        "customer" => existing,
                        "nowMs" => @clock.call,
                      }
                    else
                      { "kind" => "customerLookupResult", "found" => false, "nowMs" => @clock.call }
                    end
          rescue SolvaPayError => e
            event = {
              "kind" => "customerLookupResult",
              "found" => false,
              "errorMessage" => e.message,
              "nowMs" => @clock.call,
            }
          end
        when "createCustomer"
          begin
            created = @client.create_customer(params: action["params"])
            event = {
              "kind" => "customerCreateResult",
              "ok" => true,
              "customer" => created,
              "nowMs" => @clock.call,
            }
          rescue SolvaPayError => e
            event = {
              "kind" => "customerCreateResult",
              "ok" => false,
              "errorMessage" => e.message,
              "nowMs" => @clock.call,
            }
          end
        when "updateCustomer"
          begin
            @client.update_customer(customer_ref: action["customerRef"], params: action["patch"])
            event = { "kind" => "customerUpdateResult", "ok" => true, "nowMs" => @clock.call }
          rescue SolvaPayError => e
            event = {
              "kind" => "customerUpdateResult",
              "ok" => false,
              "errorMessage" => e.message,
              "nowMs" => @clock.call,
            }
          end
        when "resolved"
          backend = action["backendRef"]
          unless backend.is_a?(String) && !backend.empty?
            raise SolvaPayError.new("ensure_customer_next resolved without backendRef", code: "internal_error")
          end

          cache = action["cache"]
          if cache.is_a?(Hash) && cache["key"].is_a?(String)
            write_customer_cache(cache["key"], backend, cache["timestampMs"])
          end
          return backend
        else
          raise SolvaPay::SolvaPayError.new("ensure_customer_next unknown action kind", code: "internal_error")
        end
      end
    end

    def paywall_short_message(content)
      raise SolvaPayError.new("paywall result missing gate content", code: "internal_error") unless content.is_a?(Hash)

      message = content["shortMessage"]
      unless message.is_a?(String) && !message.empty?
        raise SolvaPayError.new("paywall gate missing shortMessage", code: "internal_error")
      end

      message
    end

    def write_customer_cache(key, backend_ref, timestamp_ms)
      @mutex.synchronize do
        @customer_cache[key] = {
          value: backend_ref,
          timestamp_ms: timestamp_ms,
        }
        overflow = @customer_cache.size - CUSTOMER_DEDUP_MAX_CACHE_SIZE
        next if overflow <= 0

        oldest = @customer_cache.min_by(overflow) { |_cache_key, entry| entry[:timestamp_ms].to_i }
        oldest.map { |cache_key, _entry| cache_key }.each { |cache_key| @customer_cache.delete(cache_key) }
      end
    end

    def random_unit
      Random.rand
    end

    def post_usage_request(request)
      SolvaPay.with_retry(
        should_retry: lambda { |error, _attempt|
          SolvaPay::NativeDispatch.call_sync(
            "should_retry_usage_error",
            { "message" => error.message },
          )
        },
      ) { @client.track_usage(params: request) }
    end

    def emit_handler_usage(state, event)
      out = NativeDispatch.call_sync("gate_next", { "state" => state, "event" => event })
      unless out.is_a?(Hash)
        raise SolvaPay::SolvaPayError.new("gate_next returned unexpected value", code: "internal_error")
      end

      action = out["action"]
      unless action.is_a?(Hash)
        raise SolvaPay::SolvaPayError.new("gate_next returned unexpected action", code: "internal_error")
      end

      return if action["kind"] == "skipUsage"
      unless action["kind"] == "emitUsage" && action["request"].is_a?(Hash)
        raise SolvaPay::SolvaPayError.new("gate_next handler event returned unexpected action", code: "internal_error")
      end

      post_usage_request(action["request"])
    end

    def build_allow_result(backend_ref:, decision:, driver_state:)
      track_success = lambda do |duration: nil, metadata: nil|
        _ = metadata
        emit_handler_usage(
          driver_state,
          {
            "kind" => "handlerSucceeded",
            "durationMs" => duration.nil? ? 0 : duration,
            "nowMs" => @clock.call,
            "randomUnit" => random_unit,
          },
        )
        nil
      end
      track_fail = lambda do |error, duration: nil, metadata: nil|
        _ = metadata
        emit_handler_usage(
          driver_state,
          {
            "kind" => "handlerFailed",
            "durationMs" => duration.nil? ? 0 : duration,
            "nowMs" => @clock.call,
            "randomUnit" => random_unit,
            "errorMessage" => error.to_s,
            "isPaywallError" => error.is_a?(PaywallError),
          },
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
        customer_ref = extract_customer_ref(args, kwargs)
        result = @facade.gate(customer_ref, product: @product, usage_type: @usage_type)
        case result
        when PayablePaywallResult
          raise PaywallError.new(@facade.send(:paywall_short_message, result.content), result.content)
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

    private

    def extract_customer_ref(args, kwargs)
      kw = kwargs[:customer_ref]
      return kw if kw.is_a?(String) && !kw.empty?

      first = args[0]
      return "anonymous" unless first.is_a?(Hash)

      auth = first[:auth] || first["auth"]
      if auth.is_a?(Hash)
        from_auth = auth[:customer_ref] || auth["customer_ref"]
        return from_auth if from_auth.is_a?(String) && !from_auth.empty?
      end
      from_first = first[:customer_ref] || first["customer_ref"]
      return from_first if from_first.is_a?(String) && !from_first.empty?

      "anonymous"
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
