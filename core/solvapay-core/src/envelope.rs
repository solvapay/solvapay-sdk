//! Universal JSON envelope for binding FFI boundaries (§5.7).
//!
//! Success: `{"ok":true,"value":…}`. Failure: `{"ok":false,"error":<SdkError>}`.
//! Serialization failure degrades to a Transport envelope (never panics).

use std::panic::AssertUnwindSafe;

use serde::Serialize;
use serde_json::json;

use crate::SdkError;

/// Success envelope: `{"ok":true,"value":…}`.
///
/// Serialization failure becomes an error envelope (never panics).
pub fn ok_envelope<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(v) => json!({ "ok": true, "value": v }).to_string(),
        Err(err) => internal_error_envelope(format!("serialize success value: {err}")),
    }
}

/// Failure envelope: `{"ok":false,"error":<SdkError JSON>}`.
///
/// Serialization failure becomes a Transport envelope (never panics).
pub fn err_envelope(err: &SdkError) -> String {
    match serde_json::to_value(err) {
        Ok(error) => json!({ "ok": false, "error": error }).to_string(),
        Err(ser_err) => internal_error_envelope(format!("serialize SdkError: {ser_err}")),
    }
}

/// Panic / internal failure envelope as `SdkError::Transport` (non-retryable).
pub fn internal_error_envelope(message: impl Into<String>) -> String {
    err_envelope(&SdkError::transport(message.into(), false))
}

/// Maps a `catch_unwind` panic payload to an envelope string.
pub fn envelope_from_panic_payload(payload: Box<dyn std::any::Any + Send>) -> String {
    let message = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "native binding panicked".to_owned()
    };
    internal_error_envelope(message)
}

/// Parses a JSON object string into `T`, mapping failures to [`SdkError::Transport`].
///
/// # Errors
///
/// Returns [`SdkError::Transport`] (non-retryable) when `args_json` is not valid JSON for `T`.
#[allow(clippy::result_large_err)] // `SdkError` is the public FFI error surface.
pub fn parse_args_json<T: serde::de::DeserializeOwned>(args_json: &str) -> Result<T, SdkError> {
    serde_json::from_str(args_json)
        .map_err(|err| SdkError::transport(format!("invalid args JSON: {err}"), false))
}

/// Maps an already-computed `Result` into a JSON envelope string.
pub fn run_envelope_result<T: Serialize>(result: Result<T, SdkError>) -> String {
    match result {
        Ok(value) => ok_envelope(&value),
        Err(err) => err_envelope(&err),
    }
}

/// Runs a sync pure-core call and returns a JSON envelope string.
///
/// Catches panics (§7.6) and maps [`SdkError`] to an error envelope. Hosts that
/// cannot unwind (wasm `panic = "abort"`) should call [`run_envelope_result`]
/// instead of this helper.
pub fn run_envelope_sync<T, F>(f: F) -> String
where
    T: Serialize,
    F: FnOnce() -> Result<T, SdkError> + std::panic::UnwindSafe,
{
    match std::panic::catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => run_envelope_result(result),
        Err(payload) => envelope_from_panic_payload(payload),
    }
}
