# frozen_string_literal: true

module SolvaPay
  TOPUP_BALANCE_POLL_DELAYS_MS = [500, 1_000, 2_000, 4_000].freeze
  BALANCE_RECONCILE_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000].freeze

  module_function

  # Verify a SolvaPay webhook signature and parse the event payload.
  # @param body [String] Raw webhook request body.
  # @param signature [String] Signature header value.
  # @param secret [String] Webhook signing secret.
  # @return [Hash] Parsed webhook event when verification succeeds.
  def verify_webhook(body:, signature:, secret:)
    NativeDispatch.verify_webhook(body: body, signature: signature, secret: secret)
  end

  # Retry a block with the frozen default backoff policy.
  # @param max_retries [Integer] Maximum retry attempts after the first failure.
  # @param initial_delay [Integer] Initial delay in milliseconds.
  # @param backoff_strategy [String] Backoff strategy name (default: "fixed").
  # @param should_retry [Proc, nil] Optional predicate (error, attempt) -> bool.
  # @param on_retry [Proc, nil] Optional callback (error, attempt, delay_ms).
  # @param sleeper [Proc] Sleep implementation (seconds).
  # @yield [] Operation to retry.
  # @return [Object] The block's return value.
  def with_retry(
    max_retries: 2,
    initial_delay: 500,
    backoff_strategy: "fixed",
    should_retry: nil,
    on_retry: nil,
    sleeper: ->(seconds) { sleep(seconds) },
    &operation
  )
    raise ArgumentError, "with_retry requires a block" unless operation

    attempt = 0
    loop do
      return operation.call
    rescue StandardError => e
      delay_ms = NativeDispatch.call_sync(
        "retry_next_delay_ms",
        {
          "attempt" => attempt,
          "maxRetries" => max_retries,
          "initialDelay" => initial_delay,
          "backoffStrategy" => backoff_strategy,
        },
      )
      raise if delay_ms.nil? || (should_retry && !should_retry.call(e, attempt))

      on_retry&.call(e, attempt, delay_ms)
      sleeper.call(delay_ms.to_f / 1_000)
      attempt += 1
    end
  end
end
