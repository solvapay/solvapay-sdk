//! JSON-envelope + args-parsing helpers for the WASI guest.
//!
//! Domain errors never unwind across the host boundary — they serialize into
//! `{"ok":false,"error":<SdkError JSON>}`. The `SdkError` `code` (webhook) or
//! `kind` is what the Go side matches with `errors.As`.
//!
//! # Panic safety
//!
//! `panic = "abort"` on `wasm-release`, so there is no `catch_unwind` here — the
//! helpers only map `Result` (§7.6).

use serde::Serialize;
use solvapay_core::SdkError;

#[allow(unused_imports)] // re-export the full shared envelope surface
pub use solvapay_core::{err_envelope, internal_error_envelope, ok_envelope, parse_args_json};

/// Runs a sync core call and returns a JSON envelope string.
///
/// `panic = "abort"` on `wasm-release`, so this does not `catch_unwind` (§7.6).
pub fn run_envelope_sync<T, F>(f: F) -> String
where
    T: Serialize,
    F: FnOnce() -> Result<T, SdkError>,
{
    solvapay_core::run_envelope_result(f())
}

/// Awaits an async client call and returns a JSON envelope string.
///
/// The host transport resolves synchronously (blocking host import), so the
/// caller drives this future to completion with `pollster::block_on`.
pub async fn run_envelope<T, Fut>(fut: Fut) -> String
where
    T: Serialize,
    Fut: std::future::Future<Output = Result<T, SdkError>>,
{
    match fut.await {
        Ok(value) => ok_envelope(&value),
        Err(err) => err_envelope(&err),
    }
}
