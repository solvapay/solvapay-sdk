# frozen_string_literal: true

module SolvaPay
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
    max_retries: MAX_RETRIES,
    initial_delay: INITIAL_DELAY_MS,
    backoff_strategy: RETRY_BACKOFF,
    should_retry: nil,
    on_retry: nil,
    sleeper: ->(seconds) { sleep(seconds) },
    &operation
  )
    raise ArgumentError, "with_retry requires a block" unless operation

    GeneratedRetryLoop.run(
      invoke: operation,
      max_retries: max_retries,
      initial_delay: initial_delay,
      backoff_strategy: backoff_strategy,
      next_delay_ms: lambda { |attempt, retries, delay, strategy|
        NativeDispatch.call_sync(
          "retry_next_delay_ms",
          {
            "attempt" => attempt,
            "maxRetries" => retries,
            "initialDelay" => delay,
            "backoffStrategy" => strategy,
          },
        )
      },
      sleeper: ->(delay_ms) { sleeper.call(delay_ms.to_f / 1_000) },
      should_retry: should_retry,
      on_retry: on_retry,
    )
  end
end
