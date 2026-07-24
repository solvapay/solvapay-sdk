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
use serde_json::json;
use solvapay_core::SdkError;

/// Success envelope: `{"ok":true,"value":…}`.
///
/// Serialization failure degrades to an internal-error envelope (never panics).
pub fn ok_envelope<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(v) => json!({ "ok": true, "value": v }).to_string(),
        Err(err) => internal_error_envelope(format!("serialize success value: {err}")),
    }
}

/// Failure envelope: `{"ok":false,"error":<SdkError JSON>}`.
pub fn err_envelope(err: &SdkError) -> String {
    match serde_json::to_value(err) {
        Ok(error) => json!({ "ok": false, "error": error }).to_string(),
        Err(ser_err) => internal_error_envelope(format!("serialize SdkError: {ser_err}")),
    }
}

/// Internal failure envelope as a non-retryable `SdkError::Transport`.
pub fn internal_error_envelope(message: impl Into<String>) -> String {
    err_envelope(&SdkError::transport(message.into(), false))
}

/// Parses a JSON args string into `T`, mapping failures to `SdkError::Transport`.
///
/// # Errors
///
/// Returns [`SdkError::Transport`] (non-retryable) when `args_json` is not valid
/// JSON for `T`.
pub fn parse_args_json<T: serde::de::DeserializeOwned>(args_json: &str) -> Result<T, SdkError> {
    serde_json::from_str(args_json)
        .map_err(|err| SdkError::transport(format!("invalid args JSON: {err}"), false))
}

/// Runs a sync core call and returns a JSON envelope string.
pub fn run_envelope_sync<T, F>(f: F) -> String
where
    T: Serialize,
    F: FnOnce() -> Result<T, SdkError>,
{
    match f() {
        Ok(value) => ok_envelope(&value),
        Err(err) => err_envelope(&err),
    }
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
