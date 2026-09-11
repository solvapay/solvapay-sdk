//! Embedded tokio current-thread runtime for blocking C ABI calls.
//!
//! Mirrors the facade `blocking` feature (`solvapay::blocking`).

use std::sync::OnceLock;

/// Process-wide current-thread tokio runtime for blocking C ABI calls.
static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

/// Returns the process-wide current-thread runtime.
///
/// Aborts if the runtime cannot be built (same policy as the facade `blocking` feature).
pub fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => std::process::abort(),
        }
    })
}
