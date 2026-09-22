//! Injectable unix-seconds clock for expiry math.

use std::sync::Arc;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::ExampleError;

/// Returns the current unix timestamp in seconds.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub type UnixNow = Arc<dyn Fn() -> Result<i64, ExampleError> + Send + Sync>;
/// Returns the current unix timestamp in seconds (wasm, isolate-local).
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub type UnixNow = Arc<dyn Fn() -> Result<i64, ExampleError>>;

/// Wall-clock unix seconds.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[must_use]
pub fn system_now() -> UnixNow {
    Arc::new(|| {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| ExampleError::new(format!("system clock before unix epoch: {e}")))?;
        i64::try_from(elapsed.as_secs())
            .map_err(|_| ExampleError::new("system clock overflowed i64 seconds"))
    })
}

/// Frozen clock for tests.
#[must_use]
pub fn fixed_now(seconds: i64) -> UnixNow {
    Arc::new(move || Ok(seconds))
}
