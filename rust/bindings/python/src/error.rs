//! Binding error surface: webhook Python throws + JSON-envelope helpers (Step 40).
//!
//! Domain client errors never throw from Rust — they return
//! `{"ok":false,"error":<SdkError JSON>}`. Panics map to a Transport
//! `internal_error`-style envelope (§7.6 / §15 note 32). Webhook verification
//! throws [`SolvaPayError`] with a stable snake_case `code` attribute (§6.4).

use std::panic::AssertUnwindSafe;

use pyo3::create_exception;
use pyo3::exceptions::PyException;
use pyo3::prelude::*;
use pyo3::types::PyString;
use serde::Serialize;
use serde_json::json;
use solvapay_core::{SdkError, WebhookError};

create_exception!(
    solvapay,
    SolvaPayError,
    PyException,
    "SolvaPay SDK error with a stable snake_case `code` attribute."
);

/// Stable binding-level error carrying a snake_case `code` for Python.
///
/// Used by the sync webhook / smoke path that still throws across the FFI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingError {
    /// Snake_case machine code (also Python `SolvaPayError.code`).
    code: &'static str,
    /// Human-readable message.
    message: String,
}

impl BindingError {
    /// Builds a [`BindingError`] from a core [`WebhookError`].
    pub fn from_webhook(err: WebhookError) -> Self {
        Self {
            code: err.code.as_str(),
            message: err.message().to_owned(),
        }
    }

    /// Builds a panic / unwind boundary error (§7.6).
    pub fn panicked(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error",
            message: message.into(),
        }
    }

    /// Builds an error when JSON serialization of a verified payload fails.
    pub fn serialize_failed(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error",
            message: message.into(),
        }
    }

    /// Builds an error when the host clock cannot be read.
    pub fn clock_failed(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error",
            message: message.into(),
        }
    }

    /// Returns the stable snake_case error code.
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// Returns the human-readable message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Converts into a [`SolvaPayError`] Python exception with a `code` attr.
    pub fn into_py_err(self, py: Python<'_>) -> PyErr {
        let err = SolvaPayError::new_err(self.message.clone());
        let value = err.value(py);
        let _ = value.setattr("code", PyString::new(py, self.code));
        err
    }

    /// Converts a catch_unwind panic payload into a [`BindingError`].
    pub fn from_panic_payload(payload: Box<dyn std::any::Any + Send>) -> Self {
        let message = if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_owned()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "native binding panicked".to_owned()
        };
        Self::panicked(message)
    }
}

/// Maps [`SdkError`] to a [`SolvaPayError`] at the FFI boundary (§6.4).
///
/// Used when a constructor or other non-envelope edge must raise.
pub fn sdk_error_to_py(py: Python<'_>, err: &SdkError) -> PyErr {
    let code = match err {
        SdkError::Api { .. } => "api_error",
        SdkError::Paywall { .. } => "paywall",
        SdkError::Webhook { code, .. } => code.as_str(),
        SdkError::Transport { .. } => "transport_error",
    };
    BindingError {
        code,
        message: err.message().to_owned(),
    }
    .into_py_err(py)
}

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

/// Maps a catch_unwind panic payload to an envelope string.
#[allow(dead_code)] // used by Step 41 sync decision envelopes
pub fn envelope_from_panic_payload(payload: Box<dyn std::any::Any + Send>) -> String {
    internal_error_envelope(
        BindingError::from_panic_payload(payload)
            .message()
            .to_owned(),
    )
}

/// Parses a JSON object string into `T`, mapping failures to [`SdkError::Transport`].
pub fn parse_args_json<T: serde::de::DeserializeOwned>(args_json: &str) -> Result<T, SdkError> {
    serde_json::from_str(args_json)
        .map_err(|err| SdkError::transport(format!("invalid args JSON: {err}"), false))
}

/// Runs a sync pure-core call and returns a JSON envelope string.
pub fn run_envelope_sync<T, F>(f: F) -> String
where
    T: Serialize,
    F: FnOnce() -> Result<T, SdkError> + std::panic::UnwindSafe,
{
    match std::panic::catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(value)) => ok_envelope(&value),
        Ok(Err(err)) => err_envelope(&err),
        Err(payload) => envelope_from_panic_payload(payload),
    }
}

/// Awaits an async client call and returns a JSON envelope string.
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

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items,
    missing_docs
)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn parse_envelope(json: &str) -> Value {
        serde_json::from_str(json).expect("envelope must be JSON")
    }

    #[test]
    fn ok_and_err_envelope_helpers_round_trip() {
        let ok = parse_envelope(&ok_envelope(&json!({"customerRef": "cus_x"})));
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["value"]["customerRef"], "cus_x");

        let err = parse_envelope(&err_envelope(&SdkError::transport("nope", false)));
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["kind"], "Transport");
    }

    #[test]
    fn run_envelope_sync_wraps_ok_err_and_panic() {
        let ok = parse_envelope(&run_envelope_sync(|| Ok::<_, SdkError>(json!({"x": 1}))));
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["value"]["x"], 1);

        let err = parse_envelope(&run_envelope_sync(|| {
            Err::<Value, _>(SdkError::transport("nope", false))
        }));
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["kind"], "Transport");

        let panicked = parse_envelope(&run_envelope_sync(|| -> Result<Value, SdkError> {
            panic!("sync boom");
        }));
        assert_eq!(panicked["ok"], false);
        assert_eq!(panicked["error"]["message"], "sync boom");
        assert_eq!(panicked["error"]["retryable"], false);
    }
}
