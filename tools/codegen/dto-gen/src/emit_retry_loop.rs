//! `runGeneratedWithRetryLoop` appended to each driver emitter.
//!
//! Delay math stays in `retry_next_delay_ms`. These templates own the host loop:
//! invoke, consult the delay, sleep, repeat. Facades keep only timers and callbacks.

pub const TYPESCRIPT: &str = r#"
export type RetryDelayArgs = {
  attempt: number
  maxRetries: number
  initialDelay: number
  backoffStrategy: string
}

export type RetryLoopHost<T> = {
  maxRetries: number
  initialDelay: number
  backoffStrategy: string
  invoke(): Promise<T>
  sleep(delayMs: number): Promise<void>
  nextDelayMs(args: RetryDelayArgs): number | null
  shouldRetry?(error: Error, attempt: number): boolean
  onRetry?(error: Error, attempt: number, delayMs: number): void
}

export async function runGeneratedWithRetryLoop<T>(host: RetryLoopHost<T>): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await host.invoke()
    } catch (error) {
      const lastError = error instanceof Error ? error : new Error(String(error))
      const delay = host.nextDelayMs({
        attempt,
        maxRetries: host.maxRetries,
        initialDelay: host.initialDelay,
        backoffStrategy: host.backoffStrategy,
      })
      if (delay === null) {
        throw lastError
      }
      if (host.shouldRetry && !host.shouldRetry(lastError, attempt)) {
        throw lastError
      }
      if (host.onRetry) {
        host.onRetry(lastError, attempt, delay)
      }
      await host.sleep(delay)
      attempt += 1
    }
  }
}
"#;

pub const PYTHON: &str = r#"

def run_generated_with_retry_blocking(
    invoke,
    *,
    max_retries: int,
    initial_delay: int,
    backoff_strategy: str,
    next_delay_ms,
    sleep,
    should_retry=None,
    on_retry=None,
):
    """Blocking host retry loop. `next_delay_ms` is the core delay function."""
    attempt = 0
    while True:
        try:
            return invoke()
        except Exception as err:
            delay = next_delay_ms(attempt, max_retries, initial_delay, backoff_strategy)
            if delay is None:
                raise
            if should_retry is not None and not should_retry(err, attempt):
                raise
            if on_retry is not None:
                on_retry(err, attempt, delay)
            sleep(delay)
            attempt += 1


async def run_generated_with_retry_async(
    invoke,
    *,
    max_retries: int,
    initial_delay: int,
    backoff_strategy: str,
    next_delay_ms,
    sleep,
    should_retry=None,
    on_retry=None,
):
    """Async host retry loop. `sleep` and `invoke` may be coroutines."""
    import inspect

    attempt = 0
    while True:
        try:
            result = invoke()
            if inspect.isawaitable(result):
                result = await result
            return result
        except Exception as err:
            delay = next_delay_ms(attempt, max_retries, initial_delay, backoff_strategy)
            if delay is None:
                raise
            if should_retry is not None and not should_retry(err, attempt):
                raise
            if on_retry is not None:
                on_retry(err, attempt, delay)
            slept = sleep(delay)
            if inspect.isawaitable(slept):
                await slept
            attempt += 1
"#;

pub const GO: &str = r#"
// RetryLoopHost is the I/O surface for [`RunGeneratedWithRetryLoop`].
type RetryLoopHost[T any] struct {
	MaxRetries      int
	InitialDelayMs  int
	BackoffStrategy string
	Invoke          func() (T, error)
	Sleep           func(delayMs int) error
	NextDelayMs     func(attempt int, maxRetries int, initialDelayMs int, backoffStrategy string) (int, bool, error)
	ShouldRetry     func(err error, attempt int) bool
	OnRetry         func(err error, attempt int, delayMs int)
}

// RunGeneratedWithRetryLoop drives invoke → core delay → sleep until success or exhaustion.
func RunGeneratedWithRetryLoop[T any](host RetryLoopHost[T]) (T, error) {
	var zero T
	if host.Invoke == nil || host.NextDelayMs == nil || host.Sleep == nil {
		return zero, fmt.Errorf("solvapay: retry loop host is missing invoke, delay, or sleep")
	}
	attempt := 0
	for {
		value, err := host.Invoke()
		if err == nil {
			return value, nil
		}
		delayMs, ok, delayErr := host.NextDelayMs(attempt, host.MaxRetries, host.InitialDelayMs, host.BackoffStrategy)
		if delayErr != nil {
			return zero, delayErr
		}
		if !ok {
			return zero, err
		}
		if host.ShouldRetry != nil && !host.ShouldRetry(err, attempt) {
			return zero, err
		}
		if host.OnRetry != nil {
			host.OnRetry(err, attempt, delayMs)
		}
		if sleepErr := host.Sleep(delayMs); sleepErr != nil {
			return zero, sleepErr
		}
		attempt++
	}
}
"#;

pub const RUBY: &str = r#"
module SolvaPay
  module GeneratedRetryLoop
    def self.run(
      invoke:,
      max_retries:,
      initial_delay:,
      backoff_strategy:,
      next_delay_ms:,
      sleeper:,
      should_retry: nil,
      on_retry: nil
    )
      attempt = 0
      loop do
        return invoke.call
      rescue StandardError => e
        delay_ms = next_delay_ms.call(attempt, max_retries, initial_delay, backoff_strategy)
        raise if delay_ms.nil? || (should_retry && !should_retry.call(e, attempt))

        on_retry&.call(e, attempt, delay_ms)
        sleeper.call(delay_ms)
        attempt += 1
      end
    end
  end
end
"#;

pub const RUST: &str = r#"
#[allow(clippy::too_many_arguments)]
pub async fn run_generated_with_retry_loop<T, E, F, Fut, D, S, O, Z, ZFut>(
    invoke: F,
    max_retries: u32,
    initial_delay_ms: u64,
    backoff: solvapay_core::Backoff,
    next_delay_ms: D,
    should_retry: S,
    on_retry: O,
    sleep: Z,
) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    D: Fn(u32, u32, u64, solvapay_core::Backoff) -> Option<u64>,
    S: Fn(&E, u32) -> bool,
    O: Fn(&E, u32, u64),
    Z: Fn(std::time::Duration) -> ZFut,
    ZFut: Future<Output = ()>,
{
    let mut attempt = 0_u32;
    loop {
        match invoke().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                let Some(delay_ms) =
                    next_delay_ms(attempt, max_retries, initial_delay_ms, backoff)
                else {
                    return Err(err);
                };
                if !should_retry(&err, attempt) {
                    return Err(err);
                }
                on_retry(&err, attempt, delay_ms);
                sleep(std::time::Duration::from_millis(delay_ms)).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}
"#;
