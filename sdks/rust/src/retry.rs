//! Host-side retry loop. Delay math stays in [`solvapay_core::RetryPolicy`];
//! this crate owns timers and `should_retry` / `on_retry` callbacks.

use std::future::Future;

use solvapay_core::RetryPolicy;

/// Retry `operation` using [`RetryPolicy::next_delay`] and `tokio::time::sleep`.
pub async fn with_retry<T, E, F, Fut>(operation: F, policy: RetryPolicy) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    with_retry_if(operation, policy, |_err, _attempt| true).await
}

/// Same as [`with_retry`] with a host `should_retry` predicate.
pub async fn with_retry_if<T, E, F, Fut, S>(
    operation: F,
    policy: RetryPolicy,
    should_retry: S,
) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    S: Fn(&E, u32) -> bool,
{
    let mut attempt = 0_u32;
    loop {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                let Some(delay) = policy.next_delay(attempt) else {
                    return Err(err);
                };
                if !should_retry(&err, attempt) {
                    return Err(err);
                }
                tokio::time::sleep(delay).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::with_retry;
    use solvapay_core::{Backoff, RetryPolicy};
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn retries_until_success() {
        let calls = AtomicU32::new(0);
        let policy = RetryPolicy {
            max_retries: 2,
            initial_delay_ms: 0,
            backoff: Backoff::Fixed,
        };
        let result = with_retry(
            || async {
                let n = calls.fetch_add(1, Ordering::SeqCst);
                if n == 0 {
                    Err("once")
                } else {
                    Ok(7_u8)
                }
            },
            policy,
        )
        .await;
        assert_eq!(result, Ok(7));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
