# frozen_string_literal: true

require "json"

module Contract
  module HostAdapters
    HOST_FUNCTIONS = %w[
      withRetry
      pollBalanceUntilIncreased
      TOPUP_BALANCE_POLL_DELAYS_MS
      BALANCE_RECONCILE_DELAYS_MS
      resolveAuthenticatedUser
    ].freeze

    module_function

    def invoke(name, args, clock: nil)
      case name
      when "withRetry" then with_retry(args)
      when "pollBalanceUntilIncreased" then poll_balance(args)
      when "TOPUP_BALANCE_POLL_DELAYS_MS" then SolvaPay::TOPUP_BALANCE_POLL_DELAYS_MS.dup
      when "BALANCE_RECONCILE_DELAYS_MS" then SolvaPay::BALANCE_RECONCILE_DELAYS_MS.dup
      when "resolveAuthenticatedUser"
        payload = args.dup
        payload["nowUnixSecs"] = clock ? Clock.unix_secs(clock) : payload.fetch("nowUnixSecs", 1_700_000_000)
        envelope = SolvaPay::NativeDispatch.native_module.public_send(
          "_resolve_authenticated_user",
          JSON.generate(payload),
        )
        SolvaPay::NativeDispatch.unwrap(envelope)
      else
        raise KeyError, "no host adapter for #{name}"
      end
    end

    def with_retry(args)
      attempts = args.fetch("attempts")
      options = args["options"].is_a?(Hash) ? args["options"] : {}
      max_retries = options.fetch("maxRetries", 2)
      initial_delay = options.fetch("initialDelay", 500)
      backoff = options.fetch("backoffStrategy", "fixed")
      events = []
      delays = []
      call_index = 0
      loop do
        attempt = call_index
        events << "call:#{attempt}"
        spec = attempts[call_index]
        call_index += 1
        if spec.is_a?(Hash) && spec.key?("resolve")
          return { "delays" => delays, "events" => events, "outcome" => { "type" => "resolved", "value" => spec["resolve"] } }
        end
        error_message = if spec.is_a?(Hash) && spec.key?("throw")
                          spec["throw"].to_s
                        elsif spec.is_a?(Hash) && spec.key?("throwRaw")
                          js_string(spec["throwRaw"])
                        else
                          "withRetry scenario exhausted attempts at call:#{attempt}"
                        end
        delay = SolvaPay::NativeDispatch.call_sync(
          "retry_next_delay_ms",
          {
            "attempt" => attempt,
            "maxRetries" => max_retries,
            "initialDelay" => initial_delay,
            "backoffStrategy" => backoff,
          },
        )
        return rejected(events, delays, error_message) if delay.nil?

        if args.key?("shouldRetry")
          allowed = should_retry?(args["shouldRetry"], attempt)
          events << "shouldRetry:#{attempt}=#{allowed}"
          return rejected(events, delays, error_message) unless allowed
        end
        events << "onRetry:#{attempt}" if args["onRetry"] == true
        delays << delay.to_i
        events << "sleep:#{delay.to_i}"
      end
    end

    def rejected(events, delays, message)
      {
        "delays" => delays,
        "events" => events,
        "outcome" => { "type" => "rejected", "name" => "Error", "message" => message },
      }
    end

    def should_retry?(spec, attempt)
      return true if spec == "always"
      return false if spec == "never"
      return !spec.fetch("vetoAt", []).map(&:to_i).include?(attempt) if spec.is_a?(Hash)

      raise ArgumentError, "unsupported shouldRetry spec: #{spec.inspect}"
    end

    def js_string(value)
      return "null" if value.nil?
      return value.to_s if value.is_a?(String) || value.is_a?(Numeric)
      return value ? "true" : "false" if [true, false].include?(value)

      "[object Object]"
    end

    def poll_balance(args)
      baseline = args.fetch("baseline").to_f
      observations = args.fetch("observations")
      delays = case args["delays"]
               when nil, "reconcile" then SolvaPay::BALANCE_RECONCILE_DELAYS_MS
               when "topup" then SolvaPay::TOPUP_BALANCE_POLL_DELAYS_MS
               else args["delays"]
               end
      recorded = []
      observations = observations.dup
      delays.each do |delay|
        recorded << delay.to_i
        observation = observations.shift
        next if observation.nil? || observation.key?("throw")

        delta = observation.fetch("credits").to_f - baseline
        next unless delta.positive?

        value = delta.to_i == delta ? delta.to_i : delta
        return { "delays" => recorded, "result" => { "creditsAdded" => value } }
      end
      { "delays" => recorded, "result" => nil }
    end
  end
end
