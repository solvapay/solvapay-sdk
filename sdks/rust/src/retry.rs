//! Host-side retry loop. Delay math stays in [`solvapay_core::RetryPolicy`];
//! this crate owns timers and `should_retry` / `on_retry` callbacks.

use std::future::Future;
use std::time::Duration;

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
                host_sleep(delay).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}

/// Tokio timer on native hosts.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
async fn host_sleep(delay: Duration) {
    tokio::time::sleep(delay).await;
}

/// Workers / browser isolates have no tokio time driver. Sleep via `setTimeout`.
///
/// A missing or failing timer host continues immediately so retry still
/// progresses instead of panicking.
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
async fn host_sleep(delay: Duration) {
    let millis = u32::try_from(delay.as_millis()).unwrap_or(u32::MAX);
    let promise = js_sys::Promise::new(&mut |resolve, reject| {
        let global = js_sys::global();
        let Ok(timeout_value) =
            js_sys::Reflect::get(&global, &wasm_bindgen::JsValue::from_str("setTimeout"))
        else {
            let _ = reject.call0(&wasm_bindgen::JsValue::UNDEFINED);
            return;
        };
        if timeout_value.is_undefined() || timeout_value.is_null() {
            let _ = reject.call0(&wasm_bindgen::JsValue::UNDEFINED);
            return;
        }
        let timeout = js_sys::Function::from(timeout_value);
        if timeout
            .call2(
                &global,
                &resolve,
                &wasm_bindgen::JsValue::from_f64(f64::from(millis)),
            )
            .is_err()
        {
            let _ = reject.call0(&wasm_bindgen::JsValue::UNDEFINED);
        }
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
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
